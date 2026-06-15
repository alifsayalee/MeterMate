import {
  ApiError,
  CollectionMethod,
  ComponentKind,
  type CreateSubscriptionRequest,
  type CreateUsageRequest,
  type EBBEvent,
  ErrorListResponseError,
} from '@maxio-com/advanced-billing-sdk';
import {
  componentsController,
  maxioAdminBaseUrl,
  subscriptionComponentsController,
  subscriptionsController,
} from '../maxioClient.js';
import type { CollectionMethodValue, SubscriptionResult, UsageResult } from '../types.js';

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
