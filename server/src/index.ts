import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import { config } from './config.js';
import { sessionCount } from './stores/sessionStore.js';
import { transactionCount } from './stores/transactionStore.js';
import { slackHealthCheck } from './services/slackService.js';
import { bookRouter } from './routes/book.js';
import { usageRouter } from './routes/usage.js';
import { planChangeRouter } from './routes/planChange.js';
import { lifecycleRouter } from './routes/lifecycle.js';
import { invoicesRouter } from './routes/invoices.js';
import { metaRouter } from './routes/meta.js';

const app = express();

app.use(cors());
app.use(express.json());

/**
 * Health check. Reports liveness, a snapshot of in-memory state, and external
 * integration status. The Slack probe (auth.test) only runs when a token is
 * configured, so health stays fast and green before Slack is wired up.
 */
app.get('/api/health', async (_req: Request, res: Response) => {
  const slackOk = config.slack.botToken ? await slackHealthCheck() : false;
  res.json({
    status: 'ok',
    sessions: sessionCount(),
    transactions: transactionCount(),
    maxioSite: config.maxio.siteSubdomain ?? null,
    maxioConfigured: Boolean(config.maxio.apiKey && config.maxio.siteSubdomain),
    slackConfigured: Boolean(config.slack.botToken),
    slackOk,
  });
});

// Use-case routes (mounted as built, slice by slice).
app.use(metaRouter);
app.use(bookRouter);
app.use(usageRouter);
app.use(planChangeRouter);
app.use(lifecycleRouter);
app.use(invoicesRouter);

// Centralised error handler — never leak stack traces to clients.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = err instanceof Error ? err.message : 'Unexpected error';
  console.error('[unhandled]', err);
  res.status(500).json({ status: 'error', message });
});

const server = app.listen(config.port, () => {
  console.log(`[metermate] API listening on http://localhost:${config.port}`);
  console.log(`[metermate] health: http://localhost:${config.port}/api/health`);
});

// Graceful shutdown so dev reloads / Ctrl-C don't leave a dangling port.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`[metermate] received ${signal}, shutting down`);
    server.close(() => process.exit(0));
  });
}

export { app };
