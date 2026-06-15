/**
 * Client-side admin credential handling (placeholder auth, mirrors the backend's
 * hardcoded-creds adminGuard). The operator enters credentials once; we keep
 * them for the session and send them as an HTTP Basic header on admin routes.
 * Stored in sessionStorage so they don't persist beyond the browser session.
 */

const KEY = 'metermate.adminCreds';

export interface AdminCreds {
  user: string;
  password: string;
}

export function getAdminCreds(): AdminCreds | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AdminCreds;
    return parsed.user ? parsed : null;
  } catch {
    return null;
  }
}

export function setAdminCreds(creds: AdminCreds): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(creds));
  } catch {
    // ignore storage failures
  }
}

export function clearAdminCreds(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

/** Build the `Authorization: Basic …` header value, or null if no creds set. */
export function basicAuthHeader(): string | null {
  const creds = getAdminCreds();
  if (!creds) return null;
  return `Basic ${btoa(`${creds.user}:${creds.password}`)}`;
}
