import { Router, type Request, type Response } from 'express';
import { lifecycleSchema } from '../schemas/lifecycle.js';
import { getOrCreateSession, updateSession } from '../stores/sessionStore.js';
import { getTransaction } from '../stores/transactionStore.js';
import { controlLifecycle, MaxioServiceError } from '../services/maxioService.js';
import { postBlocks } from '../services/slackService.js';
import { buildFailure, buildLifecycleDone, buildLifecycleProgress } from '../services/slackBlocks.js';

export const lifecycleRouter = Router();

const ACTION_LABEL: Record<string, string> = {
  pause: 'Pause',
  resume: 'Resume',
  cancel: 'Cancellation',
  reactivate: 'Reactivation',
};

/**
 * UC4 — Lifecycle Control (pause / resume / cancel / reactivate).
 * Flow: validate → resolve transaction + channel → post progress → dispatch to
 * the matching Maxio lifecycle operation → post the state transition / failure.
 */
lifecycleRouter.post('/api/lifecycle', async (req: Request, res: Response) => {
  const parsed = lifecycleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      status: 'invalid',
      errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  const input = parsed.data;
  const session = getOrCreateSession(input.sessionId);

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
      error: 'This transaction has no subscription to control.',
    });
  }

  if (txn.channelId) {
    await postBlocks(
      txn.channelId,
      buildLifecycleProgress(ACTION_LABEL[input.action] ?? input.action),
      `${input.action} in progress`,
    );
  }

  try {
    const result = await controlLifecycle({
      subscriptionId: txn.maxioSubscriptionId,
      action: input.action,
      ...(input.cancelType ? { cancelType: input.cancelType } : {}),
      ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}),
    });

    updateSession(session.sessionId, { lastTxnId: txn.txnId, lastResult: result });

    if (txn.channelId) {
      await postBlocks(txn.channelId, buildLifecycleDone({ result }), `${result.previousState} → ${result.newState}`);
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
    console.error('[uc4] controlLifecycle failed:', summary);
    if (txn.channelId) {
      await postBlocks(txn.channelId, buildFailure({ useCase: ACTION_LABEL[input.action] ?? 'Lifecycle', error: summary }), 'Lifecycle action failed');
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
