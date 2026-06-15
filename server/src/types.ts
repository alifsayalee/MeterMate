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

/** Discriminated response status returned by every mutating route. */
export type ApiStatus = 'ok' | 'maxio_failed' | 'invalid' | 'session_expired';
