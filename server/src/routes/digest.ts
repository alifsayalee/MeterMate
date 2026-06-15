import { Router, type Request, type Response } from 'express';
import { adminGuard } from '../auth.js';
import { digestSchema } from '../schemas/digest.js';
import { getConsultant } from '../data/consultants.js';
import { getOrCreateSession, updateSession } from '../stores/sessionStore.js';
import { subscriptionIdsForConsultant } from '../stores/transactionStore.js';
import { buildDigest, MaxioServiceError } from '../services/maxioService.js';
import { ensureDigestChannel, postBlocks } from '../services/slackService.js';
import { buildDigest as buildDigestBlocks, buildFailure } from '../services/slackBlocks.js';

export const digestRouter = Router();

const DEFAULT_WINDOW_DAYS = 30;

/**
 * UC6 — Billing Activity Digest (admin only, per-consultant).
 * Flow: adminGuard → validate → resolve consultant + their subscription ids
 * (from the transaction store) → aggregate live Maxio data → post the digest to
 * the consultant's own digest channel. Per-consultant, not per-transaction.
 */
digestRouter.post('/api/digest', adminGuard, async (req: Request, res: Response) => {
  const parsed = digestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      status: 'invalid',
      errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  const input = parsed.data;
  const session = getOrCreateSession(input.sessionId);

  const consultant = getConsultant(input.consultantId);
  if (!consultant) {
    return res.status(400).json({
      status: 'invalid',
      errors: [{ path: 'consultantId', message: `unknown consultant "${input.consultantId}"` }],
    });
  }

  const windowDays = input.windowDays ?? DEFAULT_WINDOW_DAYS;
  const subscriptionIds = subscriptionIdsForConsultant(consultant.id);

  try {
    const digest = await buildDigest({
      consultantId: consultant.id,
      consultantName: consultant.name,
      subscriptionIds,
      windowDays,
    });

    updateSession(session.sessionId, { lastResult: digest });

    // Post to the consultant's own digest channel (created/reused).
    const channel = await ensureDigestChannel(consultant);
    if (channel.channelId) {
      await postBlocks(channel.channelId, buildDigestBlocks({ result: digest }), 'Billing digest');
    }

    return res.status(200).json({
      status: 'ok',
      sessionId: session.sessionId,
      channelId: channel.channelId,
      channelName: channel.channelName,
      notes: channel.notes,
      digest,
    });
  } catch (error) {
    const summary = error instanceof MaxioServiceError ? error.message : 'Unexpected billing error';
    console.error('[uc6] buildDigest failed:', summary);
    // Best-effort failure note to the digest channel.
    const channel = await ensureDigestChannel(consultant);
    if (channel.channelId) {
      await postBlocks(channel.channelId, buildFailure({ useCase: 'Billing digest', error: summary }), 'Digest failed');
    }
    return res.status(502).json({
      status: 'maxio_failed',
      sessionId: session.sessionId,
      error: summary,
    });
  }
});
