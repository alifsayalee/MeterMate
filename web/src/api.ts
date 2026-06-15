import { getSessionId, setSessionId } from './session.js';

/**
 * Typed fetch wrappers matching the verified backend contract. One function per
 * endpoint the current use cases need; grown slice by slice.
 */

export interface Consultant {
  id: string;
  name: string;
  email: string;
}

export interface SubscriptionResult {
  subscriptionId: number;
  customerId: number;
  customerReference: string | null;
  planName: string;
  productHandle: string;
  mrrInCents: number;
  state: string;
  collectionMethod: string;
  nextAssessmentAt: string | null;
  maxioUrl: string;
}

export type CollectionMethod = 'automatic' | 'remittance';

export interface BookRequest {
  firstName: string;
  lastName: string;
  email: string;
  consultantId: string;
  productHandle: string;
  collectionMethod: CollectionMethod;
  couponCode?: string;
}

/** Successful booking response. */
export interface BookOk {
  status: 'ok';
  sessionId: string;
  txnId: string;
  channelId: string | null;
  channelName: string | null;
  notes: string[];
  result: SubscriptionResult;
}

/** Validation failure (HTTP 400). */
export interface BookInvalid {
  status: 'invalid';
  errors: Array<{ path: string; message: string }>;
}

/** Billing failure (HTTP 502). */
export interface BookMaxioFailed {
  status: 'maxio_failed';
  sessionId: string;
  txnId: string;
  channelId: string | null;
  channelName: string | null;
  notes: string[];
  error: string;
}

export type BookResponse = BookOk | BookInvalid | BookMaxioFailed;

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return (await res.json()) as T;
}

export async function fetchConsultants(): Promise<Consultant[]> {
  const data = await getJson<{ status: string; consultants: Consultant[] }>('/api/consultants');
  return data.consultants;
}

/**
 * Submit a booking. Returns the discriminated response for all expected
 * statuses (ok / invalid / maxio_failed); throws only on transport/unexpected
 * errors. The server's `sessionId` is persisted for subsequent calls.
 */
export async function book(req: BookRequest): Promise<BookResponse> {
  const sessionId = getSessionId();
  const res = await fetch('/api/book', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...req, ...(sessionId ? { sessionId } : {}) }),
  });

  const data = (await res.json()) as BookResponse;
  if ((data.status === 'ok' || data.status === 'maxio_failed') && 'sessionId' in data) {
    setSessionId(data.sessionId);
  }
  return data;
}

// ── UC2 — Report Session Usage ───────────────────────────────────────────────

export interface UsageResult {
  componentHandle: string;
  componentId: number;
  componentKind: string;
  unitName: string | null;
  recordedVia: 'usage' | 'event';
  recordedQuantity: number;
  periodTotal: number | null;
  memo: string | null;
  usageId: string | null;
}

export interface UsageRequest {
  txnRef: string;
  componentHandle: string;
  quantity: number;
  memo?: string;
  timestamp?: string;
}

export interface UsageOk {
  status: 'ok';
  sessionId: string;
  txnId: string;
  channelId: string | null;
  channelName: string | null;
  result: UsageResult;
}

export interface UsageInvalid {
  status: 'invalid';
  errors: Array<{ path: string; message: string }>;
}

/** Transaction not found / no subscription (HTTP 409). */
export interface UsageSessionExpired {
  status: 'session_expired';
  sessionId: string;
  txnId?: string;
  error: string;
}

/** Billing failure (HTTP 502). */
export interface UsageMaxioFailed {
  status: 'maxio_failed';
  sessionId: string;
  txnId: string;
  channelId: string | null;
  channelName: string | null;
  error: string;
}

export type UsageResponse = UsageOk | UsageInvalid | UsageSessionExpired | UsageMaxioFailed;

/**
 * Record usage against a component on an existing transaction. Returns the
 * discriminated response for all expected statuses; throws only on
 * transport/unexpected errors.
 */
export async function recordUsage(req: UsageRequest): Promise<UsageResponse> {
  const sessionId = getSessionId();
  const res = await fetch('/api/usage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...req, ...(sessionId ? { sessionId } : {}) }),
  });

  const data = (await res.json()) as UsageResponse;
  if ((data.status === 'ok' || data.status === 'maxio_failed' || data.status === 'session_expired') && 'sessionId' in data) {
    setSessionId(data.sessionId);
  }
  return data;
}

// ── UC3 — Plan Change ────────────────────────────────────────────────────────

export type PlanChangeTiming = 'prorate' | 'at-renewal';

