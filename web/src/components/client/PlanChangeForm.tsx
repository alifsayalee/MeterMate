import { useMemo, useState } from 'react';
import {
  commitPlanChange,
  previewPlanChange,
  type CommitResponse,
  type PlanChangeTiming,
  type PreviewResponse,
} from '../../api.js';
import { listRecentTxns } from '../../txns.js';

const PLANS = [
  { handle: 'basic', label: 'Basic — $99/mo' },
  { handle: 'pro', label: 'Pro — $299/mo' },
] as const;

const TIMINGS: Array<{ value: PlanChangeTiming; label: string }> = [
  { value: 'prorate', label: 'Prorate now (charge the delta immediately)' },
  { value: 'at-renewal', label: 'At next renewal (no proration)' },
];

const MANUAL = '__manual__';

const labelStyle: React.CSSProperties = { display: 'block', fontWeight: 600, marginBottom: 4, fontSize: 14 };
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', border: '1px solid #ccc', borderRadius: 6, fontSize: 14, boxSizing: 'border-box',
};
const fieldStyle: React.CSSProperties = { marginBottom: 14 };

function signedCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

/** UC3 — Plan Change with proration preview → confirm. */
export function PlanChangeForm() {
  const recent = useMemo(() => listRecentTxns(), []);

  const [selectedTxn, setSelectedTxn] = useState<string>(recent[0]?.txnId ?? MANUAL);
  const [manualTxn, setManualTxn] = useState('');
  const [targetHandle, setTargetHandle] = useState<string>(PLANS[1].handle); // default Pro (upgrade)
  const [timing, setTiming] = useState<PlanChangeTiming>('prorate');

  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [committing, setCommitting] = useState(false);
  const [committed, setCommitted] = useState<CommitResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const txnRef = selectedTxn === MANUAL ? manualTxn.trim() : selectedTxn;
  const canPreview = !previewing && !committing && txnRef !== '' && targetHandle !== '';

  /** Any input change invalidates a prior preview/commit. */
  function resetOutputs() {
    setPreview(null);
    setCommitted(null);
    setError(null);
  }

  async function onPreview(e: React.FormEvent) {
    e.preventDefault();
    setPreviewing(true);
    setPreview(null);
    setCommitted(null);
    setError(null);
    try {
      setPreview(await previewPlanChange({ txnRef, targetHandle, timing }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error previewing plan change');
    } finally {
      setPreviewing(false);
    }
  }

  async function onConfirm() {
    setCommitting(true);
    setError(null);
    try {
      setCommitted(await commitPlanChange({ txnRef, targetHandle, timing }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error committing plan change');
    } finally {
      setCommitting(false);
    }
  }

  const previewFieldErrors = useMemo(() => {
    const map: Record<string, string> = {};
    if (preview?.status === 'invalid') for (const e of preview.errors) map[e.path] = e.message;
    return map;
  }, [preview]);

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Change plan</h2>
      <p style={{ color: '#666', marginTop: 4 }}>
        Preview the prorated cost of switching plans, then confirm. The transaction's Slack channel
        gets both the preview and the result.
      </p>

      <form onSubmit={onPreview} noValidate>
        <div style={fieldStyle}>
          <label style={labelStyle} htmlFor="txn">Transaction</label>
          <select id="txn" style={inputStyle} value={selectedTxn} onChange={(e) => { setSelectedTxn(e.target.value); resetOutputs(); }}>
            {recent.map((t) => (
              <option key={t.txnId} value={t.txnId}>{t.label} ({t.txnId.slice(0, 8)}…)</option>
            ))}
            <option value={MANUAL}>Other — enter a transaction ID…</option>
          </select>
        </div>

        {selectedTxn === MANUAL && (
          <div style={fieldStyle}>
            <label style={labelStyle} htmlFor="manualTxn">Transaction ID</label>
            <input id="manualTxn" style={inputStyle} value={manualTxn} onChange={(e) => { setManualTxn(e.target.value); resetOutputs(); }} placeholder="paste the txnId from a booking" />
            {previewFieldErrors['txnRef'] && <small style={{ color: 'crimson' }}>{previewFieldErrors['txnRef']}</small>}
          </div>
        )}

        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ ...fieldStyle, flex: 1 }}>
            <label style={labelStyle} htmlFor="target">Target plan</label>
            <select id="target" style={inputStyle} value={targetHandle} onChange={(e) => { setTargetHandle(e.target.value); resetOutputs(); }}>
              {PLANS.map((p) => <option key={p.handle} value={p.handle}>{p.label}</option>)}
            </select>
          </div>
          <div style={{ ...fieldStyle, flex: 1 }}>
            <label style={labelStyle} htmlFor="timing">Timing</label>
            <select id="timing" style={inputStyle} value={timing} onChange={(e) => { setTiming(e.target.value as PlanChangeTiming); resetOutputs(); }}>
              {TIMINGS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
        </div>

        <button type="submit" disabled={!canPreview}
          style={{ padding: '10px 18px', fontSize: 15, fontWeight: 600, color: '#fff', background: canPreview ? '#2563eb' : '#9bb8f0', border: 'none', borderRadius: 6, cursor: canPreview ? 'pointer' : 'not-allowed' }}>
          {previewing ? 'Previewing…' : 'Preview change'}
        </button>
      </form>

      {error && <p style={{ color: 'crimson', marginTop: 16 }}>⚠ {error}</p>}

      {preview && <PreviewPanel preview={preview} timing={timing} committing={committing} committed={committed} onConfirm={onConfirm} />}
      {committed && <CommitPanel committed={committed} />}
    </div>
  );
}

function ErrorBox({ title, message, channelName }: { title: string; message: string; channelName?: string | null }) {
  return (
    <div style={{ marginTop: 20, padding: 16, border: '1px solid #f0c0c0', background: '#fdf3f3', borderRadius: 8 }}>
      <h3 style={{ marginTop: 0, color: 'crimson' }}>⚠ {title}</h3>
      <p style={{ margin: '6px 0' }}><strong>Reason:</strong> {message}</p>
      {channelName && <p style={{ margin: '6px 0', color: '#666' }}>A note was posted to <code>#{channelName}</code>.</p>}
    </div>
  );
}

function PreviewPanel({
  preview, timing, committing, committed, onConfirm,
}: {
  preview: PreviewResponse;
  timing: PlanChangeTiming;
  committing: boolean;
  committed: CommitResponse | null;
  onConfirm: () => void;
}) {
  if (preview.status === 'invalid') {
    return <div style={{ marginTop: 20, padding: 16, border: '1px solid #f0c0c0', background: '#fdf3f3', borderRadius: 8 }}><strong style={{ color: 'crimson' }}>Please fix the highlighted fields.</strong></div>;
  }
  if (preview.status === 'session_expired') {
    return <div style={{ marginTop: 20, padding: 16, border: '1px solid #f0d8a0', background: '#fdfaf0', borderRadius: 8 }}><h3 style={{ marginTop: 0, color: '#a07000' }}>⌛ Transaction unavailable</h3><p>{preview.error}</p></div>;
  }
  if (preview.status === 'maxio_failed') {
    return <ErrorBox title="Preview failed" message={preview.error} channelName={preview.channelName} />;
  }

  const p = preview.preview;
  return (
    <div style={{ marginTop: 20, padding: 16, border: '1px solid #cdd9f5', background: '#f5f8ff', borderRadius: 8 }}>
      <h3 style={{ marginTop: 0 }}>🔍 Plan change preview</h3>
      <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: 16, rowGap: 6, margin: 0 }}>
        <dt style={{ fontWeight: 600 }}>Target plan</dt><dd style={{ margin: 0 }}>{p.targetHandle}</dd>
        <dt style={{ fontWeight: 600 }}>New plan charge</dt><dd style={{ margin: 0 }}>{signedCents(p.chargeInCents)}</dd>
        <dt style={{ fontWeight: 600 }}>Prorated adjustment</dt><dd style={{ margin: 0 }}>{signedCents(p.proratedAdjustmentInCents)}</dd>
        <dt style={{ fontWeight: 600 }}>Credit applied</dt><dd style={{ margin: 0 }}>{signedCents(p.creditAppliedInCents)}</dd>
        <dt style={{ fontWeight: 600 }}>Due now</dt><dd style={{ margin: 0, fontWeight: 700 }}>{signedCents(p.paymentDueInCents)}</dd>
      </dl>
      <p style={{ color: '#666', fontSize: 13, marginTop: 10 }}>
        {timing === 'prorate'
          ? 'Confirming will change the plan now and charge the amount due immediately.'
          : 'You chose “at next renewal”: the plan changes at the next renewal with no proration (the figures above are the prorate-now preview).'}
      </p>
      {!committed && (
        <button onClick={onConfirm} disabled={committing}
          style={{ marginTop: 8, padding: '10px 18px', fontSize: 15, fontWeight: 600, color: '#fff', background: committing ? '#7aa86a' : '#2e7d32', border: 'none', borderRadius: 6, cursor: committing ? 'wait' : 'pointer' }}>
          {committing ? 'Confirming…' : `Confirm ${timing === 'prorate' ? 'change now' : 'change at renewal'}`}
        </button>
      )}
    </div>
  );
}

function CommitPanel({ committed }: { committed: CommitResponse }) {
  if (committed.status === 'invalid') {
    return <div style={{ marginTop: 20, padding: 16, border: '1px solid #f0c0c0', background: '#fdf3f3', borderRadius: 8 }}><strong style={{ color: 'crimson' }}>Please fix the highlighted fields.</strong></div>;
  }
  if (committed.status === 'session_expired') {
    return <div style={{ marginTop: 20, padding: 16, border: '1px solid #f0d8a0', background: '#fdfaf0', borderRadius: 8 }}><h3 style={{ marginTop: 0, color: '#a07000' }}>⌛ Transaction unavailable</h3><p>{committed.error}</p></div>;
  }
  if (committed.status === 'maxio_failed') {
    return <ErrorBox title="Plan change failed" message={committed.error} channelName={committed.channelName} />;
  }

  const r = committed.result;
  return (
    <div style={{ marginTop: 20, padding: 16, border: '1px solid #bfe3c6', background: '#f3fbf5', borderRadius: 8 }}>
      <h3 style={{ marginTop: 0 }}>🔄 Plan changed</h3>
      <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: 16, rowGap: 6, margin: 0 }}>
        <dt style={{ fontWeight: 600 }}>From</dt><dd style={{ margin: 0 }}>{r.oldPlanName}</dd>
        <dt style={{ fontWeight: 600 }}>To</dt><dd style={{ margin: 0 }}>{r.newPlanName}</dd>
        <dt style={{ fontWeight: 600 }}>Timing</dt><dd style={{ margin: 0 }}>{r.scheduled ? 'At next renewal (no proration)' : 'Prorated now'}</dd>
        <dt style={{ fontWeight: 600 }}>Effective</dt>
        <dd style={{ margin: 0 }}>{r.scheduled ? (r.effectiveDate ? new Date(r.effectiveDate).toLocaleString() : 'Next renewal') : 'Immediately'}</dd>
        <dt style={{ fontWeight: 600 }}>State</dt><dd style={{ margin: 0 }}>{r.state}</dd>
        {r.paymentDueInCents !== null && (<><dt style={{ fontWeight: 600 }}>Charged now</dt><dd style={{ margin: 0 }}>{signedCents(r.paymentDueInCents)}</dd></>)}
        <dt style={{ fontWeight: 600 }}>Slack channel</dt><dd style={{ margin: 0 }}>{committed.channelName ? `#${committed.channelName}` : '—'}</dd>
      </dl>
      <p style={{ marginTop: 12 }}><a href={r.maxioUrl} target="_blank" rel="noreferrer" style={{ color: '#2563eb' }}>View in Maxio →</a></p>
    </div>
  );
}
