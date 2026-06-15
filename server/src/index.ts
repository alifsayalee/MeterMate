import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import { config } from './config.js';

const app = express();

app.use(cors());
app.use(express.json());

/**
 * Health check (Phase 0). Reports liveness plus a snapshot of in-memory state
 * and which external integrations are configured. Slack/Maxio reachability
 * probes are added in their respective phases; for now we report config presence.
 */
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    sessions: 0,
    transactions: 0,
    maxioSite: config.maxio.siteSubdomain ?? null,
    maxioConfigured: Boolean(config.maxio.apiKey && config.maxio.siteSubdomain),
    slackConfigured: Boolean(config.slack.botToken),
  });
});

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
