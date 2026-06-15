import {
  ApiError,
  CollectionMethod,
  ComponentKind,
  type CreateSubscriptionRequest,
  type CreateUsageRequest,
  type EBBEvent,
  ErrorListResponseError,
  type CancellationRequest,
  type CreateInvoiceRequest,
  type SendInvoiceRequest,
  type SubscriptionMigrationPreviewRequest,
  type SubscriptionProductMigrationRequest,
  type UpdateSubscriptionRequest,
} from '@maxio-com/advanced-billing-sdk';
import {
  componentsController,
  invoicesController,
  maxioAdminBaseUrl,
  productsController,
  subscriptionComponentsController,
  subscriptionProductsController,
  subscriptionStatusController,
  subscriptionsController,
} from '../maxioClient.js';
import type {
  CancelType,
  CollectionMethodValue,
  InvoiceLineItemInput,
  InvoiceResult,
  LifecycleAction,
  LifecycleResult,
  PlanChangePreview,
  PlanChangeResult,
  PlanChangeTiming,
  SubscriptionResult,
  UsageResult,
} from '../types.js';

/**
 * Maxio operations, one function per use case. No Express/Slack imports — pure
 * billing logic, unit-testable with the SDK mocked. Errors are normalised to
 * `MaxioServiceError` carrying a human-readable summary for Slack + the API.
 */

