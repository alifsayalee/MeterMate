import { useMemo, useState } from 'react';
import {
  controlLifecycle,
  type CancelType,
  type LifecycleAction,
  type LifecycleResponse,
} from '../../api.js';
import { listRecentTxns } from '../../txns.js';

const ACTIONS: Array<{ value: LifecycleAction; label: string }> = [
  { value: 'pause', label: 'Pause (put on hold)' },
  { value: 'resume', label: 'Resume (from hold)' },
  { value: 'cancel', label: 'Cancel' },
  { value: 'reactivate', label: 'Reactivate (canceled)' },
];

const CANCEL_TYPES: Array<{ value: CancelType; label: string }> = [
  { value: 'immediate', label: 'Immediately' },
  { value: 'end-of-period', label: 'At end of current period' },
];

const MANUAL = '__manual__';

const labelStyle: React.CSSProperties = { display: 'block', fontWeight: 600, marginBottom: 4, fontSize: 14 };
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', border: '1px solid #ccc', borderRadius: 6, fontSize: 14, boxSizing: 'border-box',
};
const fieldStyle: React.CSSProperties = { marginBottom: 14 };

/** UC4 — Lifecycle Control (pause / resume / cancel / reactivate). */
export function LifecycleForm() {
  const recent = useMemo(() => listRecentTxns(), []);

  const [selectedTxn, setSelectedTxn] = useState<string>(recent[0]?.txnId ?? MANUAL);
  const [manualTxn, setManualTxn] = useState('');
  const [action, setAction] = useState<LifecycleAction>('pause');
  const [cancelType, setCancelType] = useState<CancelType>('immediate');
  const [reasonCode, setReasonCode] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [response, setResponse] = useState<LifecycleResponse | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const txnRef = selectedTxn === MANUAL ? manualTxn.trim() : selectedTxn;
  const isCancel = action === 'cancel';
  const canSubmit = !submitting && txnRef !== '';

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setResponse(null);
    setSubmitError(null);
    try {
      const res = await controlLifecycle({
        txnRef,
        action,
        ...(isCancel ? { cancelType } : {}),
        ...(isCancel && reasonCode.trim() ? { reasonCode: reasonCode.trim() } : {}),
      });
      setResponse(res);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Unexpected error running lifecycle action');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Lifecycle control</h2>
      <p style={{ color: '#666', marginTop: 4 }}>
        Pause, resume, cancel, or reactivate a subscription. The transaction's Slack channel shows
        the state transition.
      </p>

      <form onSubmit={onSubmit} noValidate>
        <div style={fieldStyle}>
          <label style={labelStyle} htmlFor="txn">Transaction</label>
          <select id="txn" style={inputStyle} value={selectedTxn} onChange={(e) => { setSelectedTxn(e.target.value); setResponse(null); }}>
            {recent.map((t) => (
              <option key={t.txnId} value={t.txnId}>{t.label} ({t.txnId.slice(0, 8)}…)</option>
            ))}
            <option value={MANUAL}>Other — enter a transaction ID…</option>
          </select>
        </div>

        {selectedTxn === MANUAL && (
          <div style={fieldStyle}>
            <label style={labelStyle} htmlFor="manualTxn">Transaction ID</label>
            <input id="manualTxn" style={inputStyle} value={manualTxn} onChange={(e) => { setManualTxn(e.target.value); setResponse(null); }} placeholder="paste the txnId from a booking" />
          </div>
        )}

        <div style={fieldStyle}>
          <label style={labelStyle} htmlFor="action">Action</label>
          <select id="action" style={inputStyle} value={action} onChange={(e) => { setAction(e.target.value as LifecycleAction); setResponse(null); }}>
            {ACTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        </div>

        {isCancel && (
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ ...fieldStyle, flex: 1 }}>
              <label style={labelStyle} htmlFor="cancelType">Cancellation timing</label>
              <select id="cancelType" style={inputStyle} value={cancelType} onChange={(e) => { setCancelType(e.target.value as CancelType); setResponse(null); }}>
                {CANCEL_TYPES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div style={{ ...fieldStyle, flex: 1 }}>
              <label style={labelStyle} htmlFor="reason">Reason code <span style={{ fontWeight: 400, color: '#999' }}>(optional)</span></label>
              <input id="reason" style={inputStyle} value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} placeholder="e.g. too_expensive" />
            </div>
          </div>
        )}

        <button type="submit" disabled={!canSubmit}
          style={{ padding: '10px 18px', fontSize: 15, fontWeight: 600, color: '#fff', background: canSubmit ? '#2563eb' : '#9bb8f0', border: 'none', borderRadius: 6, cursor: canSubmit ? 'pointer' : 'not-allowed' }}>
          {submitting ? 'Working…' : 'Run action'}
        </button>
      </form>

      {submitError && <p style={{ color: 'crimson', marginTop: 16 }}>⚠ {submitError}</p>}
      {response && <ResultPanel response={response} />}
    </div>
  );
}

