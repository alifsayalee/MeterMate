import { useState } from 'react';
import { setAdminCreds } from '../../admin.js';

const labelStyle: React.CSSProperties = { display: 'block', fontWeight: 600, marginBottom: 4, fontSize: 14 };
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', border: '1px solid #ccc', borderRadius: 6, fontSize: 14, boxSizing: 'border-box',
};

/**
 * Hardcoded-credentials admin gate (placeholder auth). Stores the entered
 * credentials for the session; they're sent as HTTP Basic on admin routes and
 * validated server-side by adminGuard.
 */
export function AdminLogin({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAdminCreds({ user: user.trim(), password });
    onLoggedIn();
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Admin sign in</h2>
      <p style={{ color: '#666', marginTop: 4 }}>
        Enter the operator credentials (placeholder auth). They're sent with each admin request and
        verified server-side.
      </p>
      <form onSubmit={onSubmit} noValidate>
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle} htmlFor="adminUser">Username</label>
          <input id="adminUser" style={inputStyle} value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle} htmlFor="adminPass">Password</label>
          <input id="adminPass" type="password" style={inputStyle} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </div>
        <button type="submit" disabled={user.trim() === '' || password === ''}
          style={{ padding: '10px 18px', fontSize: 15, fontWeight: 600, color: '#fff', background: user.trim() && password ? '#2563eb' : '#9bb8f0', border: 'none', borderRadius: 6, cursor: user.trim() && password ? 'pointer' : 'not-allowed' }}>
          Sign in
        </button>
      </form>
    </div>
  );
}