export class MaxioServiceError extends Error {
  readonly statusCode: number | undefined;
  readonly details: string[];
  constructor(message: string, statusCode?: number, details: string[] = []) {
    super(message);
    this.name = 'MaxioServiceError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

/** Extract a readable error summary from a Maxio SDK error. */
function summarizeMaxioError(error: unknown): MaxioServiceError {
  if (error instanceof ErrorListResponseError) {
    const result = error.result as { errors?: unknown } | undefined;
    const raw = result?.errors;
    const details = Array.isArray(raw) ? raw.map((e) => String(e)) : raw ? [String(raw)] : [];
    const message = details.length ? details.join('; ') : 'Maxio rejected the request';
    return new MaxioServiceError(message, error.statusCode, details);
  }
  if (error instanceof ApiError) {
    const body = typeof error.body === 'string' ? error.body : '';
    return new MaxioServiceError(
      body || `Maxio API error (HTTP ${error.statusCode})`,
      error.statusCode,
    );
  }
  if (error instanceof Error) return new MaxioServiceError(error.message);
  return new MaxioServiceError('Unknown Maxio error');
}

function toCents(value: bigint | number | undefined | null): number {
  if (value === undefined || value === null) return 0;
  return typeof value === 'bigint' ? Number(value) : value;
}

export interface CreateSubscriptionInput {
  firstName: string;
  lastName: string;
  email: string;
  productHandle: string;
  collectionMethod: CollectionMethodValue;
  couponCode?: string;
}

/**
 * UC1 — create a subscription, creating the customer inline (or reusing one
 * matched by the email `reference`). Reads back plan, MRR, state, and next
 * assessment date.
 */
export async function createSubscription(
  input: CreateSubscriptionInput,
): Promise<SubscriptionResult> {
  const collectionMethod =
    input.collectionMethod === 'automatic'
      ? CollectionMethod.Automatic
      : CollectionMethod.Remittance;

  const body: CreateSubscriptionRequest = {
    subscription: {
      productHandle: input.productHandle,
      paymentCollectionMethod: collectionMethod,
      customerAttributes: {
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        // Email-based reference makes customer creation idempotent: a repeat
        // booking with the same email reuses the existing Maxio customer.
        reference: input.email.trim().toLowerCase(),
      },
      ...(input.couponCode ? { couponCodes: [input.couponCode] } : {}),
    },
  };

  let response;
  try {
    response = await subscriptionsController().createSubscription(body);
  } catch (error) {
    throw summarizeMaxioError(error);
  }

  const subscription = response.result?.subscription;
  if (!subscription || subscription.id === undefined) {
    throw new MaxioServiceError('Maxio returned no subscription');
  }

  const customerId = subscription.customer?.id;
  if (customerId === undefined) {
    throw new MaxioServiceError('Maxio returned a subscription without a customer');
  }

  const planName = subscription.product?.name ?? input.productHandle;
  const nextAssessmentAt = subscription.nextAssessmentAt ?? subscription.currentPeriodEndsAt ?? null;

  return {
    subscriptionId: subscription.id,
    customerId,
    customerReference: subscription.customer?.reference ?? null,
    planName,
    productHandle: input.productHandle,
    mrrInCents: toCents(subscription.productPriceInCents),
    state: subscription.state ?? 'unknown',
    collectionMethod: subscription.paymentCollectionMethod ?? input.collectionMethod,
    nextAssessmentAt,
    maxioUrl: `${maxioAdminBaseUrl()}/subscriptions/${subscription.id}`,
  };
}

// ── UC2 — Report Session Usage ───────────────────────────────────────────────

interface ResolvedComponent {
  id: number;
  handle: string;
  kind: ComponentKind;
  unitName: string | null;
}

/** Cache component (id, kind, unit) by handle — types rarely change, and usage
 * recording must dispatch on the kind, so we resolve once and reuse. */
const componentCache = new Map<string, ResolvedComponent>();

/** Resolve a component by handle (cached). Throws a typed error if unknown. */
export async function resolveComponent(handle: string): Promise<ResolvedComponent> {
  const cached = componentCache.get(handle);
  if (cached) return cached;

  let response;
  try {
    response = await componentsController().findComponent(handle);
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 404) {
      throw new MaxioServiceError(`Unknown component handle "${handle}"`, 404);
    }
    throw summarizeMaxioError(error);
  }

  const component = response.result?.component;
  if (!component || component.id === undefined || component.kind === undefined) {
    throw new MaxioServiceError(`Unknown component handle "${handle}"`, 404);
  }

  const resolved: ResolvedComponent = {
    id: component.id,
    handle: component.handle ?? handle,
    kind: component.kind,
    unitName: component.unitName ?? null,
  };
  componentCache.set(handle, resolved);
  return resolved;
}

function usageQuantityToNumber(q: unknown): number {
  if (typeof q === 'number') return q;
  if (typeof q === 'string') {
    const n = Number.parseFloat(q);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

/** Sum recorded usage for a component on a subscription (running period total). */
async function sumPeriodUsage(subscriptionId: number, componentId: number): Promise<number> {
  const response = await subscriptionComponentsController().listUsages({
    subscriptionIdOrReference: subscriptionId,
    componentId,
    page: 1,
    perPage: 200,
  });
  const usages = response.result ?? [];
  let total = 0;
  for (const wrapper of usages) {
    total += usageQuantityToNumber(wrapper.usage?.quantity);
  }
  return total;
}

export interface RecordUsageInput {
  subscriptionId: number;
  componentHandle: string;
  quantity: number;
  memo?: string;
  /** ISO timestamp, used only for event-based components. */
  timestamp?: string;
}

/**
 * UC2 — record usage against a component, dispatching on the component's kind:
 *  - metered / quantity-based / prepaid → record a usage quantity (+ memo),
 *    then read back the running period total from usage history.
 *  - event-based → record a usage event (with optional timestamp). Event-based
 *    components expose no usage-history read-back, so periodTotal is null.
 * Maxio rates the usage and accrues it to the next invoice.
 */
export async function recordUsage(input: RecordUsageInput): Promise<UsageResult> {
  const component = await resolveComponent(input.componentHandle);

  if (component.kind === ComponentKind.EventBasedComponent) {
    const event: EBBEvent = {
      chargify: {
        subscriptionId: input.subscriptionId,
        ...(input.timestamp ? { timestamp: input.timestamp } : {}),
      },
    };
    try {
      // The event api handle equals the component handle for EBB components.
      await subscriptionComponentsController().recordEvent(component.handle, undefined, event);
    } catch (error) {
      throw summarizeMaxioError(error);
    }
    return {
      componentHandle: component.handle,
      componentId: component.id,
      componentKind: component.kind,
      unitName: component.unitName,
      recordedVia: 'event',
      recordedQuantity: input.quantity,
      periodTotal: null,
      memo: input.memo ?? null,
      usageId: null,
    };
  }

  if (
    component.kind !== ComponentKind.MeteredComponent &&
    component.kind !== ComponentKind.QuantityBasedComponent &&
    component.kind !== ComponentKind.PrepaidUsageComponent
  ) {
    throw new MaxioServiceError(
      `Component "${component.handle}" (kind ${component.kind}) does not accept usage`,
      422,
    );
  }

  const body: CreateUsageRequest = {
    usage: {
      quantity: input.quantity,
      ...(input.memo ? { memo: input.memo } : {}),
    },
  };

  let response;
  try {
    response = await subscriptionComponentsController().createUsage(
      input.subscriptionId,
      component.id,
      body,
    );
  } catch (error) {
    throw summarizeMaxioError(error);
  }

  const usage = response.result?.usage;
  if (!usage) {
    throw new MaxioServiceError('Maxio returned no usage record');
  }

  let periodTotal: number | null = null;
  try {
    periodTotal = await sumPeriodUsage(input.subscriptionId, component.id);
  } catch (error) {
    // Read-back is best-effort: the usage was recorded; don't fail the call.
    console.warn('[uc2] listUsages read-back failed:', error instanceof Error ? error.message : error);
  }

  return {
    componentHandle: component.handle,
    componentId: component.id,
    componentKind: component.kind,
    unitName: component.unitName,
    recordedVia: 'usage',
    recordedQuantity: usageQuantityToNumber(usage.quantity ?? input.quantity),
    periodTotal,
    memo: usage.memo ?? input.memo ?? null,
    usageId: usage.id !== undefined ? usage.id.toString() : null,
  };
}

// ── UC3 — Plan Change (proration preview + commit) ───────────────────────────

/** Read a product's display name by handle (best-effort; null on failure). */
async function readProductName(handle: string): Promise<string | null> {
  try {
    const res = await productsController().readProductByHandle(handle);
    return res.result?.product?.name ?? null;
  } catch {
    return null;
  }
}

export interface PlanChangePreviewInput {
  subscriptionId: number;
  targetHandle: string;
}

/**
 * UC3 (preview) — compute the prorated cost of moving the subscription to the
 * target plan now, WITHOUT committing. Uses the same proration mechanism the
 * "prorate" commit applies, so the preview reflects the real charge.
 */
export async function previewPlanChange(input: PlanChangePreviewInput): Promise<PlanChangePreview> {
  const body: SubscriptionMigrationPreviewRequest = {
    migration: { productHandle: input.targetHandle, includeCoupons: true, preservePeriod: false },
  };

  let response;
  try {
    response = await subscriptionProductsController().previewSubscriptionProductMigration(
      input.subscriptionId,
      body,
    );
  } catch (error) {
    throw summarizeMaxioError(error);
  }

  const migration = response.result?.migration;
  if (!migration) throw new MaxioServiceError('Maxio returned no migration preview');

  return {
    targetHandle: input.targetHandle,
    proratedAdjustmentInCents: toCents(migration.proratedAdjustmentInCents),
    chargeInCents: toCents(migration.chargeInCents),
    paymentDueInCents: toCents(migration.paymentDueInCents),
    creditAppliedInCents: toCents(migration.creditAppliedInCents),
  };
}

export interface ApplyPlanChangeInput {
  subscriptionId: number;
  targetHandle: string;
  timing: PlanChangeTiming;
}

/**
 * UC3 (commit) — apply the plan change.
 *  - `prorate`: migrate the subscription NOW, charging the prorated delta
 *    immediately (the same mechanism the preview reflects).
 *  - `at-renewal`: schedule a delayed, NON-prorated product change that takes
 *    effect at the next renewal (productChangeDelayed).
 */
export async function applyPlanChange(input: ApplyPlanChangeInput): Promise<PlanChangeResult> {
  // Capture the current plan name before the change (for old → new reporting).
  let oldPlanName = 'current plan';
  try {
    const before = await subscriptionsController().readSubscription(input.subscriptionId);
    oldPlanName = before.result?.subscription?.product?.name ?? oldPlanName;
  } catch {
    // Non-fatal: we'll still report the change with a generic old-plan label.
  }

  const maxioUrl = `${maxioAdminBaseUrl()}/subscriptions/${input.subscriptionId}`;

  if (input.timing === 'prorate') {
    const body: SubscriptionProductMigrationRequest = {
      migration: { productHandle: input.targetHandle, includeCoupons: true, preservePeriod: false },
    };
    let response;
    try {
      response = await subscriptionProductsController().migrateSubscriptionProduct(
        input.subscriptionId,
        body,
      );
    } catch (error) {
      throw summarizeMaxioError(error);
    }
    const sub = response.result?.subscription;
    return {
      timing: 'prorate',
      oldPlanName,
      newPlanName: sub?.product?.name ?? input.targetHandle,
      newPlanHandle: input.targetHandle,
      state: sub?.state ?? 'unknown',
      scheduled: false,
      effectiveDate: null,
      paymentDueInCents: null,
      maxioUrl,
    };
  }

  // at-renewal → delayed, non-prorated product change.
  const body: UpdateSubscriptionRequest = {
    subscription: { productHandle: input.targetHandle, productChangeDelayed: true },
  };
  let response;
  try {
    response = await subscriptionsController().updateSubscription(input.subscriptionId, body);
  } catch (error) {
    throw summarizeMaxioError(error);
  }
  const sub = response.result?.subscription;
  const newPlanName = (await readProductName(input.targetHandle)) ?? input.targetHandle;
  return {
    timing: 'at-renewal',
    oldPlanName,
    newPlanName,
    newPlanHandle: input.targetHandle,
    state: sub?.state ?? 'unknown',
    scheduled: true,
    effectiveDate: sub?.currentPeriodEndsAt ?? null,
    paymentDueInCents: null,
    maxioUrl,
  };
}

// ── UC4 — Lifecycle Control ──────────────────────────────────────────────────

/** Read the current state of a subscription (best-effort; 'unknown' on failure). */
async function readSubscriptionState(subscriptionId: number): Promise<string> {
  try {
    const res = await subscriptionsController().readSubscription(subscriptionId);
    return res.result?.subscription?.state ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export interface ControlLifecycleInput {
  subscriptionId: number;
  action: LifecycleAction;
  /** Required semantics only for `cancel`; defaults to 'immediate'. */
  cancelType?: CancelType;
  reasonCode?: string;
}

/**
 * UC4 — dispatch a lifecycle action to its Maxio operation:
 *  - pause     → pauseSubscription (→ on_hold)
 *  - resume    → resumeSubscription (→ active)
 *  - cancel/immediate     → cancelSubscription with no schedule (→ canceled)
 *  - cancel/end-of-period → cancelSubscription with cancelAtEndOfPeriod (delayed)
 *  - reactivate → reactivateSubscription (→ active)
 * Reads the prior state first so the result can report the transition.
 */
export async function controlLifecycle(input: ControlLifecycleInput): Promise<LifecycleResult> {
  const previousState = await readSubscriptionState(input.subscriptionId);
  const status = subscriptionStatusController();
  const maxioUrl = `${maxioAdminBaseUrl()}/subscriptions/${input.subscriptionId}`;

  const base = {
    action: input.action,
    previousState,
    cancelType: null as CancelType | null,
    cancelAtEndOfPeriod: false,
    effectiveDate: null as string | null,
    reasonCode: input.reasonCode ?? null,
    maxioUrl,
  };

  try {
    switch (input.action) {
      case 'pause': {
        const res = await status.pauseSubscription(input.subscriptionId);
        return { ...base, newState: res.result?.subscription?.state ?? 'on_hold' };
      }
      case 'resume': {
        const res = await status.resumeSubscription(input.subscriptionId);
        return { ...base, newState: res.result?.subscription?.state ?? 'active' };
      }
      case 'reactivate': {
        const res = await status.reactivateSubscription(input.subscriptionId);
        return { ...base, newState: res.result?.subscription?.state ?? 'active' };
      }
      case 'cancel': {
        const cancelType: CancelType = input.cancelType ?? 'immediate';
        if (cancelType === 'end-of-period') {
          const body: CancellationRequest = {
            subscription: {
              cancelAtEndOfPeriod: true,
              ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}),
            },
          };
          const res = await status.cancelSubscription(input.subscriptionId, body);
          const sub = res.result?.subscription;
          return {
            ...base,
            cancelType,
            newState: sub?.state ?? 'active',
            cancelAtEndOfPeriod: sub?.cancelAtEndOfPeriod === true,
            effectiveDate: sub?.delayedCancelAt ?? null,
          };
        }
        // immediate cancel: omit schedule fields entirely.
        const body: CancellationRequest | undefined = input.reasonCode
          ? { subscription: { reasonCode: input.reasonCode } }
          : undefined;
        const res = await status.cancelSubscription(input.subscriptionId, body);
        return { ...base, cancelType, newState: res.result?.subscription?.state ?? 'canceled' };
      }
      default: {
        // Exhaustiveness guard.
        const _never: never = input.action;
        throw new MaxioServiceError(`Unsupported lifecycle action "${String(_never)}"`);
      }
    }
  } catch (error) {
    if (error instanceof MaxioServiceError) throw error;
    throw summarizeMaxioError(error);
  }
}

// ── UC5 — Invoice Issue + Send ───────────────────────────────────────────────

export interface IssueInvoiceInput {
  subscriptionId: number;
  lineItems: InvoiceLineItemInput[];
  memo?: string;
  sendEmail: boolean;
  /** The customer's email — used as the recipient when sendEmail is true. */
  recipientEmail?: string;
}

/**
 * UC5 — create an ad-hoc invoice for the subscription from custom line items,
 * which Maxio issues immediately (open status, with a hosted public payment
 * URL), optionally email it to the customer, and read back amount due / due
 * date / public URL.
 */
export async function issueInvoice(input: IssueInvoiceInput): Promise<InvoiceResult> {
  const body: CreateInvoiceRequest = {
    invoice: {
      lineItems: input.lineItems.map((li) => ({
        title: li.title,
        quantity: li.quantity,
        // Maxio expects a decimal-string unit price.
        unitPrice: li.unitPrice.toFixed(2),
      })),
      ...(input.memo ? { memo: input.memo } : {}),
    },
  };

  let invoice;
  try {
    const response = await invoicesController().createInvoice(input.subscriptionId, body);
    invoice = response.result?.invoice;
  } catch (error) {
    throw summarizeMaxioError(error);
  }
  if (!invoice || !invoice.uid) {
    throw new MaxioServiceError('Maxio returned no invoice');
  }
  const uid = invoice.uid;

  // Optionally email the issued invoice to the customer.
  let emailed = false;
  if (input.sendEmail && input.recipientEmail) {
    const sendBody: SendInvoiceRequest = { recipientEmails: [input.recipientEmail] };
    try {
      await invoicesController().sendInvoice(uid, sendBody);
      emailed = true;
    } catch (error) {
      // Email is best-effort: the invoice exists and is payable via the public
      // URL; surface the failure but don't discard the issued invoice.
      console.warn('[uc5] sendInvoice failed:', error instanceof Error ? error.message : error);
    }
  }

  // The create response carries the public URL for open invoices; re-read only
  // if it's missing, so the "Pay Invoice" link is always populated when available.
  let publicUrl = invoice.publicUrl ?? null;
  if (!publicUrl) {
    try {
      const reread = await invoicesController().readInvoice(uid);
      publicUrl = reread.result?.publicUrl ?? null;
    } catch {
      // leave null; the invoice was still issued.
    }
  }

  return {
    invoiceUid: uid,
    invoiceNumber: invoice.number ?? null,
    status: invoice.status ?? 'open',
    totalAmount: invoice.totalAmount ?? '0.00',
    dueAmount: invoice.dueAmount ?? invoice.totalAmount ?? '0.00',
    dueDate: invoice.dueDate ?? null,
    publicUrl,
    emailed,
    recipientEmail: input.sendEmail ? (input.recipientEmail ?? null) : null,
    maxioUrl: `${maxioAdminBaseUrl()}/subscriptions/${input.subscriptionId}`,
  };
}
