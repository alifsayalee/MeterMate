import { useMemo, useState } from 'react';
import { recordUsage, type UsageResponse } from '../../api.js';
import { listRecentTxns } from '../../txns.js';

/** Seeded metered components available for usage reporting. */
const COMPONENTS = [
  { handle: 'consulting-time', label: 'Consulting Time — $2.00/minute' },
] as const;

const MANUAL = '__manual__';

const labelStyle: React.CSSProperties = { display: 'block', fontWeight: 600, marginBottom: 4, fontSize: 14 };
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid #ccc',
  borderRadius: 6,
  fontSize: 14,
  boxSizing: 'border-box',
};
const fieldStyle: React.CSSProperties = { marginBottom: 14 };

/** UC2 — Report Session Usage (client/consultant form). */
export function UsageForm() {
  const recent = useMemo(() => listRecentTxns(), []);

  const [selectedTxn, setSelectedTxn] = useState<string>(recent[0]?.txnId ?? MANUAL);
  const [manualTxn, setManualTxn] = useState('');
  const [componentHandle, setComponentHandle] = useState<string>(COMPONENTS[0].handle);
  const [quantity, setQuantity] = useState('');
  const [memo, setMemo] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [response, setResponse] = useState<UsageResponse | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const txnRef = selectedTxn === MANUAL ? manualTxn.trim() : selectedTxn;
  const quantityNum = Number(quantity);
  const quantityValid = quantity.trim() !== '' && Number.isFinite(quantityNum) && quantityNum > 0;
  const canSubmit = !submitting && txnRef !== '' && quantityValid;

  const fieldErrors = useMemo(() => {
    const map: Record<string, string> = {};
    if (response?.status === 'invalid') {
      for (const e of response.errors) map[e.path] = e.message;
    }
    return map;
  }, [response]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setResponse(null);
    setSubmitError(null);
    try {
      const res = await recordUsage({
        txnRef,
        componentHandle,
        quantity: quantityNum,
        ...(memo.trim() ? { memo: memo.trim() } : {}),
      });
      setResponse(res);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Unexpected error recording usage');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Report session usage</h2>
      <p style={{ color: '#666', marginTop: 4 }}>
        Record consumption against an existing booking. Maxio rates it and accrues it to the next
        invoice; the transaction's Slack channel gets a live update.
      </p>

      <form onSubmit={onSubmit} noValidate>
        <div style={fieldStyle}>
          <label style={labelStyle} htmlFor="txn">Transaction</label>
          <select id="txn" style={inputStyle} value={selectedTxn} onChange={(e) => setSelectedTxn(e.target.value)}>
            {recent.map((t) => (
              <option key={t.txnId} value={t.txnId}>
                {t.label} ({t.txnId.slice(0, 8)}…)
              </option>
            ))}
            <option value={MANUAL}>Other — enter a transaction ID…</option>
          </select>
          {recent.length === 0 && (
            <small style={{ color: '#999' }}>No recent bookings on this device — enter a transaction ID below.</small>
          )}
        </div>

        {selectedTxn === MANUAL && (
          <div style={fieldStyle}>
            <label style={labelStyle} htmlFor="manualTxn">Transaction ID</label>
            <input id="manualTxn" style={inputStyle} value={manualTxn} onChange={(e) => setManualTxn(e.target.value)} placeholder="paste the txnId from a booking" />
            {fieldErrors['txnRef'] && <small style={{ color: 'crimson' }}>{fieldErrors['txnRef']}</small>}
          </div>
        )}

        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ ...fieldStyle, flex: 2 }}>
            <label style={labelStyle} htmlFor="component">Component</label>
            <select id="component" style={inputStyle} value={componentHandle} onChange={(e) => setComponentHandle(e.target.value)}>
              {COMPONENTS.map((c) => (
                <option key={c.handle} value={c.handle}>{c.label}</option>
              ))}
            </select>
          </div>
          <div style={{ ...fieldStyle, flex: 1 }}>
            <label style={labelStyle} htmlFor="quantity">Quantity</label>
            <input
              id="quantity"
              style={inputStyle}
              type="number"
              min="0"
              step="any"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="e.g. 30"
            />
            {fieldErrors['quantity'] && <small style={{ color: 'crimson' }}>{fieldErrors['quantity']}</small>}
          </div>
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle} htmlFor="memo">Memo <span style={{ fontWeight: 400, color: '#999' }}>(optional)</span></label>
          <input id="memo" style={inputStyle} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="e.g. Kickoff call" />
        </div>

        <button
          type="submit"
          disabled={!canSubmit}
          style={{
            padding: '10px 18px',
            fontSize: 15,
            fontWeight: 600,
            color: '#fff',
            background: canSubmit ? '#2563eb' : '#9bb8f0',
            border: 'none',
            borderRadius: 6,
            cursor: canSubmit ? 'pointer' : 'not-allowed',
          }}
        >
          {submitting ? 'Recording…' : 'Record usage'}
        </button>
      </form>

      {submitError && <p style={{ color: 'crimson', marginTop: 16 }}>⚠ {submitError}</p>}
      {response && <ResultPanel response={response} />}
    </div>
  );
}

