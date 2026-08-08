import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

type Method = 'totp' | 'recovery';

export default function MfaVerify() {
  const { verifyMfa, cancelMfa } = useAuth();
  const navigate = useNavigate();
  const [method, setMethod] = useState<Method>('totp');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const value = method === 'totp' ? code.replace(/\D/g, '') : code.trim();
    if ((method === 'totp' && value.length !== 6) || !value) {
      setError(method === 'totp' ? 'Enter the six-digit code from your authenticator app.' : 'Enter a recovery code.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await verifyMfa(method === 'totp' ? { totpCode: value } : { recoveryCode: value });
      setCode('');
      navigate('/dashboard', { replace: true });
    } catch {
      setCode('');
      setError('Unable to verify that code. Try again or use a recovery code.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel() {
    setSubmitting(true);
    try {
      await cancelMfa();
    } finally {
      setCode('');
      navigate('/login', { replace: true });
    }
  }

  return (
    <div className="auth-shell">
      <form className="auth-card" onSubmit={handleSubmit} noValidate>
        <h1 className="auth-title">Verify your sign-in</h1>
        <p className="auth-subtitle">Use your authenticator app or a recovery code.</p>
        {error && <div className="alert alert-error" role="alert">{error}</div>}

        <fieldset className="mfa-methods">
          <legend className="field-label">Verification method</legend>
          <label><input type="radio" checked={method === 'totp'} onChange={() => { setMethod('totp'); setCode(''); setError(null); }} /> Authenticator code</label>
          <label><input type="radio" checked={method === 'recovery'} onChange={() => { setMethod('recovery'); setCode(''); setError(null); }} /> Recovery code</label>
        </fieldset>

        <label className="field">
          <span className="field-label">{method === 'totp' ? 'Authenticator code' : 'Recovery code'}</span>
          <input
            className="field-input"
            value={code}
            onChange={(event) => setCode(method === 'totp' ? event.target.value.replace(/\D/g, '').slice(0, 6) : event.target.value)}
            inputMode={method === 'totp' ? 'numeric' : 'text'}
            autoComplete={method === 'totp' ? 'one-time-code' : 'off'}
            placeholder={method === 'totp' ? '123456' : 'XXXXXXXX'}
            aria-describedby={error ? undefined : 'mfa-code-help'}
          />
          {method === 'totp' && <span id="mfa-code-help" className="field-hint">Enter the current six-digit code.</span>}
        </label>

        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? 'Verifying…' : 'Verify'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={handleCancel} disabled={submitting}>
          Cancel sign-in
        </button>
      </form>
    </div>
  );
}
