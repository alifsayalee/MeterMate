/** Shared domain types for MeterMate. Kept intentionally small and grown per
 * use case rather than speculatively. */

/** A seeded consultant — the "label on the transaction" per the pricing model. */
export interface Consultant {
  /** Stable id used in API payloads and channel names. */
  id: string;
  /** Display name shown in Slack and the UI. */
  name: string;
  /** Workspace email; used to resolve the consultant to a Slack user id. */
  email: string;
}

/** Payment collection methods supported by Maxio for our subscriptions. */
export type CollectionMethodValue = 'automatic' | 'remittance';

/** Lifecycle state of a MeterMate transaction (the unit a Slack channel wraps). */
export type TransactionState = 'started' | 'completed' | 'failed';

/** The kind of billing action a transaction represents. Grown per use case. */
export type TransactionType = 'subscription';

/** One consultant↔client transaction. Holds the Maxio + Slack handles needed to
 * narrate and later reuse the per-transaction channel. */
export interface TransactionRecord {
  txnId: string;
  type: TransactionType;
  state: TransactionState;
  consultantId: string;
  clientEmail: string;
  /** Slack channel created/reused for this consultant↔client pair, if any. */
  channelId?: string;
  channelName?: string;
  /** Maxio identifiers, populated once the billing operation succeeds. */
  maxioSubscriptionId?: number;
  maxioCustomerId?: number;
  /** Last error summary if the transaction failed. */
  error?: string;
  createdAt: number;
  updatedAt: number;
}

/** Per-session scratch space: the live submission + last result for multi-step
 * flows. TTL-swept. */
export interface SessionData {
  sessionId: string;
  lastTxnId?: string;
  /** Arbitrary last result payload, used by multi-step flows in later UCs. */
  lastResult?: unknown;
  createdAt: number;
  updatedAt: number;
}

/** Normalised result of a Maxio subscription creation (UC1). */
export interface SubscriptionResult {
  subscriptionId: number;
  customerId: number;
  customerReference: string | null;
  planName: string;
  productHandle: string;
  /** Monthly recurring revenue in cents (the product's recurring amount). */
  mrrInCents: number;
  state: string;
  collectionMethod: string;
  /** ISO timestamp of the next billing/assessment, if scheduled. */
  nextAssessmentAt: string | null;
  /** Deep link to the subscription in the Maxio admin UI. */
  maxioUrl: string;
}

/** Normalised result of recording usage against a component (UC2). */
export interface UsageResult {
  componentHandle: string;
  componentId: number;
  componentKind: string;
  unitName: string | null;
  /** How the usage was recorded: a usage record (metered) or an event (EBB). */
  recordedVia: 'usage' | 'event';
  /** Quantity recorded by this call. */
  recordedQuantity: number;
  /** Sum of recorded usage in the current period, or null when not readable
   * (e.g. event-based components return no usage history). */
  periodTotal: number | null;
  memo: string | null;
  /** Id of the created usage record (metered path), if any. */
  usageId: string | null;
}

// ── UC3 — Plan Change ────────────────────────────────────────────────────────

/** `prorate` = change now with proration; `at-renewal` = deferred, non-prorated. */
export type PlanChangeTiming = 'prorate' | 'at-renewal';

/** Prorated cost of moving the subscription to a target plan now (preview). */
export interface PlanChangePreview {
  targetHandle: string;
  /** Prorated credit for the unused portion of the current plan. */
  proratedAdjustmentInCents: number;
  /** Charge for the new plan over the remaining period. */
  chargeInCents: number;
  /** Net amount due immediately (charge minus credit). */
  paymentDueInCents: number;
  /** Credit applied from the current plan. */
  creditAppliedInCents: number;
}

/** Result of committing a plan change. */
export interface PlanChangeResult {
  timing: PlanChangeTiming;
  oldPlanName: string;
  newPlanName: string;
  newPlanHandle: string;
  state: string;
  /** Whether the change is scheduled for the next renewal (at-renewal) vs now. */
  scheduled: boolean;
  /** Effective date: next renewal for at-renewal; null = immediate for prorate. */
  effectiveDate: string | null;
  /** Net amount charged now (prorate path); null for at-renewal. */
  paymentDueInCents: number | null;
  maxioUrl: string;
}

// ── UC4 — Lifecycle Control ──────────────────────────────────────────────────

export type LifecycleAction = 'pause' | 'resume' | 'cancel' | 'reactivate';
export type CancelType = 'immediate' | 'end-of-period';

/** Result of a lifecycle action (the state transition + effective timing). */
export interface LifecycleResult {
  action: LifecycleAction;
  previousState: string;
  newState: string;
  /** Only meaningful when action === 'cancel'. */
  cancelType: CancelType | null;
  /** True when an end-of-period (delayed) cancellation is scheduled. */
  cancelAtEndOfPeriod: boolean;
  /** Effective date for a scheduled action (delayed cancel), else null (now). */
  effectiveDate: string | null;
  reasonCode: string | null;
  maxioUrl: string;
}

// ── UC5 — Invoice Issue + Send ───────────────────────────────────────────────

/** A custom invoice line item (unit price in dollars). */
export interface InvoiceLineItemInput {
  title: string;
  quantity: number;
  unitPrice: number;
}

/** Normalised result of issuing (and optionally emailing) an invoice. */
export interface InvoiceResult {
  invoiceUid: string;
  invoiceNumber: string | null;
  status: string;
  /** Decimal-string amounts as Maxio returns them (e.g. "299.00"). */
  totalAmount: string;
  dueAmount: string;
  dueDate: string | null;
  /** Hosted public payment URL (the "Pay Invoice" link). */
  publicUrl: string | null;
  emailed: boolean;
  recipientEmail: string | null;
  maxioUrl: string;
}

// ── UC6 — Billing Activity Digest ────────────────────────────────────────────

/** Per-consultant billing summary aggregated from live Maxio data. */
export interface DigestResult {
  consultantId: string;
  consultantName: string;
  windowDays: number;
  totalSubscriptions: number;
  activeCount: number;
  /** Sum of recurring amounts (cents) across active subscriptions. */
  mrrInCents: number;
  /** Subscriptions created within the window. */
  newSignups: number;
  /** Subscriptions canceled within the window. */
  churned: number;
  /** Count of outstanding/overdue invoices across the consultant's subs. */
  overdueInvoices: number;
  /** ISO timestamp the digest was generated. */
  generatedAt: string;
}

/** Discriminated response status returned by every mutating route. */
export type ApiStatus = 'ok' | 'maxio_failed' | 'invalid' | 'session_expired';