function ResultPanel({ response }: { response: LifecycleResponse }) {
  if (response.status === 'invalid') {
    return <div style={{ marginTop: 20, padding: 16, border: '1px solid #f0c0c0', background: '#fdf3f3', borderRadius: 8 }}><strong style={{ color: 'crimson' }}>Please fix the highlighted fields.</strong></div>;
  }
  if (response.status === 'session_expired') {
    return <div style={{ marginTop: 20, padding: 16, border: '1px solid #f0d8a0', background: '#fdfaf0', borderRadius: 8 }}><h3 style={{ marginTop: 0, color: '#a07000' }}>⌛ Transaction unavailable</h3><p style={{ margin: '6px 0' }}>{response.error}</p></div>;
  }
  if (response.status === 'maxio_failed') {
    return (
      <div style={{ marginTop: 20, padding: 16, border: '1px solid #f0c0c0', background: '#fdf3f3', borderRadius: 8 }}>
        <h3 style={{ marginTop: 0, color: 'crimson' }}>⚠ Action failed</h3>
        <p style={{ margin: '6px 0' }}><strong>Reason:</strong> {response.error}</p>
        {response.channelName && <p style={{ margin: '6px 0', color: '#666' }}>A note was posted to <code>#{response.channelName}</code>.</p>}
      </div>
    );
  }

  const r = response.result;
  return (
    <div style={{ marginTop: 20, padding: 16, border: '1px solid #bfe3c6', background: '#f3fbf5', borderRadius: 8 }}>
      <h3 style={{ marginTop: 0 }}>🚦 {r.previousState} → {r.newState}</h3>
      <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: 16, rowGap: 6, margin: 0 }}>
        <dt style={{ fontWeight: 600 }}>Action</dt><dd style={{ margin: 0 }}>{r.action}</dd>
        <dt style={{ fontWeight: 600 }}>State</dt><dd style={{ margin: 0 }}>{r.previousState} → {r.newState}</dd>
        {r.action === 'cancel' && (
          <>
            <dt style={{ fontWeight: 600 }}>Cancellation</dt>
            <dd style={{ margin: 0 }}>{r.cancelAtEndOfPeriod ? 'At end of period' : 'Immediate'}</dd>
          </>
        )}
        {r.effectiveDate && (<><dt style={{ fontWeight: 600 }}>Effective</dt><dd style={{ margin: 0 }}>{new Date(r.effectiveDate).toLocaleString()}</dd></>)}
        {r.reasonCode && (<><dt style={{ fontWeight: 600 }}>Reason</dt><dd style={{ margin: 0 }}>{r.reasonCode}</dd></>)}
        <dt style={{ fontWeight: 600 }}>Slack channel</dt><dd style={{ margin: 0 }}>{response.channelName ? `#${response.channelName}` : '—'}</dd>
      </dl>
      <p style={{ marginTop: 12 }}><a href={r.maxioUrl} target="_blank" rel="noreferrer" style={{ color: '#2563eb' }}>View in Maxio →</a></p>
    </div>
  );
}
