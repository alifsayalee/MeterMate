import { useEffect, useMemo, useState } from 'react';
import {
  fetchConsultants,
  runDigest,
  type Consultant,
  type DigestResponse,
} from '../../api.js';

const labelStyle: React.CSSProperties = { display: 'block', fontWeight: 600, marginBottom: 4, fontSize: 14 };
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', border: '1px solid #ccc', borderRadius: 6, fontSize: 14, boxSizing: 'border-box',
};
const fieldStyle: React.CSSProperties = { marginBottom: 14 };

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** UC6 — admin Activity digest (per-consultant, manual trigger). */
export function ActivityPanel({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [consultants, setConsultants] = useState<Consultant[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [consultantId, setConsultantId] = useState('');
  const [windowDays, setWindowDays] = useState('30');

  const [submitting, setSubmitting] = useState(false);
  const [response, setResponse] = useState<DigestResponse | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchConsultants()
      .then((list) => {
        if (cancelled) return;
        setConsultants(list);
        if (list[0]) setConsultantId(list[0].id);
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Failed to load consultants');
      });
    return () => { cancelled = true; };
  }, []);

  const windowNum = Number(windowDays);
  const windowValid = windowDays.trim() === '' || (Number.isInteger(windowNum) && windowNum > 0 && windowNum <= 365);
  const canSubmit = !submitting && consultantId !== '' && windowValid;

  const fieldErrors = useMemo(() => {
    const map: Record<string, string> = {};
    if (response?.status === 'invalid') for (const e of response.errors) map[e.path] = e.message;
    return map;
  }, [response]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setResponse(null);
    setSubmitError(null);
    try {
      const res = await runDigest({
        consultantId,
        ...(windowDays.trim() ? { windowDays: windowNum } : {}),
      });
      setResponse(res);
      if (res.status === 'unauthorized') onUnauthorized();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Unexpected error building digest');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Billing activity digest</h2>
      <p style={{ color: '#666', marginTop: 4 }}>
        Build a per-consultant summary from live Maxio data and post it to the consultant's digest
        channel.
      </p>

      {loadError && <p style={{ color: 'crimson' }}>⚠ Could not load consultants: {loadError}</p>}

      <form onSubmit={onSubmit} noValidate>
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ ...fieldStyle, flex: 2 }}>
            <label style={labelStyle} htmlFor="consultant">Consultant</label>
            <select id="consultant" style={inputStyle} value={consultantId} onChange={(e) => setConsultantId(e.target.value)}>
              {consultants.length === 0 && <option value="">Loading…</option>}
              {consultants.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {fieldErrors['consultantId'] && <small style={{ color: 'crimson' }}>{fieldErrors['consultantId']}</small>}
          </div>
          <div style={{ ...fieldStyle, flex: 1 }}>
            <label style={labelStyle} htmlFor="window">Window (days)</label>
            <input id="window" style={inputStyle} type="number" min="1" max="365" value={windowDays} onChange={(e) => setWindowDays(e.target.value)} />
            {!windowValid && <small style={{ color: 'crimson' }}>1–365</small>}
          </div>
        </div>

        <button type="submit" disabled={!canSubmit}
          style={{ padding: '10px 18px', fontSize: 15, fontWeight: 600, color: '#fff', background: canSubmit ? '#2563eb' : '#9bb8f0', border: 'none', borderRadius: 6, cursor: canSubmit ? 'pointer' : 'not-allowed' }}>
          {submitting ? 'Building…' : 'Build digest'}
        </button>
      </form>

      {submitError && <p style={{ color: 'crimson', marginTop: 16 }}>⚠ {submitError}</p>}
      {response && <ResultPanel response={response} />}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: 12, border: '1px solid #e0eadf', borderRadius: 8, background: '#fff', textAlign: 'center' }}>
      <div style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: 12, color: '#666' }}>{label}</div>
    </div>
  );
}

function ResultPanel({ response }: { response: DigestResponse }) {
  if (response.status === 'unauthorized') {
    return <div style={{ marginTop: 20, padding: 16, border: '1px solid #f0d8a0', background: '#fdfaf0', borderRadius: 8 }}><h3 style={{ marginTop: 0, color: '#a07000' }}>🔒 Session expired</h3><p style={{ margin: '6px 0' }}>Please sign in again.</p></div>;
  }
  if (response.status === 'invalid') {
    return <div style={{ marginTop: 20, padding: 16, border: '1px solid #f0c0c0', background: '#fdf3f3', borderRadius: 8 }}><strong style={{ color: 'crimson' }}>Please fix the highlighted fields.</strong></div>;
  }
  if (response.status === 'maxio_failed') {
    return <div style={{ marginTop: 20, padding: 16, border: '1px solid #f0c0c0', background: '#fdf3f3', borderRadius: 8 }}><h3 style={{ marginTop: 0, color: 'crimson' }}>⚠ Digest failed</h3><p style={{ margin: '6px 0' }}><strong>Reason:</strong> {response.error}</p></div>;
  }

  const d = response.digest;
  return (
    <div style={{ marginTop: 20, padding: 16, border: '1px solid #bfe3c6', background: '#f3fbf5', borderRadius: 8 }}>
      <h3 style={{ marginTop: 0 }}>📈 Billing digest — {d.consultantName}</h3>
      <p style={{ color: '#666', marginTop: 0, fontSize: 13 }}>Last {d.windowDays} days · posted to {response.channelName ? <code>#{response.channelName}</code> : 'the digest channel'}</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        <Metric label="Active subs" value={String(d.activeCount)} />
        <Metric label="MRR" value={`${formatCents(d.mrrInCents)}/mo`} />
        <Metric label="Total subs" value={String(d.totalSubscriptions)} />
        <Metric label="New signups" value={String(d.newSignups)} />
        <Metric label="Churned" value={String(d.churned)} />
        <Metric label="Overdue invoices" value={String(d.overdueInvoices)} />
      </div>
      {response.notes.length > 0 && (
        <ul style={{ marginTop: 10, color: '#7a6', fontSize: 13 }}>{response.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
      )}
      <p style={{ marginTop: 10, color: '#999', fontSize: 12 }}>
        ℹ Reporting data is for reconciliation, not real-time confirmation — counts may lag live state slightly.
      </p>
    </div>
  );
}
