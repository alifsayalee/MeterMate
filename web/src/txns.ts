/**
 * Client-side memory of recent transactions, so forms for follow-up actions
 * (UC2 usage, and later UC3/UC4) can offer a transaction to act on instead of
 * forcing the user to copy a txnId by hand. Persisted in localStorage.
 */

export interface RecentTxn {
  txnId: string;
  label: string;
  channelName: string | null;
  createdAt: number;
}

const KEY = 'metermate.recentTxns';
const MAX = 10;

export function listRecentTxns(): RecentTxn[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentTxn[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Add (or move-to-front) a transaction, keeping the list bounded and unique. */
export function rememberTxn(txn: RecentTxn): void {
  try {
    const existing = listRecentTxns().filter((t) => t.txnId !== txn.txnId);
    const next = [txn, ...existing].slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Ignore storage failures; the manual txnRef field still works.
  }
}
