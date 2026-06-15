/**
 * Client-side session id handling. The backend creates a session on first call
 * and returns its id; we persist it in localStorage and send it on subsequent
 * calls so multi-step flows (later UCs) share server-side session state.
 */

const KEY = 'metermate.sessionId';

export function getSessionId(): string | undefined {
  try {
    return localStorage.getItem(KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function setSessionId(sessionId: string): void {
  try {
    localStorage.setItem(KEY, sessionId);
  } catch {
    // Ignore storage failures (private mode etc.) — the server will just mint a
    // fresh session each call.
  }
}
