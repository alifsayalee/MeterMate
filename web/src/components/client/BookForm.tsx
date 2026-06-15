import { useEffect, useMemo, useState } from 'react';
import {
  book,
  fetchConsultants,
  type BookResponse,
  type CollectionMethod,
  type Consultant,
} from '../../api.js';

/** The two seeded plans (Phase-1 seed). Labels mirror the Maxio products. */
const PLANS = [
  { handle: 'basic', label: 'Basic — $99/mo' },
  { handle: 'pro', label: 'Pro — $299/mo' },
] as const;

const COLLECTION_METHODS: Array<{ value: CollectionMethod; label: string }> = [
  { value: 'automatic', label: 'Automatic' },
  { value: 'remittance', label: 'Remittance (invoice)' },
];

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

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

/** UC1 — Book & Subscribe (client self-serve form). */
export function BookForm() {
  const [consultants, setConsultants] = useState<Consultant[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [consultantId, setConsultantId] = useState('');
  const [productHandle, setProductHandle] = useState<string>(PLANS[0].handle);
  const [collectionMethod, setCollectionMethod] = useState<CollectionMethod>('remittance');
  const [couponCode, setCouponCode] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [response, setResponse] = useState<BookResponse | null>(null);
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
    return () => {
      cancelled = true;
    };
  }, []);

  const fieldErrors = useMemo(() => {
    const map: Record<string, string> = {};
    if (response?.status === 'invalid') {
      for (const e of response.errors) map[e.path] = e.message;
    }
    return map;
  }, [response]);

  const canSubmit =
    !submitting &&
    firstName.trim() !== '' &&
    lastName.trim() !== '' &&
    email.trim() !== '' &&
    consultantId !== '';

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setResponse(null);
    setSubmitError(null);
    try {
      const res = await book({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        consultantId,
        productHandle,
        collectionMethod,
        ...(couponCode.trim() ? { couponCode: couponCode.trim() } : {}),
      });
      setResponse(res);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Unexpected error submitting booking');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Book a session &amp; subscribe</h2>
      <p style={{ color: '#666', marginTop: 4 }}>
        Pick a consultant and a plan. We'll create your subscription and open a private Slack
        channel for the transaction.
      </p>

      {loadError && (
        <p style={{ color: 'crimson' }}>⚠ Could not load consultants: {loadError}</p>
      )}

      <form onSubmit={onSubmit} noValidate>
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ ...fieldStyle, flex: 1 }}>
            <label style={labelStyle} htmlFor="firstName">First name</label>
            <input id="firstName" style={inputStyle} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            {fieldErrors['firstName'] && <small style={{ color: 'crimson' }}>{fieldErrors['firstName']}</small>}
          </div>
          <div style={{ ...fieldStyle, flex: 1 }}>
            <label style={labelStyle} htmlFor="lastName">Last name</label>
            <input id="lastName" style={inputStyle} value={lastName} onChange={(e) => setLastName(e.target.value)} />
            {fieldErrors['lastName'] && <small style={{ color: 'crimson' }}>{fieldErrors['lastName']}</small>}
          </div>
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle} htmlFor="email">Email</label>
          <input id="email" type="email" style={inputStyle} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          {fieldErrors['email'] && <small style={{ color: 'crimson' }}>{fieldErrors['email']}</small>}
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle} htmlFor="consultant">Consultant</label>
          <select id="consultant" style={inputStyle} value={consultantId} onChange={(e) => setConsultantId(e.target.value)}>
            {consultants.length === 0 && <option value="">Loading…</option>}
            {consultants.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          {fieldErrors['consultantId'] && <small style={{ color: 'crimson' }}>{fieldErrors['consultantId']}</small>}
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ ...fieldStyle, flex: 1 }}>
            <label style={labelStyle} htmlFor="plan">Plan</label>
            <select id="plan" style={inputStyle} value={productHandle} onChange={(e) => setProductHandle(e.target.value)}>
              {PLANS.map((p) => (
                <option key={p.handle} value={p.handle}>{p.label}</option>
              ))}
            </select>
          </div>
          <div style={{ ...fieldStyle, flex: 1 }}>
            <label style={labelStyle} htmlFor="collection">Payment collection</label>
            <select id="collection" style={inputStyle} value={collectionMethod} onChange={(e) => setCollectionMethod(e.target.value as CollectionMethod)}>
              {COLLECTION_METHODS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle} htmlFor="coupon">Coupon code <span style={{ fontWeight: 400, color: '#999' }}>(optional)</span></label>
          <input id="coupon" style={inputStyle} value={couponCode} onChange={(e) => setCouponCode(e.target.value)} />
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
          {submitting ? 'Booking…' : 'Book & subscribe'}
        </button>
      </form>

      {submitError && <p style={{ color: 'crimson', marginTop: 16 }}>⚠ {submitError}</p>}

      {response && <ResultPanel response={response} />}
    </div>
  );
}

function ResultPanel({ response }: { response: BookResponse }) {
  if (response.status === 'invalid') {
    return (
      <div style={{ marginTop: 20, padding: 16, border: '1px solid #f0c0c0', background: '#fdf3f3', borderRadius: 8 }}>
        <strong style={{ color: 'crimson' }}>Please fix the highlighted fields.</strong>
      </div>
    );
  }

  if (response.status === 'maxio_failed') {
    return (
      <div style={{ marginTop: 20, padding: 16, border: '1px solid #f0c0c0', background: '#fdf3f3', borderRadius: 8 }}>
        <h3 style={{ marginTop: 0, color: 'crimson' }}>⚠ Booking failed</h3>
        <p style={{ margin: '6px 0' }}><strong>Reason:</strong> {response.error}</p>
        {response.channelName && (
          <p style={{ margin: '6px 0', color: '#666' }}>A failure note was posted to <code>#{response.channelName}</code>.</p>
        )}
      </div>
    );
  }

  const r = response.result;
  return (
    <div style={{ marginTop: 20, padding: 16, border: '1px solid #bfe3c6', background: '#f3fbf5', borderRadius: 8 }}>
      <h3 style={{ marginTop: 0 }}>🎉 Subscription active</h3>
      <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: 16, rowGap: 6, margin: 0 }}>
        <dt style={{ fontWeight: 600 }}>Plan</dt><dd style={{ margin: 0 }}>{r.planName}</dd>
        <dt style={{ fontWeight: 600 }}>MRR</dt><dd style={{ margin: 0 }}>{formatCents(r.mrrInCents)}/mo</dd>
        <dt style={{ fontWeight: 600 }}>State</dt><dd style={{ margin: 0 }}>{r.state}</dd>
        <dt style={{ fontWeight: 600 }}>Collection</dt><dd style={{ margin: 0 }}>{r.collectionMethod}</dd>
        <dt style={{ fontWeight: 600 }}>Next bill</dt>
        <dd style={{ margin: 0 }}>{r.nextAssessmentAt ? new Date(r.nextAssessmentAt).toLocaleString() : 'n/a'}</dd>
        <dt style={{ fontWeight: 600 }}>Slack channel</dt>
        <dd style={{ margin: 0 }}>{response.channelName ? `#${response.channelName}` : '—'}</dd>
      </dl>

      <p style={{ marginTop: 12 }}>
        <a href={r.maxioUrl} target="_blank" rel="noreferrer" style={{ color: '#2563eb' }}>View in Maxio →</a>
      </p>

      {response.notes.length > 0 && (
        <ul style={{ marginTop: 8, color: '#7a6', fontSize: 13 }}>
          {response.notes.map((n, i) => <li key={i}>{n}</li>)}
        </ul>
      )}
    </div>
  );
}
