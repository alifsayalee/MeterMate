import { Router, type Request, type Response } from 'express';
import { planChangeSchema } from '../schemas/planChange.js';
import { getOrCreateSession, updateSession } from '../stores/sessionStore.js';
import { getTransaction } from '../stores/transactionStore.js';
import {
  applyPlanChange,
  previewPlanChange,
  MaxioServiceError,
} from '../services/maxioService.js';
import { postBlocks } from '../services/slackService.js';
import {
  buildFailure,
  buildPlanChanged,
  buildPlanChangePreview,
} from '../services/slackBlocks.js';
import type { TransactionRecord } from '../types.js';

export const planChangeRouter = Router();

/** Resolve a transaction that has an active subscription, or send a 409. */
function resolveTxn(
  req: Request,
  res: Response,
  sessionId: string,
): TransactionRecord | undefined {
  const txn = getTransaction(req.body.txnRef);
  if (!txn) {
    res.status(409).json({
      status: 'session_expired',
      sessionId,
      error: `Transaction "${req.body.txnRef}" not found. Start a booking first.`,
    });
    return undefined;
  }
  if (txn.maxioSubscriptionId === undefined) {
    res.status(409).json({
      status: 'session_expired',
      sessionId,
      txnId: txn.txnId,
      error: 'This transaction has no active subscription to change.',
    });
    return undefined;
  }
  return txn;
}

/**
 * UC3 (preview) — POST /api/plan-change/preview.
 * Computes the prorated cost of moving to the target plan now (no commit),
 * returns it to the UI, and posts the computed delta to the transaction channel.
 */
planChangeRouter.post('/api/plan-change/preview', async (req: Request, res: Response) => {
  const parsed = planChangeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      status: 'invalid',
      errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  const input = parsed.data;
  const session = getOrCreateSession(input.sessionId);

  const txn = resolveTxn(req, res, session.sessionId);
  if (!txn) return undefined;

  try {
    const preview = await previewPlanChange({
      subscriptionId: txn.maxioSubscriptionId!,
      targetHandle: input.targetHandle,
    });

    updateSession(session.sessionId, { lastTxnId: txn.txnId, lastResult: preview });

    if (txn.channelId) {
      await postBlocks(
        txn.channelId,
        buildPlanChangePreview({ targetHandle: input.targetHandle, timing: input.timing, preview }),
        'Plan change preview',
      );
    }

    return res.status(200).json({
      status: 'ok',
      sessionId: session.sessionId,
      txnId: txn.txnId,
      channelId: txn.channelId ?? null,
      channelName: txn.channelName ?? null,
      preview,
    });
  } catch (error) {
    const summary = error instanceof MaxioServiceError ? error.message : 'Unexpected billing error';
    console.error('[uc3] previewPlanChange failed:', summary);
    if (txn.channelId) {
      await postBlocks(txn.channelId, buildFailure({ useCase: 'Plan change preview', error: summary }), 'Plan change preview failed');
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

/**
 * UC3 (commit) — POST /api/plan-change.
 * `prorate` migrates now with proration (charging the delta immediately);
 * `at-renewal` schedules a non-prorated change for the next renewal. Posts the
 * old → new transition (with proration + effective date) to the channel.
 */
planChangeRouter.post('/api/plan-change', async (req: Request, res: Response) => {
  const parsed = planChangeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      status: 'invalid',
      errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  const input = parsed.data;
  const session = getOrCreateSession(input.sessionId);

  const txn = resolveTxn(req, res, session.sessionId);
  if (!txn) return undefined;
  const subscriptionId = txn.maxioSubscriptionId!;

  try {
    // For prorate, capture the proration the commit will apply (same mechanism)
    // so the completion message can show the amount charged.
    let paymentDueInCents: number | null = null;
    if (input.timing === 'prorate') {
      const preview = await previewPlanChange({ subscriptionId, targetHandle: input.targetHandle });
      paymentDueInCents = preview.paymentDueInCents;
    }

    const result = await applyPlanChange({
      subscriptionId,
      targetHandle: input.targetHandle,
      timing: input.timing,
    });
    if (paymentDueInCents !== null) result.paymentDueInCents = paymentDueInCents;

    updateSession(session.sessionId, { lastTxnId: txn.txnId, lastResult: result });

    if (txn.channelId) {
      await postBlocks(txn.channelId, buildPlanChanged({ result }), 'Plan changed');
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
    console.error('[uc3] applyPlanChange failed:', summary);
    if (txn.channelId) {
      await postBlocks(txn.channelId, buildFailure({ useCase: 'Plan change', error: summary }), 'Plan change failed');
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
