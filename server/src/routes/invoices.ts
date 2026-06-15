import { Router, type Request, type Response } from 'express';
import { adminGuard } from '../auth.js';
import { invoiceSchema } from '../schemas/invoice.js';
import { getOrCreateSession, updateSession } from '../stores/sessionStore.js';
import { getTransaction } from '../stores/transactionStore.js';
import { issueInvoice, MaxioServiceError } from '../services/maxioService.js';
import { postBlocks } from '../services/slackService.js';
import { buildFailure, buildInvoiceIssued, buildInvoiceProgress } from '../services/slackBlocks.js';

export const invoicesRouter = Router();

/**
 * UC5 — Invoice Issue + Send (admin only).
 * Flow: adminGuard → validate → resolve transaction + channel → post progress →
 * create + issue invoice (optionally email it) → post the issued invoice with a
 * Pay Invoice button (hosted public URL) / failure.
 */
invoicesRouter.post('/api/invoices', adminGuard, async (req: Request, res: Response) => {
  const parsed = invoiceSchema.safeParse(req.body);
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
      error: 'This transaction has no subscription to invoice.',
    });
  }

  if (txn.channelId) {
    await postBlocks(txn.channelId, buildInvoiceProgress(), 'Issuing invoice…');
  }

  try {
    const result = await issueInvoice({
      subscriptionId: txn.maxioSubscriptionId,
      lineItems: input.lineItems,
      ...(input.memo ? { memo: input.memo } : {}),
      sendEmail: input.sendEmail,
      recipientEmail: txn.clientEmail,
    });

    updateSession(session.sessionId, { lastTxnId: txn.txnId, lastResult: result });

    if (txn.channelId) {
      await postBlocks(txn.channelId, buildInvoiceIssued({ result }), 'Invoice issued');
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
    console.error('[uc5] issueInvoice failed:', summary);
    if (txn.channelId) {
      await postBlocks(txn.channelId, buildFailure({ useCase: 'Invoice', error: summary }), 'Invoice failed');
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
