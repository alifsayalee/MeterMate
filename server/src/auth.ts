import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { config } from './config.js';

/**
 * Hardcoded operator identity (env-configured) + an Express guard for admin-only
 * routes (UC5/UC6). This is explicitly a placeholder for real auth (OAuth/JWT);
 * the seam is isolated here so swapping it later touches nothing else.
 *
 * Credentials are passed via HTTP Basic auth (`Authorization: Basic …`).
 */

/** Constant-time string comparison (hash first so unequal lengths don't leak). */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

function parseBasicAuth(header: string | undefined): { user: string; pass: string } | null {
  if (!header || !header.startsWith('Basic ')) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
  } catch {
    return null;
  }
  const sep = decoded.indexOf(':');
  if (sep === -1) return null;
  return { user: decoded.slice(0, sep), pass: decoded.slice(sep + 1) };
}

/** Express middleware: allow the request only for the configured admin. */
export function adminGuard(req: Request, res: Response, next: NextFunction): void {
  const creds = parseBasicAuth(req.headers.authorization);
  if (
    creds &&
    safeEqual(creds.user, config.admin.user) &&
    safeEqual(creds.pass, config.admin.password)
  ) {
    next();
    return;
  }
  res.status(401).json({ status: 'unauthorized', error: 'Admin credentials required' });
}