function ResultPanel({ response }: { response: UsageResponse }) {
  if (response.status === 'invalid') {
    return (
      <div style={{ marginTop: 20, padding: 16, border: '1px solid #f0c0c0', background: '#fdf3f3', borderRadius: 8 }}>
        <strong style={{ color: 'crimson' }}>Please fix the highlighted fields.</strong>
      </div>
    );
  }

  if (response.status === 'session_expired') {
    return (
      <div style={{ marginTop: 20, padding: 16, border: '1px solid #f0d8a0', background: '#fdfaf0', borderRadius: 8 }}>
        <h3 style={{ marginTop: 0, color: '#a07000' }}>⌛ Transaction unavailable</h3>
        <p style={{ margin: '6px 0' }}>{response.error}</p>
      </div>
    );
  }

  if (response.status === 'maxio_failed') {
    return (
      <div style={{ marginTop: 20, padding: 16, border: '1px solid #f0c0c0', background: '#fdf3f3', borderRadius: 8 }}>
        <h3 style={{ marginTop: 0, color: 'crimson' }}>⚠ Usage not recorded</h3>
        <p style={{ margin: '6px 0' }}><strong>Reason:</strong> {response.error}</p>
        {response.channelName && (
          <p style={{ margin: '6px 0', color: '#666' }}>A failure note was posted to <code>#{response.channelName}</code>.</p>
        )}
      </div>
    );
  }

  const r = response.result;
  const unit = r.unitName ?? 'units';
  return (
    <div style={{ marginTop: 20, padding: 16, border: '1px solid #bfe3c6', background: '#f3fbf5', borderRadius: 8 }}>
      <h3 style={{ marginTop: 0 }}>✅ Usage recorded</h3>
      <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: 16, rowGap: 6, margin: 0 }}>
        <dt style={{ fontWeight: 600 }}>Component</dt><dd style={{ margin: 0 }}>{r.componentHandle}</dd>
        <dt style={{ fontWeight: 600 }}>Recorded</dt><dd style={{ margin: 0 }}>{r.recordedQuantity} {unit}</dd>
        <dt style={{ fontWeight: 600 }}>Period total</dt>
        <dd style={{ margin: 0 }}>{r.periodTotal === null ? 'n/a (event-based)' : `${r.periodTotal} ${unit}`}</dd>
        {r.memo && (<><dt style={{ fontWeight: 600 }}>Memo</dt><dd style={{ margin: 0 }}>{r.memo}</dd></>)}
        <dt style={{ fontWeight: 600 }}>Slack channel</dt>
        <dd style={{ margin: 0 }}>{response.channelName ? `#${response.channelName}` : '—'}</dd>
      </dl>
      <p style={{ marginTop: 12, color: '#7a6', fontSize: 13 }}>Accrues to the next invoice.</p>
    </div>
  );
}
