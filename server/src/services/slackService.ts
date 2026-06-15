import type { ApiResponse } from 'slack-apimatic-sdk';
import { requireSlackConfig } from '../config.js';
import { authApi, chatApi, conversationsApi } from '../slackClient.js';
import type { Consultant } from '../types.js';
import {
  buildEmailFallbackNote,
  buildTransactionStarted,
  type SlackBlock,
} from './slackBlocks.js';

/**
 * Slack notification service. Implements the channel-per-transaction mechanism:
 * lookup → create → tiered invite, with channel reuse. Every method is failure-
 * isolated: Slack problems are logged and surfaced in the return value but NEVER
 * thrown, because billing is the source of truth and Slack is only notification.
 *
 * Response handling note: this SDK models Slack's `ok` field as a string while
 * Slack returns a boolean, so the SDK's schema validation rejects even valid
 * responses (throwing ResponseValidationError). The raw JSON body is reliably
 * present on both success and error, so `slackCall` parses that directly and we
 * read Slack's real snake_case fields from it.
 */

interface SlackResult {
  ok: boolean;
  /** Parsed raw Slack JSON (snake_case), or null if unparseable. */
  data: Record<string, unknown> | null;
  /** Slack error code (e.g. "users_not_found", "name_taken") if any. */
  error: string | null;
}

function token(): string {
  return requireSlackConfig().botToken;
}

