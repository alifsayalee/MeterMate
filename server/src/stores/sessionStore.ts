import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import type { SessionData } from '../types.js';

/**
 * In-memory session store. Holds the live submission + last result per session
 * so multi-step flows (e.g. UC3 preview → confirm) work without re-sending
 * everything. TTL-swept so idle sessions don't grow memory unbounded.
 *
 * DB-ready: nothing outside this module touches the underlying Map.
 */

const ttlMs = config.sessionTtlMinutes * 60 * 1000;
const sessions = new Map<string, SessionData>();

function isExpired(s: SessionData, now: number): boolean {
  return now - s.updatedAt > ttlMs;
}

/** Create a brand-new session and return its data. */
export function createSession(): SessionData {
  const now = Date.now();
  const session: SessionData = {
    sessionId: randomUUID(),
    createdAt: now,
    updatedAt: now,
  };
  sessions.set(session.sessionId, session);
  return { ...session };
}

/** Fetch a session, refreshing its TTL. Returns `undefined` if missing/expired. */
export function getSession(sessionId: string): SessionData | undefined {
  const s = sessions.get(sessionId);
  if (!s) return undefined;
  const now = Date.now();
  if (isExpired(s, now)) {
    sessions.delete(sessionId);
    return undefined;
  }
  s.updatedAt = now;
  return { ...s };
}

/**
 * Get an existing live session by id, or create a fresh one if the id is
 * missing/unknown/expired. Always returns a usable session.
 */
export function getOrCreateSession(sessionId?: string): SessionData {
  if (sessionId) {
    const existing = getSession(sessionId);
    if (existing) return existing;
  }
  return createSession();
}

/** Merge a partial update into a session. No-op if the session is gone. */
export function updateSession(
  sessionId: string,
  patch: Partial<Omit<SessionData, 'sessionId' | 'createdAt'>>,
): SessionData | undefined {
  const s = sessions.get(sessionId);
  if (!s) return undefined;
  Object.assign(s, patch, { updatedAt: Date.now() });
  return { ...s };
}

/** Remove expired sessions. Returns the number swept. */
export function sweepSessions(): number {
  const now = Date.now();
  let removed = 0;
  for (const [id, s] of sessions) {
    if (isExpired(s, now)) {
      sessions.delete(id);
      removed += 1;
    }
  }
  return removed;
}

/** Current live session count (used by /api/health). */
export function sessionCount(): number {
  return sessions.size;
}

// Background sweep so memory is reclaimed even without traffic. `unref` keeps
// the timer from holding the process open during shutdown / tests.
const sweepTimer = setInterval(sweepSessions, Math.min(ttlMs, 5 * 60 * 1000));
sweepTimer.unref();
