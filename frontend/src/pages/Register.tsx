import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import zxcvbn from 'zxcvbn';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { useFlag } from '../flags/FlagContext';

const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 128;
// Mirror the backend: zxcvbn score must be >= 3 ("safely unguessable").
const MIN_PASSWORD_SCORE = 3;
// Mirror the backend: cap zxcvbn input length (the algorithm is superlinear).
const ZXCVBN_MAX_INPUT = 100;

const STRENGTH_LABELS = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong'] as const;

function isPasswordBackendError(message: string): boolean {
  return /password|weak/i.test(message);
}

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const showNewRegistrationFlow = useFlag('new-registration-flow');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{
    email?: string;
    password?: string;
    confirm?: string;
  }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Live strength estimate, recomputed only when the password changes.
  const strength = useMemo(() => {
    if (!password) return null;
    return zxcvbn(password.slice(0, ZXCVBN_MAX_INPUT));
  }, [password]);

  function validate(): boolean {
    const errors: { email?: string; password?: string; confirm?: string } = {};
    if (!email.trim()) {
      errors.email = 'Email is required.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = 'Enter a valid email address.';
    }
    if (!password) {
      errors.password = 'Password is required.';
    } else if (password.length < MIN_PASSWORD_LENGTH) {
      errors.password = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    } else if (password.length > MAX_PASSWORD_LENGTH) {
      errors.password = `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`;
    } else if (zxcvbn(password.slice(0, ZXCVBN_MAX_INPUT)).score < MIN_PASSWORD_SCORE) {
      // Mirror the backend strength gate so weak-but-long passwords are caught
      // client-side before the request is ever sent.
      errors.password =
        'Password is too weak or guessable — add more length or unusual words.';
    }
    if (confirm !== password) {
      errors.confirm = 'Passwords do not match.';
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!validate()) return;

    setSubmitting(true);
    try {
      await register(email.trim(), password);
      navigate('/login', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        const message = err.message || 'Could not create your account.';
        // Defensive fallback: surface a password-related backend error inline on
        // the field rather than only in the top banner.
        if (err.status === 400 && isPasswordBackendError(message)) {
          setFieldErrors((prev) => ({ ...prev, password: message }));
        } else {
          setFormError(message);
        }
      } else {
        setFormError('Unable to reach the server. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-shell">
      <form className="auth-card" onSubmit={handleSubmit} noValidate>
        <h1 className="auth-title">Create account</h1>
        <p className="auth-subtitle">Start with a secure password</p>
        {showNewRegistrationFlow && (
          <p className="auth-subtitle">
            Preview: streamlined onboarding is enabled for your rollout group.
          </p>
        )}

        {formError && <div className="alert alert-error" role="alert">{formError}</div>}

        <label className="field">
          <span className="field-label">Email</span>
          <input
            type="email"
            className={`field-input${fieldErrors.email ? ' field-input-error' : ''}`}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            placeholder="you@example.com"
          />
          {fieldErrors.email && <span className="field-error">{fieldErrors.email}</span>}
        </label>

        <label className="field">
          <span className="field-label">Password</span>
          <input
            type="password"
            className={`field-input${fieldErrors.password ? ' field-input-error' : ''}`}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            placeholder="At least 12 characters"
          />
          {strength && (
            <div className="strength" aria-live="polite">
              <div
                className="strength-track"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={4}
                aria-valuenow={strength.score}
                aria-label="Password strength"
              >
                <div className="strength-fill" data-score={strength.score} />
              </div>
              <span className="strength-label" data-score={strength.score}>
                {STRENGTH_LABELS[strength.score]}
              </span>
              {(strength.feedback.warning || strength.feedback.suggestions[0]) && (
                <span className="strength-hint">
                  {strength.feedback.warning || strength.feedback.suggestions[0]}
                </span>
              )}
            </div>
          )}
          {fieldErrors.password && <span className="field-error">{fieldErrors.password}</span>}
        </label>

        <label className="field">
          <span className="field-label">Confirm password</span>
          <input
            type="password"
            className={`field-input${fieldErrors.confirm ? ' field-input-error' : ''}`}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            placeholder="Re-enter your password"
          />
          {fieldErrors.confirm && <span className="field-error">{fieldErrors.confirm}</span>}
        </label>

        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? 'Creating account…' : 'Create account'}
        </button>

        <p className="auth-footer">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </div>
  );
}
