import * as path from 'node:path';
import * as fs from 'node:fs';
import * as dotenv from 'dotenv';

/**
 * Typed environment loader. Reads the repo-root `.env` (one level up from
 * `server/`) once at module load and exposes a frozen, validated config object.
 *
 * Fail-fast philosophy: required secrets are validated lazily per subsystem
 * (Maxio / Slack) so the scaffold and `/api/health` boot even before every
 * credential is filled in — but reading a missing required value throws a clear
 * error rather than silently passing `undefined` to an SDK.
 */

const repoRoot = path.resolve(process.cwd(), '..');
const envPath = path.resolve(repoRoot, '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath, override: false });
}
// Also honour a server-local .env if present (does not override repo-root).
const localEnvPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(localEnvPath)) {
  dotenv.config({ path: localEnvPath, override: false });
}

function optional(key: string): string | undefined {
  const v = process.env[key];
  return v === undefined || v.trim() === '' ? undefined : v.trim();
}

function withDefault(key: string, fallback: string): string {
  return optional(key) ?? fallback;
}

function intWithDefault(key: string, fallback: number): number {
  const raw = optional(key);
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) {
    throw new Error(`Config error: ${key}="${raw}" is not a valid integer`);
  }
  return n;
}

export type MaxioEnvironment = 'US' | 'EU';

function parseMaxioEnvironment(): MaxioEnvironment {
  const raw = withDefault('MAXIO_ENVIRONMENT', 'US').toUpperCase();
  if (raw !== 'US' && raw !== 'EU') {
    throw new Error(`Config error: MAXIO_ENVIRONMENT must be "US" or "EU", got "${raw}"`);
  }
  return raw;
}

export const config = Object.freeze({
  port: intWithDefault('PORT', 4000),
  sessionTtlMinutes: intWithDefault('SESSION_TTL_MINUTES', 30),
  demoMode: withDefault('DEMO_MODE', 'true').toLowerCase() === 'true',
  digestCron: withDefault('DIGEST_CRON', '0 9 * * 1'),

  maxio: Object.freeze({
    apiKey: optional('MAXIO_API_KEY'),
    apiPassword: withDefault('MAXIO_API_PASSWORD', 'x'),
    siteSubdomain: optional('MAXIO_SITE_SUBDOMAIN'),
    environment: parseMaxioEnvironment(),
    defaultProductFamily: optional('MAXIO_DEFAULT_PRODUCT_FAMILY'),
  }),

  slack: Object.freeze({
    botToken: optional('SLACK_BOT_TOKEN'),
    digestChannel: optional('SLACK_DIGEST_CHANNEL'),
  }),

  admin: Object.freeze({
    user: withDefault('ADMIN_USER', 'admin'),
    password: withDefault('ADMIN_PASSWORD', 'changeme'),
  }),
});

/** Throws unless every Maxio credential needed to construct a client is present. */
export function requireMaxioConfig(): {
  apiKey: string;
  apiPassword: string;
  siteSubdomain: string;
  environment: MaxioEnvironment;
} {
  const { apiKey, apiPassword, siteSubdomain, environment } = config.maxio;
  if (!apiKey) throw new Error('Config error: MAXIO_API_KEY is required');
  if (!siteSubdomain) throw new Error('Config error: MAXIO_SITE_SUBDOMAIN is required');
  return { apiKey, apiPassword, siteSubdomain, environment };
}

/** Throws unless the Slack bot token is present. */
export function requireSlackConfig(): { botToken: string } {
  const { botToken } = config.slack;
  if (!botToken) throw new Error('Config error: SLACK_BOT_TOKEN is required');
  return { botToken };
}
