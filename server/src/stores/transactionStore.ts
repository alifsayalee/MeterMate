import { randomUUID } from 'node:crypto';
import type { TransactionRecord, TransactionState, TransactionType } from '../types.js';

/**
 * In-memory transaction store. Holds transaction records plus the
 * `(consultantId, clientEmail) → channelId` map that powers Slack channel
 * reuse: the first action for a pair creates the channel; later actions reuse
 * it. DB-ready — nothing outside this module touches the Maps.
 */

const transactions = new Map<string, TransactionRecord>();
/** Maps a normalized `(consultant,client)` pair key to a stored channel. */
const pairChannels = new Map<string, { channelId: string; channelName: string }>();

function pairKey(consultantId: string, clientEmail: string): string {
  return `${consultantId.toLowerCase()}::${clientEmail.trim().toLowerCase()}`;
}

export interface NewTransactionInput {
  type: TransactionType;
  consultantId: string;
  clientEmail: string;
}

/** Create a transaction in the `started` state. */
export function createTransaction(input: NewTransactionInput): TransactionRecord {
  const now = Date.now();
  const txn: TransactionRecord = {
    txnId: randomUUID(),
    type: input.type,
    state: 'started',
    consultantId: input.consultantId,
    clientEmail: input.clientEmail.trim().toLowerCase(),
    createdAt: now,
    updatedAt: now,
  };
  // Reuse a previously-created channel for this pair, if one exists.
  const existing = pairChannels.get(pairKey(txn.consultantId, txn.clientEmail));
  if (existing) {
    txn.channelId = existing.channelId;
    txn.channelName = existing.channelName;
  }
  transactions.set(txn.txnId, txn);
  return { ...txn };
}

/** Fetch a transaction by id (immutable copy). */
export function getTransaction(txnId: string): TransactionRecord | undefined {
  const t = transactions.get(txnId);
  return t ? { ...t } : undefined;
}

/** Patch a transaction's mutable fields. */
export function updateTransaction(
  txnId: string,
  patch: Partial<Omit<TransactionRecord, 'txnId' | 'createdAt' | 'type'>>,
): TransactionRecord | undefined {
  const t = transactions.get(txnId);
  if (!t) return undefined;
  Object.assign(t, patch, { updatedAt: Date.now() });
  return { ...t };
}

/** Convenience: set the terminal state (+ optional error) of a transaction. */
export function setTransactionState(
  txnId: string,
  state: TransactionState,
  error?: string,
): TransactionRecord | undefined {
  return updateTransaction(txnId, error !== undefined ? { state, error } : { state });
}

/**
 * Record the Slack channel for a `(consultant,client)` pair and stamp it onto
 * the transaction, so subsequent transactions for the same pair reuse it.
 */
export function rememberChannel(
  txnId: string,
  consultantId: string,
  clientEmail: string,
  channel: { channelId: string; channelName: string },
): void {
  pairChannels.set(pairKey(consultantId, clientEmail), { ...channel });
  updateTransaction(txnId, { channelId: channel.channelId, channelName: channel.channelName });
}

/** Look up an already-created channel for a pair (channel reuse). */
export function findChannelForPair(
  consultantId: string,
  clientEmail: string,
): { channelId: string; channelName: string } | undefined {
  const found = pairChannels.get(pairKey(consultantId, clientEmail));
  return found ? { ...found } : undefined;
}

/** How many transactions have been created for a pair (used for channel naming). */
export function countForPair(consultantId: string, clientEmail: string): number {
  const key = pairKey(consultantId, clientEmail);
  let n = 0;
  for (const t of transactions.values()) {
    if (pairKey(t.consultantId, t.clientEmail) === key) n += 1;
  }
  return n;
}

/** Current transaction count (used by /api/health). */
export function transactionCount(): number {
  return transactions.size;
}
