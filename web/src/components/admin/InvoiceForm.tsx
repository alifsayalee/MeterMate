import { useMemo, useState } from 'react';
import { issueInvoice, type InvoiceLineItem, type InvoiceResponse } from '../../api.js';
import { listRecentTxns } from '../../txns.js';

const MANUAL = '__manual__';

const labelStyle: React.CSSProperties = { display: 'block', fontWeight: 600, marginBottom: 4, fontSize: 14 };
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', border: '1px solid #ccc', borderRadius: 6, fontSize: 14, boxSizing: 'border-box',
};
const fieldStyle: React.CSSProperties = { marginBottom: 14 };

interface Row { title: string; quantity: string; unitPrice: string }

const emptyRow = (): Row => ({ title: '', quantity: '1', unitPrice: '' });

/** UC5 — admin issues + (optionally) emails an ad-hoc invoice. */
export function InvoiceForm({ onUnauthorized }: { onUnauthorized: () => void }) {
  const recent = useMemo(() => listRecentTxns(), []);

  const [selectedTxn, setSelectedTxn] = useState<string>(recent[0]?.txnId ?? MANUAL);
  const [manualTxn, setManualTxn] = useState('');
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [memo, setMemo] = useState('');
  const [sendEmail, setSendEmail] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [response, setResponse] = useState<InvoiceResponse | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const txnRef = selectedTxn === MANUAL ? manualTxn.trim() : selectedTxn;

  const lineItems: InvoiceLineItem[] = rows
    .map((r) => ({ title: r.title.trim(), quantity: Number(r.quantity), unitPrice: Number(r.unitPrice) }))
    .filter((li) => li.title !== '' && Number.isFinite(li.quantity) && li.quantity > 0 && Number.isFinite(li.unitPrice) && li.unitPrice >= 0);

  const total = lineItems.reduce((sum, li) => sum + li.quantity * li.unitPrice, 0);
  const canSubmit = !submitting && txnRef !== '' && lineItems.length > 0;

  function updateRow(idx: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }
  function addRow() { setRows((prev) => [...prev, emptyRow()]); }
  function removeRow(idx: number) { setRows((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev)); }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setResponse(null);
    setSubmitError(null);
    try {
      const res = await issueInvoice({ txnRef, lineItems, ...(memo.trim() ? { memo: memo.trim() } : {}), sendEmail });
      setResponse(res);
      if (res.status === 'unauthorized') onUnauthorized();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Unexpected error issuing invoice');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Issue invoice</h2>
      <p style={{ color: '#666', marginTop: 4 }}>
        Create an itemized invoice for a transaction's subscription, issue it, and optionally email
        it. A “Pay Invoice” link is posted to the transaction's Slack channel.
      </p>

      <form onSubmit={onSubmit} noValidate>
        <div style={fieldStyle}>
          <label style={labelStyle} htmlFor="txn">Transaction</label>
          <select id="txn" style={inputStyle} value={selectedTxn} onChange={(e) => { setSelectedTxn(e.target.value); setResponse(null); }}>
            {recent.map((t) => <option key={t.txnId} value={t.txnId}>{t.label} ({t.txnId.slice(0, 8)}…)</option>)}
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
          <label style={labelStyle}>Line items</label>
          {rows.map((r, idx) => (
            <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
              <input style={{ ...inputStyle, flex: 3 }} placeholder="Title" value={r.title} onChange={(e) => updateRow(idx, { title: e.target.value })} />
              <input style={{ ...inputStyle, flex: 1 }} type="number" min="0" step="any" placeholder="Qty" value={r.quantity} onChange={(e) => updateRow(idx, { quantity: e.target.value })} />
              <input style={{ ...inputStyle, flex: 1 }} type="number" min="0" step="any" placeholder="Unit $" value={r.unitPrice} onChange={(e) => updateRow(idx, { unitPrice: e.target.value })} />
              <button type="button" onClick={() => removeRow(idx)} disabled={rows.length === 1} title="Remove"
                style={{ padding: '6px 10px', border: '1px solid #ddd', borderRadius: 6, background: '#fff', cursor: rows.length === 1 ? 'not-allowed' : 'pointer' }}>✕</button>
            </div>
          ))}
          <button type="button" onClick={addRow} style={{ padding: '6px 12px', border: '1px solid #2563eb', color: '#2563eb', background: '#fff', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>+ Add line item</button>
          <div style={{ marginTop: 8, color: '#444', fontSize: 14 }}>Total: <strong>${total.toFixed(2)}</strong></div>
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle} htmlFor="memo">Memo <span style={{ fontWeight: 400, color: '#999' }}>(optional)</span></label>
          <input id="memo" style={inputStyle} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="e.g. Thanks for your business" />
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, fontSize: 14 }}>
          <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />
          Email the invoice to the customer
        </label>

        <button type="submit" disabled={!canSubmit}
          style={{ padding: '10px 18px', fontSize: 15, fontWeight: 600, color: '#fff', background: canSubmit ? '#2563eb' : '#9bb8f0', border: 'none', borderRadius: 6, cursor: canSubmit ? 'pointer' : 'not-allowed' }}>
          {submitting ? 'Issuing…' : 'Issue invoice'}
        </button>
      </form>

      {submitError && <p style={{ color: 'crimson', marginTop: 16 }}>⚠ {submitError}</p>}
      {response && <ResultPanel response={response} />}
    </div>
  );
}

