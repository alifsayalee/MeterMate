import { useState } from 'react';
import { BookForm } from './components/client/BookForm.js';
import { UsageForm } from './components/client/UsageForm.js';
import { PlanChangeForm } from './components/client/PlanChangeForm.js';
import { LifecycleForm } from './components/client/LifecycleForm.js';
import { AdminLogin } from './components/admin/AdminLogin.js';
import { InvoiceForm } from './components/admin/InvoiceForm.js';
import { ActivityPanel } from './components/admin/ActivityPanel.js';
import { clearAdminCreds, getAdminCreds } from './admin.js';

type Role = 'client' | 'admin';
type ClientTab = 'book' | 'usage' | 'plan' | 'lifecycle';
type AdminTab = 'invoice' | 'activity';

const CLIENT_TABS: Array<{ id: ClientTab; label: string }> = [
  { id: 'book', label: 'Book & subscribe' },
  { id: 'usage', label: 'Report usage' },
  { id: 'plan', label: 'Change plan' },
  { id: 'lifecycle', label: 'Lifecycle' },
];

function pill(active: boolean): React.CSSProperties {
  return {
    padding: '8px 16px', fontSize: 14, fontWeight: 600, borderRadius: 8, cursor: 'pointer',
    border: '1px solid', borderColor: active ? '#2563eb' : '#ddd',
    color: active ? '#fff' : '#333', background: active ? '#2563eb' : '#fff',
  };
}

export function App() {
  const [role, setRole] = useState<Role>('client');
  const [clientTab, setClientTab] = useState<ClientTab>('book');
  const [adminTab, setAdminTab] = useState<AdminTab>('invoice');
  // Bumped on admin login/logout to re-evaluate getAdminCreds().
  const [adminVersion, setAdminVersion] = useState(0);
  const adminAuthed = getAdminCreds() !== null;
  const onAdminUnauthorized = () => { clearAdminCreds(); setAdminVersion((v) => v + 1); };

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', color: '#1a1a1a' }}>
      <header style={{ borderBottom: '1px solid #eee', padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <strong style={{ fontSize: 18 }}>MeterMate</strong>
        <span style={{ color: '#888', fontSize: 14, flex: 1 }}>Maxio + Slack billing concierge</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setRole('client')} style={pill(role === 'client')}>Client</button>
          <button onClick={() => setRole('admin')} style={pill(role === 'admin')}>Admin</button>
        </div>
      </header>

      <main style={{ maxWidth: 680, margin: '32px auto', padding: '0 24px' }}>
        {role === 'client' && (
          <>
            <nav style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
              {CLIENT_TABS.map((t) => (
                <button key={t.id} onClick={() => setClientTab(t.id)} style={pill(clientTab === t.id)}>{t.label}</button>
              ))}
            </nav>
            <section style={{ padding: 24, border: '1px solid #e5e5e5', borderRadius: 12 }}>
              {clientTab === 'book' && <BookForm />}
              {clientTab === 'usage' && <UsageForm />}
              {clientTab === 'plan' && <PlanChangeForm />}
              {clientTab === 'lifecycle' && <LifecycleForm />}
            </section>
          </>
        )}

        {role === 'admin' && (
          <section style={{ padding: 24, border: '1px solid #e5e5e5', borderRadius: 12 }}>
            {adminAuthed ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <nav style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => setAdminTab('invoice')} style={pill(adminTab === 'invoice')}>Issue invoice</button>
                    <button onClick={() => setAdminTab('activity')} style={pill(adminTab === 'activity')}>Activity digest</button>
                  </nav>
                  <button onClick={onAdminUnauthorized}
                    style={{ padding: '4px 10px', fontSize: 12, border: '1px solid #ddd', borderRadius: 6, background: '#fff', cursor: 'pointer' }}>
                    Sign out
                  </button>
                </div>
                {adminTab === 'invoice'
                  ? <InvoiceForm key={`inv-${adminVersion}`} onUnauthorized={onAdminUnauthorized} />
                  : <ActivityPanel key={`act-${adminVersion}`} onUnauthorized={onAdminUnauthorized} />}
              </>
            ) : (
              <AdminLogin onLoggedIn={() => setAdminVersion((v) => v + 1)} />
            )}
          </section>
        )}
      </main>
    </div>
  );
}
