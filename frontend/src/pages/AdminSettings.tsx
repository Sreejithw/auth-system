import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { AppSetting, SettingKey, SettingUpdate } from '../api/client';
import { useAuth } from '../auth/AuthContext';

type DraftValue = {
  kind: 'ms' | 'int';
  /** Human-facing string (minutes for most durations, raw ms for flag timeout). */
  display: string;
};

const GROUPS: Array<{ title: string; keys: SettingKey[] }> = [
  {
    title: 'Session expiry',
    keys: [
      'session.idle_ttl_ms',
      'session.absolute_ttl_ms',
      'session.store_prune_interval_ms',
    ],
  },
  {
    title: 'MFA windows',
    keys: ['mfa.challenge_ttl_ms', 'mfa.recent_auth_ttl_ms'],
  },
  {
    title: 'Auth lockout',
    keys: ['auth.lockout_duration_ms', 'auth.lockout_max_failed_attempts'],
  },
  {
    title: 'Rate limiting',
    keys: [
      'rate_limit.global.window_ms',
      'rate_limit.global.max',
      'rate_limit.auth.window_ms',
      'rate_limit.auth.max',
      'rate_limit.mfa.window_ms',
      'rate_limit.mfa.max',
    ],
  },
  {
    title: 'Feature flags',
    keys: ['flags.evaluation_timeout_ms'],
  },
];

function isDurationKey(key: SettingKey): boolean {
  return key.endsWith('_ms');
}

function toDisplay(setting: AppSetting): DraftValue {
  if (isDurationKey(setting.key)) {
    const ms = setting.valueMs ?? 0;
    if (setting.key === 'flags.evaluation_timeout_ms') {
      return { kind: 'ms', display: String(ms) };
    }
    return { kind: 'ms', display: String(Math.round(ms / 60_000)) };
  }
  return { kind: 'int', display: String(setting.valueInt ?? 0) };
}

function unitLabel(key: SettingKey): string {
  if (key === 'flags.evaluation_timeout_ms') return 'ms';
  if (isDurationKey(key)) return 'minutes';
  return 'count';
}

function parseDraft(key: SettingKey, draft: DraftValue): SettingUpdate | { error: string } {
  const raw = draft.display.trim();
  const numeric = Number(raw);
  if (!Number.isFinite(numeric) || !Number.isInteger(numeric)) {
    return { error: `${key} must be an integer` };
  }
  if (isDurationKey(key)) {
    if (numeric <= 0) return { error: `${key} must be positive` };
    const valueMs =
      key === 'flags.evaluation_timeout_ms' ? numeric : numeric * 60_000;
    return { key, valueMs };
  }
  if (numeric < 1) return { error: `${key} must be >= 1` };
  return { key, valueInt: numeric };
}

export default function AdminSettings() {
  const { refreshSession } = useAuth();
  const [settings, setSettings] = useState<AppSetting[]>([]);
  const [drafts, setDrafts] = useState<Record<string, DraftValue>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { settings: rows } = await api.getSettings();
        if (!active) return;
        setSettings(rows);
        const next: Record<string, DraftValue> = {};
        for (const row of rows) next[row.key] = toDisplay(row);
        setDrafts(next);
      } catch (err) {
        if (!active) return;
        setError(err instanceof ApiError ? err.message : 'Failed to load settings');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const byKey = useMemo(() => {
    const map = new Map<string, AppSetting>();
    for (const row of settings) map.set(row.key, row);
    return map;
  }, [settings]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    const updates: SettingUpdate[] = [];
    for (const row of settings) {
      const draft = drafts[row.key];
      if (!draft) continue;
      const parsed = parseDraft(row.key, draft);
      if ('error' in parsed) {
        setError(parsed.error);
        return;
      }
      updates.push(parsed);
    }

    setSaving(true);
    try {
      const { settings: rows } = await api.updateSettings(updates);
      setSettings(rows);
      const next: Record<string, DraftValue> = {};
      for (const row of rows) next[row.key] = toDisplay(row);
      setDrafts(next);
      setSuccess('Settings saved. New sessions use updated timeouts immediately.');
      await refreshSession();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="center-screen">
        <div className="spinner" aria-label="Loading" />
      </div>
    );
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <span className="brand">Auth System</span>
        <nav className="header-nav">
          <Link to="/dashboard" className="btn btn-ghost">
            Dashboard
          </Link>
        </nav>
      </header>

      <main className="dashboard-main">
        <div className="dashboard-card settings-card">
          <h1 className="auth-title">Timeout settings</h1>
          <p className="auth-subtitle">
            Durations are stored in the database. Active sessions keep their original
            expiry deadlines; new logins pick up changes immediately.
          </p>

          {error && <div className="alert alert-error">{error}</div>}
          {success && <div className="alert alert-success">{success}</div>}

          <form className="settings-form" onSubmit={handleSubmit}>
            {GROUPS.map((group) => (
              <section key={group.title} className="settings-group">
                <h2>{group.title}</h2>
                {group.keys.map((key) => {
                  const meta = byKey.get(key);
                  const draft = drafts[key];
                  if (!meta || !draft) return null;
                  return (
                    <label key={key} className="field">
                      <span className="field-label">{key}</span>
                      <span className="field-hint">{meta.description}</span>
                      <div className="settings-input-row">
                        <input
                          type="number"
                          min={1}
                          step={1}
                          value={draft.display}
                          onChange={(event) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [key]: { ...draft, display: event.target.value },
                            }))
                          }
                        />
                        <span className="field-hint">{unitLabel(key)}</span>
                      </div>
                    </label>
                  );
                })}
              </section>
            ))}

            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save settings'}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