function ResultPanel({ response }: { response: InvoiceResponse }) {
  if (response.status === 'unauthorized') {
    return <div style={{ marginTop: 20, padding: 16, border: '1px solid #f0d8a0', background: '#fdfaf0', borderRadius: 8 }}><h3 style={{ marginTop: 0, color: '#a07000' }}>🔒 Session expired</h3><p style={{ margin: '6px 0' }}>Please sign in again.</p></div>;
  }
  if (response.status === 'invalid') {
    return <div style={{ marginTop: 20, padding: 16, border: '1px solid #f0c0c0', background: '#fdf3f3', borderRadius: 8 }}><strong style={{ color: 'crimson' }}>Please fix the highlighted fields.</strong><ul>{response.errors.map((e, i) => <li key={i}>{e.path}: {e.message}</li>)}</ul></div>;
  }
  if (response.status === 'session_expired') {
    return <div style={{ marginTop: 20, padding: 16, border: '1px solid #f0d8a0', background: '#fdfaf0', borderRadius: 8 }}><h3 style={{ marginTop: 0, color: '#a07000' }}>⌛ Transaction unavailable</h3><p style={{ margin: '6px 0' }}>{response.error}</p></div>;
  }
  if (response.status === 'maxio_failed') {
    return (
      <div style={{ marginTop: 20, padding: 16, border: '1px solid #f0c0c0', background: '#fdf3f3', borderRadius: 8 }}>
        <h3 style={{ marginTop: 0, color: 'crimson' }}>⚠ Invoice failed</h3>
        <p style={{ margin: '6px 0' }}><strong>Reason:</strong> {response.error}</p>
        {response.channelName && <p style={{ margin: '6px 0', color: '#666' }}>A note was posted to <code>#{response.channelName}</code>.</p>}
      </div>
    );
  }

  const r = response.result;
  return (
    <div style={{ marginTop: 20, padding: 16, border: '1px solid #bfe3c6', background: '#f3fbf5', borderRadius: 8 }}>
      <h3 style={{ marginTop: 0 }}>🧾 Invoice issued</h3>
      <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: 16, rowGap: 6, margin: 0 }}>
        <dt style={{ fontWeight: 600 }}>Invoice</dt><dd style={{ margin: 0 }}>{r.invoiceNumber ?? r.invoiceUid}</dd>
        <dt style={{ fontWeight: 600 }}>Amount due</dt><dd style={{ margin: 0 }}>${r.dueAmount}</dd>
        <dt style={{ fontWeight: 600 }}>Due date</dt><dd style={{ margin: 0 }}>{r.dueDate ?? 'on issue'}</dd>
        <dt style={{ fontWeight: 600 }}>Status</dt><dd style={{ margin: 0 }}>{r.status}</dd>
        <dt style={{ fontWeight: 600 }}>Emailed</dt><dd style={{ margin: 0 }}>{r.emailed ? `yes → ${r.recipientEmail}` : 'no'}</dd>
        <dt style={{ fontWeight: 600 }}>Slack channel</dt><dd style={{ margin: 0 }}>{response.channelName ? `#${response.channelName}` : '—'}</dd>
      </dl>
      {r.publicUrl && (
        <p style={{ marginTop: 12 }}>
          <a href={r.publicUrl} target="_blank" rel="noreferrer"
            style={{ display: 'inline-block', padding: '8px 16px', background: '#2e7d32', color: '#fff', borderRadius: 6, textDecoration: 'none', fontWeight: 600 }}>
            Pay Invoice →
          </a>
        </p>
      )}
    </div>
  );
}
