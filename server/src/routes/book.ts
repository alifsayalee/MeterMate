import { Router, type Request, type Response } from 'express';
import { bookSchema } from '../schemas/book.js';
import { getConsultant } from '../data/consultants.js';
import { getOrCreateSession, updateSession } from '../stores/sessionStore.js';
import {
  countForPair,
  createTransaction,
  findChannelForPair,
  rememberChannel,
  setTransactionState,
  updateTransaction,
} from '../stores/transactionStore.js';
import { createSubscription, MaxioServiceError } from '../services/maxioService.js';
import { ensureTxnChannel, postBlocks } from '../services/slackService.js';
import {
  buildBookingProgress,
  buildFailure,
  buildSubscriptionActive,
} from '../services/slackBlocks.js';

export const bookRouter = Router();

/**
 * UC1 — Book & Subscribe.
 * Flow: validate → session/transaction → ensureTxnChannel (started) →
 * postProgress → Maxio createSubscription → completion/failure into the channel.
 *
 * Slack is notification only: its failures never roll back billing or block the
 * HTTP response (the billing action is the source of truth).
 */
bookRouter.post('/api/book', async (req: Request, res: Response) => {
  // 1. Validate before any external call.
  const parsed = bookSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      status: 'invalid',
      errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  const input = parsed.data;

  // 2. Resolve the consultant (seeded). Unknown id → 400 invalid.
  const consultant = getConsultant(input.consultantId);
  if (!consultant) {
    return res.status(400).json({
      status: 'invalid',
      errors: [{ path: 'consultantId', message: `unknown consultant "${input.consultantId}"` }],
    });
  }

  // 3. Live session + transaction record.
  const session = getOrCreateSession(input.sessionId);
  const clientName = `${input.firstName} ${input.lastName}`.trim();
  const txn = createTransaction({
    type: 'subscription',
    consultantId: consultant.id,
    clientEmail: input.email,
  });
  updateSession(session.sessionId, { lastTxnId: txn.txnId });

  // 4. Ensure the per-transaction Slack channel (create + invite, or reuse).
  const existingChannel = findChannelForPair(consultant.id, input.email);
  const channel = await ensureTxnChannel({
    consultant,
    clientName,
    clientEmail: input.email,
    transactionType: 'Booking & subscription',
    seq: countForPair(consultant.id, input.email),
    ...(existingChannel ? { existingChannel } : {}),
  });
  if (channel.channelId && channel.channelName) {
    rememberChannel(txn.txnId, consultant.id, input.email, {
      channelId: channel.channelId,
      channelName: channel.channelName,
    });
    // In-progress update.
    await postBlocks(
      channel.channelId,
      buildBookingProgress(input.productHandle),
      'Creating subscription…',
    );
  }

  // 5. Drive the billing operation.
  try {
    const result = await createSubscription({
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      productHandle: input.productHandle,
      collectionMethod: input.collectionMethod,
      ...(input.couponCode ? { couponCode: input.couponCode } : {}),
    });

    setTransactionState(txn.txnId, 'completed');
    updateTransaction(txn.txnId, {
      maxioSubscriptionId: result.subscriptionId,
      maxioCustomerId: result.customerId,
    });
    updateSession(session.sessionId, { lastResult: result });

    // Completion update into the channel.
    if (channel.channelId) {
      await postBlocks(
        channel.channelId,
        buildSubscriptionActive({ clientName, result }),
        'Subscription active',
      );
    }

    return res.status(200).json({
      status: 'ok',
      sessionId: session.sessionId,
      txnId: txn.txnId,
      channelId: channel.channelId,
      channelName: channel.channelName,
      notes: channel.notes,
      result,
    });
  } catch (error) {
    const summary =
      error instanceof MaxioServiceError ? error.message : 'Unexpected billing error';
    console.error('[uc1] createSubscription failed:', summary);
    setTransactionState(txn.txnId, 'failed', summary);

    if (channel.channelId) {
      await postBlocks(
        channel.channelId,
        buildFailure({ useCase: 'Booking', error: summary }),
        'Booking failed',
      );
    }

    return res.status(502).json({
      status: 'maxio_failed',
      sessionId: session.sessionId,
      txnId: txn.txnId,
      channelId: channel.channelId,
      channelName: channel.channelName,
      notes: channel.notes,
      error: summary,
    });
  }
});
