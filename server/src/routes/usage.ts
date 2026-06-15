import { Router, type Request, type Response } from 'express';
import { usageSchema } from '../schemas/usage.js';
import { getOrCreateSession, updateSession } from '../stores/sessionStore.js';
import { getTransaction } from '../stores/transactionStore.js';
import { recordUsage, MaxioServiceError } from '../services/maxioService.js';
import { postBlocks } from '../services/slackService.js';
import { buildFailure, buildUsageProgress, buildUsageRecorded } from '../services/slackBlocks.js';

export const usageRouter = Router();

/**
 * UC2 — Report Session Usage.
 * Flow: validate → resolve the existing transaction + its channel → post
 * progress → maxio recordUsage (dispatches on component kind) → completion /
 * failure into the channel.
 *
 * No new channel is created; UC2 reuses the transaction's channel from UC1.
 * Slack remains notification-only and never blocks the billing result.
 */
usageRouter.post('/api/usage', async (req: Request, res: Response) => {
  // 1. Validate before any external call.
  const parsed = usageSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      status: 'invalid',
      errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  const input = parsed.data;
  const session = getOrCreateSession(input.sessionId);

  // 2. Resolve the existing transaction and its active subscription.
  const txn = getTransaction(input.txnRef);
  if (!txn) {
    return res.status(409).json({
      status: 'session_expired',
      sessionId: session.sessionId,
      error: `Transaction "${input.txnRef}" not found. Start a booking first.`,
    });
  }
  if (txn.maxioSubscriptionId === undefined) {
    return res.status(409).json({
      status: 'session_expired',
      sessionId: session.sessionId,
      txnId: txn.txnId,
      error: 'This transaction has no active subscription to record usage against.',
    });
  }

  // 3. Progress update into the (reused) transaction channel.
  if (txn.channelId) {
    await postBlocks(txn.channelId, buildUsageProgress(input.componentHandle), 'Recording usage…');
  }

  // 4. Record the usage.
  try {
    const result = await recordUsage({
      subscriptionId: txn.maxioSubscriptionId,
      componentHandle: input.componentHandle,
      quantity: input.quantity,
      ...(input.memo ? { memo: input.memo } : {}),
      ...(input.timestamp ? { timestamp: input.timestamp } : {}),
    });

    updateSession(session.sessionId, { lastTxnId: txn.txnId, lastResult: result });

    if (txn.channelId) {
      await postBlocks(txn.channelId, buildUsageRecorded({ result }), 'Usage recorded');
    }

    return res.status(200).json({
      status: 'ok',
      sessionId: session.sessionId,
      txnId: txn.txnId,
      channelId: txn.channelId ?? null,
      channelName: txn.channelName ?? null,
      result,
    });
  } catch (error) {
    const summary = error instanceof MaxioServiceError ? error.message : 'Unexpected billing error';
    console.error('[uc2] recordUsage failed:', summary);

    if (txn.channelId) {
      await postBlocks(txn.channelId, buildFailure({ useCase: 'Usage', error: summary }), 'Usage failed');
    }

    return res.status(502).json({
      status: 'maxio_failed',
      sessionId: session.sessionId,
      txnId: txn.txnId,
      channelId: txn.channelId ?? null,
      channelName: txn.channelName ?? null,
      error: summary,
    });
  }
});
