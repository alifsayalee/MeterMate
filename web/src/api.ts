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
