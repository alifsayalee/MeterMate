import { useEffect, useState } from 'react';

interface HealthResponse {
  status: string;
  sessions: number;
  transactions: number;
  maxioSite: string | null;
  maxioConfigured: boolean;
  slackConfigured: boolean;
}

/**
 * Phase 0 shell. Confirms the SPA builds, serves on :5173, and can reach the
 * Express API through the Vite proxy. Per-use-case forms are added slice by
 * slice in later phases.
 */
export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/health')
      .then((r) => {
        if (!r.ok) throw new Error(`Health check returned ${r.status}`);
        return r.json() as Promise<HealthResponse>;
      })
      .then((data) => {
        if (!cancelled) setHealth(data);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Unknown error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 640, margin: '4rem auto', padding: '0 1rem' }}>
      <h1>MeterMate</h1>
      <p style={{ color: '#666' }}>Maxio + Slack billing concierge — channel-per-transaction.</p>
      <section style={{ marginTop: '2rem', padding: '1rem', border: '1px solid #ddd', borderRadius: 8 }}>
        <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Backend health</h2>
        {error && <p style={{ color: 'crimson' }}>⚠ {error}</p>}
        {!error && !health && <p>Checking…</p>}
        {health && (
          <ul style={{ lineHeight: 1.8 }}>
            <li>Status: <strong>{health.status}</strong></li>
            <li>Sessions: {health.sessions}</li>
            <li>Transactions: {health.transactions}</li>
            <li>Maxio site: {health.maxioSite ?? '—'}</li>
            <li>Maxio configured: {health.maxioConfigured ? 'yes' : 'no'}</li>
            <li>Slack configured: {health.slackConfigured ? 'yes' : 'no'}</li>
          </ul>
        )}
      </section>
    </main>
  );
}
