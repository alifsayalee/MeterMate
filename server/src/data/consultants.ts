// Import config for its side effect: this guarantees `.env` has been loaded
// (dotenv runs at config module load) BEFORE we read process.env below.
import '../config.js';
import type { Consultant } from '../types.js';

/**
 * Seeded consultants. In-memory by design (DB-ready later). Emails should match
 * real Slack workspace members for the clean demo path (tier-1 invite); if a
 * consultant isn't a workspace member, ensureTxnChannel falls back gracefully.
 *
 * Override an email at runtime via env (e.g. CONSULTANT_ALICE_EMAIL) without
 * editing code, so the demo can point at whatever workspace is in use.
 */
const SEED: ReadonlyArray<Consultant> = [
  {
    id: 'alice',
    name: 'Alice Avery',
    email: process.env['CONSULTANT_ALICE_EMAIL'] ?? 'alice@example.com',
  },
  {
    id: 'bob',
    name: 'Bob Brenner',
    email: process.env['CONSULTANT_BOB_EMAIL'] ?? 'bob@example.com',
  },
];

const byId = new Map<string, Consultant>(SEED.map((c) => [c.id, c]));

/** All seeded consultants (immutable copies). */
export function listConsultants(): Consultant[] {
  return SEED.map((c) => ({ ...c }));
}

/** Look up a consultant by id, or `undefined` if unknown. */
export function getConsultant(id: string): Consultant | undefined {
  const found = byId.get(id);
  return found ? { ...found } : undefined;
}
