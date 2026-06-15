import { useState } from 'react';
import { BookForm } from './components/client/BookForm.js';
import { UsageForm } from './components/client/UsageForm.js';
import { PlanChangeForm } from './components/client/PlanChangeForm.js';

type Tab = 'book' | 'usage' | 'plan';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'book', label: 'Book & subscribe' },
  { id: 'usage', label: 'Report usage' },
  { id: 'plan', label: 'Change plan' },
];

/**
 * App shell. Client use-case forms are exposed as tabs and added slice by slice;
 * a Client/Admin role switch arrives with the admin use cases (UC5/UC6).
 */
export function App() {
  const [tab, setTab] = useState<Tab>('book');

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', color: '#1a1a1a' }}>
      <header style={{ borderBottom: '1px solid #eee', padding: '14px 24px' }}>
        <strong style={{ fontSize: 18 }}>MeterMate</strong>
        <span style={{ color: '#888', marginLeft: 10, fontSize: 14 }}>
          Maxio + Slack billing concierge
        </span>
      </header>

      <main style={{ maxWidth: 640, margin: '32px auto', padding: '0 24px' }}>
        <nav style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding: '8px 16px',
                fontSize: 14,
                fontWeight: 600,
                border: '1px solid',
                borderColor: tab === t.id ? '#2563eb' : '#ddd',
                color: tab === t.id ? '#fff' : '#333',
                background: tab === t.id ? '#2563eb' : '#fff',
                borderRadius: 8,
                cursor: 'pointer',
              }}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <section style={{ padding: 24, border: '1px solid #e5e5e5', borderRadius: 12 }}>
          {tab === 'book' && <BookForm />}
          {tab === 'usage' && <UsageForm />}
          {tab === 'plan' && <PlanChangeForm />}
        </section>
      </main>
    </div>
  );
}
