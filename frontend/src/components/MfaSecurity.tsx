import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { api } from '../api/client';

type ProofMethod = 'totp' | 'recovery';
type SensitiveAction = 'disable' | 'regenerate';

function normalizeTotp(value: string): string {
  return value.replace(/\D/g, '').slice(0, 6);
}

export default function MfaSecurity() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [provisioningUri, setProvisioningUri] = useState<string | null>(null);
  const [manualSecret, setManualSecret] = useState<string | null>(null);
  const [setupCode, setSetupCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [action, setAction] = useState<SensitiveAction | null>(null);
  const [password, setPassword] = useState('');
  const [proofMethod, setProofMethod] = useState<ProofMethod>('totp');
  const [proof, setProof] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    api.mfaStatus()
      .then((status) => {
        if (active) setEnabled(status.enabled);
      })
      .catch(() => {
        if (active) setError('Unable to load multi-factor authentication settings.');
      });
    return () => {
      active = false;
    };
  }, []);

  function clearSetup(): void {
    setProvisioningUri(null);
    setManualSecret(null);
    setSetupCode('');
  }

  function clearRecoveryCodes(): void {
    setRecoveryCodes(null);
    setAcknowledged(false);
  }

  function clearAction(): void {
    setAction(null);
    setPassword('');
    setProof('');
    setProofMethod('totp');
  }

  async function beginSetup() {
    setBusy(true);
    setError(null);
    setMessage(null);
    clearRecoveryCodes();
    try {
      const setup = await api.setupMfa();
      setProvisioningUri(setup.provisioningUri);
      setManualSecret(setup.manualSecret);
    } catch {
      setError('Unable to start multi-factor setup. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmSetup(event: FormEvent) {
    event.preventDefault();
    const totpCode = normalizeTotp(setupCode);
    if (totpCode.length !== 6) {
      setError('Enter the six-digit code from your authenticator app.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const result = await api.enableMfa(totpCode);
      clearSetup();
      setEnabled(true);
      setRecoveryCodes(result.recoveryCodes);
      setAcknowledged(false);
      setMessage(null);
    } catch {
      setError('Unable to confirm that code. Check your authenticator and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function copyRecoveryCodes() {
    if (!recoveryCodes) return;
    try {
      await navigator.clipboard.writeText(recoveryCodes.join('\n'));
      setMessage('Recovery codes copied. Store them somewhere secure.');
    } catch {
      setError('Unable to copy recovery codes. Select and copy them manually.');
    }
  }

  function downloadRecoveryCodes() {
    if (!recoveryCodes) return;
    const blob = new Blob([`${recoveryCodes.join('\n')}\n`], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'recovery-codes.txt';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function submitSensitiveAction(event: FormEvent) {
    event.preventDefault();
    if (!action) return;
    const normalizedProof = proofMethod === 'totp' ? normalizeTotp(proof) : proof.trim();
    if (!password || !normalizedProof || (proofMethod === 'totp' && normalizedProof.length !== 6)) {
      setError('Enter your password and a valid current verification code.');
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);
    const mfaProof = proofMethod === 'totp' ? { totpCode: normalizedProof } : { recoveryCode: normalizedProof };
    try {
      if (action === 'disable') {
        await api.disableMfa(password, mfaProof);
        setEnabled(false);
        clearRecoveryCodes();
        setMessage('Multi-factor authentication has been disabled.');
      } else {
        const result = await api.regenerateRecoveryCodes(password, mfaProof);
        setRecoveryCodes(result.recoveryCodes);
        setAcknowledged(false);
      }
      clearAction();
    } catch {
      setError('Unable to complete this request. Check your password and verification code.');
    } finally {
      setBusy(false);
    }
  }

  if (enabled === null && !error) {
    return <section className="security-section" aria-label="Account security"><p>Loading security settings…</p></section>;
  }

  return (
    <section className="security-section" aria-labelledby="mfa-heading">
      <h2 id="mfa-heading">Account security</h2>
      <div className="security-status">
        <span>Authenticator app</span>
        <strong className={enabled ? 'status-enabled' : 'status-disabled'}>{enabled ? 'Enabled' : 'Not enabled'}</strong>
      </div>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {message && <div className="alert alert-success" role="status">{message}</div>}

      {!enabled && !provisioningUri && (
        <button type="button" className="btn btn-primary" onClick={beginSetup} disabled={busy}>
          Set up authenticator app
        </button>
      )}

      {provisioningUri && manualSecret && (
        <form className="mfa-setup" onSubmit={confirmSetup}>
          <p>Scan this QR code with your authenticator app, or enter the manual key.</p>
          <div className="qr-code"><QRCodeSVG value={provisioningUri} size={180} includeMargin /></div>
          <label className="field">
            <span className="field-label">Manual setup key</span>
            <code className="manual-secret">{manualSecret}</code>
          </label>
          <label className="field">
            <span className="field-label">Confirmation code</span>
            <input className="field-input" value={setupCode} onChange={(event) => setSetupCode(normalizeTotp(event.target.value))} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" />
          </label>
          <div className="button-row">
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Confirming…' : 'Enable MFA'}</button>
            <button type="button" className="btn btn-ghost" onClick={clearSetup} disabled={busy}>Cancel</button>
          </div>
        </form>
      )}

      {recoveryCodes && (
        <div className="recovery-codes" aria-live="polite">
          <h3>Save your recovery codes</h3>
          <p>Each code can be used once if you cannot access your authenticator. They will not be shown again.</p>
          <pre>{recoveryCodes.join('\n')}</pre>
          <div className="button-row">
            <button type="button" className="btn btn-ghost" onClick={copyRecoveryCodes}>Copy</button>
            <button type="button" className="btn btn-ghost" onClick={downloadRecoveryCodes}>Download</button>
          </div>
          <label className="acknowledge"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /> I have safely stored these recovery codes.</label>
          <button type="button" className="btn btn-primary" disabled={!acknowledged} onClick={clearRecoveryCodes}>Done</button>
        </div>
      )}

      {enabled && !recoveryCodes && (
        <>
          {!action ? (
            <div className="button-row">
              <button type="button" className="btn btn-ghost" onClick={() => { setError(null); setMessage(null); setAction('regenerate'); }}>Regenerate recovery codes</button>
              <button type="button" className="btn btn-danger" onClick={() => { setError(null); setMessage(null); setAction('disable'); }}>Disable MFA</button>
            </div>
          ) : (
            <form className="mfa-action" onSubmit={submitSensitiveAction}>
              <h3>{action === 'disable' ? 'Disable multi-factor authentication' : 'Regenerate recovery codes'}</h3>
              <p>Confirm with your password and a current authenticator or recovery code.</p>
              <label className="field"><span className="field-label">Password</span><input className="field-input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></label>
              <fieldset className="mfa-methods">
                <legend className="field-label">Verification method</legend>
                <label><input type="radio" checked={proofMethod === 'totp'} onChange={() => { setProofMethod('totp'); setProof(''); }} /> Authenticator code</label>
                <label><input type="radio" checked={proofMethod === 'recovery'} onChange={() => { setProofMethod('recovery'); setProof(''); }} /> Recovery code</label>
              </fieldset>
              <label className="field"><span className="field-label">{proofMethod === 'totp' ? 'Authenticator code' : 'Recovery code'}</span><input className="field-input" value={proof} onChange={(event) => setProof(proofMethod === 'totp' ? normalizeTotp(event.target.value) : event.target.value)} inputMode={proofMethod === 'totp' ? 'numeric' : 'text'} autoComplete="off" /></label>
              <div className="button-row">
                <button type="submit" className={action === 'disable' ? 'btn btn-danger' : 'btn btn-primary'} disabled={busy}>{busy ? 'Submitting…' : 'Confirm'}</button>
                <button type="button" className="btn btn-ghost" onClick={clearAction} disabled={busy}>Cancel</button>
              </div>
            </form>
          )}
        </>
      )}
    </section>
  );
}