function parseBody(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw === 'string' && raw.length > 0) {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

function toResult(data: Record<string, unknown> | null): SlackResult {
  return {
    ok: data !== null && data['ok'] === true,
    data,
    error: typeof data?.['error'] === 'string' ? (data['error'] as string) : null,
  };
}

/** Invoke a Slack SDK call, tolerating the SDK's `ok`-type schema mismatch by
 * reading the raw JSON body. Never throws — returns a normalized SlackResult. */
async function slackCall(
  label: string,
  fn: () => Promise<ApiResponse<unknown>>,
): Promise<SlackResult> {
  try {
    const res = await fn();
    return toResult(parseBody(res.body) ?? parseBody(res.result));
  } catch (err) {
    const body = (err as { body?: unknown })?.body;
    const parsed = parseBody(body);
    if (parsed) return toResult(parsed);
    console.error(`[slack] ${label} failed:`, err instanceof Error ? err.message : err);
    return { ok: false, data: null, error: 'request_failed' };
  }
}

const SLACK_API_BASE = 'https://slack.com/api';

/**
 * Call a Slack **GET** method with the bot token in the `Authorization: Bearer`
 * header. Why bypass the SDK here: this SDK routes GET-method tokens through the
 * URL query string (`req.query('token', …)`), and Slack rejects tokens supplied
 * in query strings with `invalid_auth` (verified against the live API). The
 * affected GETs we use are `users.lookupByEmail` and `conversations.list`; all
 * POST methods (create/invite/postMessage) and `auth.test` use the token header
 * correctly and stay on the SDK. Never throws — returns a normalized SlackResult.
 */
async function slackApiGet(
  method: string,
  params: Record<string, string | number | boolean | undefined>,
): Promise<SlackResult> {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) qs.set(key, String(value));
  }
  const url = `${SLACK_API_BASE}/${method}?${qs.toString()}`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token()}` } });
    const json = (await res.json()) as Record<string, unknown>;
    return toResult(json);
  } catch (err) {
    console.error(`[slack] ${method} request failed:`, err instanceof Error ? err.message : err);
    return { ok: false, data: null, error: 'request_failed' };
  }
}

function readNested(data: Record<string, unknown> | null, outer: string, inner: string): string | undefined {
  const obj = data?.[outer];
  if (obj && typeof obj === 'object' && inner in obj) {
    const v = (obj as Record<string, unknown>)[inner];
    return typeof v === 'string' ? v : undefined;
  }
  return undefined;
}

/** Sanitize into a Slack-legal channel slug: lowercase, [a-z0-9-], trimmed. */
function slug(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 21) || 'x'
  );
}

/** Build a deterministic, length-capped channel name for a transaction. */
export function buildChannelName(consultantId: string, clientEmail: string, seq: number): string {
  const local = clientEmail.split('@')[0] ?? clientEmail;
  return `txn-${slug(consultantId)}-${slug(local)}-${seq}`.slice(0, 80);
}

/** Verify the bot token works (used by /api/health). Never throws. */
export async function slackHealthCheck(): Promise<boolean> {
  const res = await slackCall('auth.test', () => authApi().authTest(token()));
  return res.ok;
}

/** Resolve a workspace email to a user id, or `null` if not a member. */
async function lookupUserId(email: string): Promise<string | null> {
  const res = await slackApiGet('users.lookupByEmail', { email });
  if (!res.ok) {
    console.warn(`[slack] users.lookupByEmail("${email}") → not a member (slack error: ${res.error ?? 'unknown'})`);
    return null;
  }
  const userId = readNested(res.data, 'user', 'id') ?? null;
  console.log(`[slack] users.lookupByEmail("${email}") → user ${userId ?? '(no id in response)'}`);
  return userId;
}

/** Find an existing private channel by exact name (name_taken → reuse). */
async function findChannelByName(
  name: string,
): Promise<{ channelId: string; channelName: string } | null> {
  let cursor: string | undefined;
  for (let page = 0; page < 10; page += 1) {
    const res = await slackApiGet('conversations.list', {
      types: 'private_channel',
      limit: 200,
      exclude_archived: true,
      cursor,
    });
    if (!res.ok) return null;
    const channels = res.data?.['channels'];
    if (Array.isArray(channels)) {
      for (const ch of channels) {
        if (ch && typeof ch === 'object' && (ch as Record<string, unknown>)['name'] === name) {
          const id = (ch as Record<string, unknown>)['id'];
          if (typeof id === 'string') return { channelId: id, channelName: name };
        }
      }
    }
    const meta = res.data?.['response_metadata'];
    cursor =
      meta && typeof meta === 'object'
        ? ((meta as Record<string, unknown>)['next_cursor'] as string | undefined)
        : undefined;
    if (!cursor) break;
  }
  return null;
}

export interface EnsureChannelInput {
  consultant: Consultant;
  clientName: string;
  clientEmail: string;
  transactionType: string;
  /** Sequence number for this consultant↔client pair (for the channel name). */
  seq: number;
  /** Existing channel for this pair, if already known (channel reuse). */
  existingChannel?: { channelId: string; channelName: string };
}

export interface EnsureChannelResult {
  channelId: string | null;
  channelName: string | null;
  /** Whether the channel was created now (false = reused). */
  created: boolean;
  /** Human-readable notes (e.g. email-fallback for a non-member party). */
  notes: string[];
}

/**
 * Ensure a private channel exists for this transaction: reuse if known, else
 * create + tier-by-tier invite both parties, then post the "started" banner.
 * Never throws.
 */
export async function ensureTxnChannel(input: EnsureChannelInput): Promise<EnsureChannelResult> {
  const notes: string[] = [];

  // 1. Reuse a known channel for this pair.
  if (input.existingChannel) {
    return {
      channelId: input.existingChannel.channelId,
      channelName: input.existingChannel.channelName,
      created: false,
      notes,
    };
  }

  const desiredName = buildChannelName(input.consultant.id, input.clientEmail, input.seq);

  // 2. Create the private channel (treat name_taken as reuse).
  let channelId: string | null = null;
  let channelName = desiredName;
  const created = await slackCall('conversations.create', () =>
    conversationsApi().conversationsCreate(token(), desiredName, true),
  );
  if (created.ok) {
    channelId = readNested(created.data, 'channel', 'id') ?? null;
    channelName = readNested(created.data, 'channel', 'name') ?? desiredName;
    console.log(`[slack] conversations.create "${desiredName}" → channel ${channelId}`);
  } else {
    console.warn(`[slack] conversations.create "${desiredName}" not ok (error: ${created.error ?? 'unknown'}); looking up existing`);
    const reused = await findChannelByName(desiredName);
    if (reused) {
      channelId = reused.channelId;
      channelName = reused.channelName;
      console.log(`[slack] reusing existing channel ${channelId} ("${channelName}")`);
    }
  }

  if (!channelId) {
    notes.push('Slack channel could not be created; updates will not be posted.');
    return { channelId: null, channelName: null, created: false, notes };
  }

  // 3. Tiered invite: resolve each party; invite members, note email-fallback.
  const consultantUserId = await lookupUserId(input.consultant.email);
  if (!consultantUserId) {
    notes.push(`Consultant ${input.consultant.name} notified by email (not a workspace member).`);
  }
  const clientUserId = await lookupUserId(input.clientEmail);
  if (!clientUserId) {
    notes.push(`Client ${input.clientName} notified by email (not a workspace member).`);
  }

  const inviteIds = [consultantUserId, clientUserId].filter((id): id is string => Boolean(id));
  if (inviteIds.length > 0) {
    console.log(`[slack] conversations.invite → channel ${channelId}, users [${inviteIds.join(', ')}]`);
    const invited = await slackCall('conversations.invite', () =>
      conversationsApi().conversationsInvite(token(), channelId!, inviteIds.join(',')),
    );
    if (invited.ok) {
      console.log(`[slack] invite ok for channel ${channelId}`);
    } else {
      console.warn(`[slack] conversations.invite not ok (error: ${invited.error ?? 'unknown'})`);
      notes.push('One or more invites could not be completed; parties notified by email.');
    }
  } else {
    console.log('[slack] no workspace members resolved to invite (both parties via email)');
  }

  // 4. Post the channel-opened banner (+ any email-fallback notes).
  await postBlocks(
    channelId,
    buildTransactionStarted({
      consultantName: input.consultant.name,
      clientName: input.clientName,
      type: input.transactionType,
    }),
    'Transaction started',
  );
  if (!clientUserId) {
    await postBlocks(channelId, buildEmailFallbackNote(input.clientName), 'Client notified by email');
  }

  return { channelId, channelName, created: true, notes };
}

/** Per-consultant digest channel cache (id by consultant id), for reuse. */
const digestChannels = new Map<string, { channelId: string; channelName: string }>();

export interface DigestChannelResult {
  channelId: string | null;
  channelName: string | null;
  notes: string[];
}

/**
 * UC6 — ensure a per-consultant digest channel (`digest-<consultant>`): reuse if
 * known, else create the private channel and invite the consultant. The digest
 * is posted here (not in any transaction channel). Never throws.
 */
export async function ensureDigestChannel(consultant: Consultant): Promise<DigestChannelResult> {
  const notes: string[] = [];
  const cached = digestChannels.get(consultant.id);
  if (cached) return { ...cached, notes };

  const desiredName = `digest-${slug(consultant.id)}`.slice(0, 80);

  let channelId: string | null = null;
  let channelName = desiredName;
  const created = await slackCall('conversations.create', () =>
    conversationsApi().conversationsCreate(token(), desiredName, true),
  );
  if (created.ok) {
    channelId = readNested(created.data, 'channel', 'id') ?? null;
    channelName = readNested(created.data, 'channel', 'name') ?? desiredName;
    console.log(`[slack] digest channel created "${desiredName}" → ${channelId}`);
  } else {
    const reused = await findChannelByName(desiredName);
    if (reused) {
      channelId = reused.channelId;
      channelName = reused.channelName;
      console.log(`[slack] reusing digest channel ${channelId} ("${channelName}")`);
    }
  }

  if (!channelId) {
    notes.push('Digest channel could not be created.');
    return { channelId: null, channelName: null, notes };
  }

  // Invite the consultant if they're a workspace member.
  const consultantUserId = await lookupUserId(consultant.email);
  if (consultantUserId) {
    const invited = await slackCall('conversations.invite', () =>
      conversationsApi().conversationsInvite(token(), channelId!, consultantUserId),
    );
    if (!invited.ok && invited.error !== 'already_in_channel') {
      notes.push(`Consultant ${consultant.name} could not be invited (${invited.error ?? 'unknown'}).`);
    }
  } else {
    notes.push(`Consultant ${consultant.name} is not a workspace member; digest visible to the bot only.`);
  }

  const result = { channelId, channelName };
  digestChannels.set(consultant.id, result);
  return { ...result, notes };
}

/**
 * Post a Block Kit message to a channel. Returns true on success. Never throws —
 * a failed post is logged but does not affect the billing result.
 */
export async function postBlocks(
  channelId: string,
  blocks: SlackBlock[],
  fallbackText: string,
): Promise<boolean> {
  const res = await slackCall('chat.postMessage', () =>
    chatApi().chatPostMessage(
      token(),
      channelId,
      undefined, // asUser
      undefined, // attachments
      JSON.stringify(blocks), // blocks (JSON string per SDK contract)
      undefined, // iconEmoji
      undefined, // iconUrl
      undefined, // linkNames
      undefined, // mrkdwn
      undefined, // parse
      undefined, // replyBroadcast
      fallbackText, // text fallback for notifications/accessibility
    ),
  );
  if (!res.ok) {
    console.error('[slack] chat.postMessage not ok for', channelId, '-', res.error);
  }
  return res.ok;
}