export interface PlanChangePreview {
  targetHandle: string;
  proratedAdjustmentInCents: number;
  chargeInCents: number;
  paymentDueInCents: number;
  creditAppliedInCents: number;
}

export interface PlanChangeResult {
  timing: PlanChangeTiming;
  oldPlanName: string;
  newPlanName: string;
  newPlanHandle: string;
  state: string;
  scheduled: boolean;
  effectiveDate: string | null;
  paymentDueInCents: number | null;
  maxioUrl: string;
}

export interface PlanChangeRequest {
  txnRef: string;
  targetHandle: string;
  timing: PlanChangeTiming;
}

interface PlanChangeInvalid {
  status: 'invalid';
  errors: Array<{ path: string; message: string }>;
}
interface PlanChangeSessionExpired {
  status: 'session_expired';
  sessionId: string;
  txnId?: string;
  error: string;
}
interface PlanChangeMaxioFailed {
  status: 'maxio_failed';
  sessionId: string;
  txnId: string;
  channelId: string | null;
  channelName: string | null;
  error: string;
}

export interface PreviewOk {
  status: 'ok';
  sessionId: string;
  txnId: string;
  channelId: string | null;
  channelName: string | null;
  preview: PlanChangePreview;
}
export type PreviewResponse =
  | PreviewOk
  | PlanChangeInvalid
  | PlanChangeSessionExpired
  | PlanChangeMaxioFailed;

export interface CommitOk {
  status: 'ok';
  sessionId: string;
  txnId: string;
  channelId: string | null;
  channelName: string | null;
  result: PlanChangeResult;
}
export type CommitResponse =
  | CommitOk
  | PlanChangeInvalid
  | PlanChangeSessionExpired
  | PlanChangeMaxioFailed;

function persistSession(data: { status: string } & Record<string, unknown>): void {
  if (
    (data.status === 'ok' || data.status === 'maxio_failed' || data.status === 'session_expired') &&
    typeof data['sessionId'] === 'string'
  ) {
    setSessionId(data['sessionId']);
  }
}

/** Preview the prorated cost of a plan change (no commit). */
export async function previewPlanChange(req: PlanChangeRequest): Promise<PreviewResponse> {
  const sessionId = getSessionId();
  const res = await fetch('/api/plan-change/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...req, ...(sessionId ? { sessionId } : {}) }),
  });
  const data = (await res.json()) as PreviewResponse;
  persistSession(data as never);
  return data;
}

/** Commit a plan change (prorate now or schedule at renewal). */
export async function commitPlanChange(req: PlanChangeRequest): Promise<CommitResponse> {
  const sessionId = getSessionId();
  const res = await fetch('/api/plan-change', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...req, ...(sessionId ? { sessionId } : {}) }),
  });
  const data = (await res.json()) as CommitResponse;
  persistSession(data as never);
  return data;
}

// ── UC4 — Lifecycle Control ──────────────────────────────────────────────────

export type LifecycleAction = 'pause' | 'resume' | 'cancel' | 'reactivate';
export type CancelType = 'immediate' | 'end-of-period';

export interface LifecycleResult {
  action: LifecycleAction;
  previousState: string;
  newState: string;
  cancelType: CancelType | null;
  cancelAtEndOfPeriod: boolean;
  effectiveDate: string | null;
  reasonCode: string | null;
  maxioUrl: string;
}

export interface LifecycleRequest {
  txnRef: string;
  action: LifecycleAction;
  cancelType?: CancelType;
  reasonCode?: string;
}

export interface LifecycleOk {
  status: 'ok';
  sessionId: string;
  txnId: string;
  channelId: string | null;
  channelName: string | null;
  result: LifecycleResult;
}
interface LifecycleInvalid {
  status: 'invalid';
  errors: Array<{ path: string; message: string }>;
}
interface LifecycleSessionExpired {
  status: 'session_expired';
  sessionId: string;
  txnId?: string;
  error: string;
}
interface LifecycleMaxioFailed {
  status: 'maxio_failed';
  sessionId: string;
  txnId: string;
  channelId: string | null;
  channelName: string | null;
  error: string;
}
export type LifecycleResponse =
  | LifecycleOk
  | LifecycleInvalid
  | LifecycleSessionExpired
  | LifecycleMaxioFailed;

/** Dispatch a lifecycle action (pause / resume / cancel / reactivate). */
export async function controlLifecycle(req: LifecycleRequest): Promise<LifecycleResponse> {
  const sessionId = getSessionId();
  const res = await fetch('/api/lifecycle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...req, ...(sessionId ? { sessionId } : {}) }),
  });
  const data = (await res.json()) as LifecycleResponse;
  persistSession(data as never);
  return data;
}
