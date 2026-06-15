import { BookForm } from './components/client/BookForm.js';

/**
 * App shell. A role switch (Client | Admin) and additional use-case forms are
 * added slice by slice. For UC1 the client Book & Subscribe form is the surface.
 */
export function App() {
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', color: '#1a1a1a' }}>
      <header style={{ borderBottom: '1px solid #eee', padding: '14px 24px' }}>
        <strong style={{ fontSize: 18 }}>MeterMate</strong>
        <span style={{ color: '#888', marginLeft: 10, fontSize: 14 }}>
          Maxio + Slack billing concierge
        </span>
      </header>

      <main style={{ maxWidth: 640, margin: '32px auto', padding: '0 24px' }}>
        <section style={{ padding: 24, border: '1px solid #e5e5e5', borderRadius: 12 }}>
          <BookForm />
        </section>
      </main>
    </div>
  );
}
