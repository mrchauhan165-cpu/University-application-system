import { useState } from 'react';
import { Icon } from '../components/Icons';
import { Alert, Button, Field, TextInput } from '../components/UI';
import { navigate, useApp } from '../context';
import { errorMessage } from '../../backend/errors';
import { passwordStrength } from '../../backend/crypto';

export function LoginPage() {
  const { backend, notify, data } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'signin' | 'reset' | 'reset-sent'>('signin');
  const [resetToken, setResetToken] = useState<string | null>(null);

  const demo = backend.demoAccounts();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await backend.signIn(email, password);
      notify('Signed in successfully.', 'success');
      navigate('/');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function sendReset(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await backend.requestPasswordReset(email);
      setResetToken(result.token);
      setMode('reset-sent');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell">
      <section className="auth-hero" aria-label="About this portal">
        <div className="auth-badge">
          <Icon.Shield size={14} /> Role-based access · Post-based approvals
        </div>
        <h1>{data.settings.university_name} application portal</h1>
        <p>
          Submit and track applications, review them through the configured approval chain, publish
          scoped notices and read statistics — all from one place.
        </p>
        <div className="hero-list">
          <div className="hero-item"><Icon.Check size={18} /><span>Students see only their own applications and documents.</span></div>
          <div className="hero-item"><Icon.Check size={18} /><span>Officers act only through their <strong>current</strong> post and organisational scope.</span></div>
          <div className="hero-item"><Icon.Check size={18} /><span>Application history belongs to the post, not to a former employee’s account.</span></div>
          <div className="hero-item"><Icon.Check size={18} /><span>VC “Approve and forward” never marks an application fully approved.</span></div>
          <div className="hero-item"><Icon.Check size={18} /><span>Confidential files stay private — even from system administrators.</span></div>
        </div>
        <div className="auth-badge" style={{ marginTop: 'auto' }}>
          <Icon.Info size={14} /> Demo prototype with sample data
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-card">
          <div className="card">
            {mode === 'signin' ? (
              <form onSubmit={submit} noValidate>
                <h1 className="auth-title">Sign in</h1>
                <p className="auth-sub">Use your university email address and password.</p>

                {error ? <Alert tone="danger">{error}</Alert> : null}

                <div style={{ marginTop: 16 }}>
                  <Field label="Email address" htmlFor="email">
                    <TextInput
                      id="email"
                      type="email"
                      autoComplete="username"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@demo.university"
                    />
                  </Field>
                  <Field label="Password" htmlFor="password">
                    <TextInput
                      id="password"
                      type="password"
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Your password"
                    />
                  </Field>
                  <Button type="submit" block loading={busy} disabled={!email || !password}>
                    {busy ? 'Signing in…' : 'Sign in'}
                  </Button>
                  <div className="row" style={{ justifyContent: 'space-between', marginTop: 12 }}>
                    <button type="button" className="btn ghost small" onClick={() => { setMode('reset'); setError(null); }}>
                      Forgot password?
                    </button>
                    <span style={{ fontSize: '0.76rem', color: 'var(--muted)' }}>
                      Accounts are created by the university administrator.
                    </span>
                  </div>
                </div>

                {demo.length ? (
                  <details className="demo-accounts">
                    <summary>Demo accounts (prototype only — click to fill)</summary>
                    <p style={{ fontSize: '0.76rem', color: 'var(--muted)', margin: '8px 0' }}>
                      These are seeded test accounts with the shared demo password <code>{demo[0].password}</code>.
                      They are not real people and must never be used as production credentials.
                    </p>
                    <div className="demo-table">
                      {demo.map((acc) => (
                        <button
                          key={acc.email}
                          type="button"
                          className="demo-row"
                          onClick={() => {
                            setEmail(acc.email);
                            setPassword(acc.password);
                          }}
                        >
                          <span className="dr-role">
                            <strong>{acc.role}</strong>
                            <div className="dr-email">{acc.email}</div>
                          </span>
                          <Icon.Chevron size={14} />
                        </button>
                      ))}
                    </div>
                  </details>
                ) : null}
              </form>
            ) : mode === 'reset' ? (
              <form onSubmit={sendReset} noValidate>
                <h1 className="auth-title">Reset your password</h1>
                <p className="auth-sub">
                  In production this sends a single-use link to your university email. In this prototype the
                  link is shown here instead of being emailed.
                </p>
                {error ? <Alert tone="danger">{error}</Alert> : null}
                <div style={{ marginTop: 16 }}>
                  <Field label="Email address" htmlFor="reset-email">
                    <TextInput
                      id="reset-email"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </Field>
                  <Button type="submit" block loading={busy} disabled={!email}>Create reset link</Button>
                  <Button variant="ghost" block style={{ marginTop: 8 }} onClick={() => setMode('signin')}>
                    Back to sign in
                  </Button>
                </div>
              </form>
            ) : (
              <div>
                <h1 className="auth-title">Set a new password</h1>
                <p className="auth-sub">
                  The reset link below is valid for one hour and can only be used once.
                </p>
                <Alert tone="info" title="Prototype behaviour:">
                  in a deployed system this link is delivered by your auth provider, never displayed on screen.
                </Alert>
                <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Button onClick={() => navigate(`/reset?token=${resetToken}`)}>Open reset form</Button>
                  <Button variant="secondary" onClick={() => setMode('signin')}>Back to sign in</Button>
                </div>
              </div>
            )}
          </div>
          <p style={{ textAlign: 'center', fontSize: '0.76rem', color: 'var(--muted)', marginTop: 14 }}>
            Protected by role, post and organisational-scope checks on every request.
          </p>
        </div>
      </section>
    </div>
  );
}

export function ResetPasswordPage() {
  const { backend, route, notify } = useApp();
  const token = route.query.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const strength = passwordStrength(password);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await backend.resetPassword(token, password);
      notify('Password updated. You can sign in now.', 'success');
      navigate('/');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell">
      <section className="auth-hero" aria-hidden="true">
        <h1>Secure account recovery</h1>
        <p>Reset links are single-use and expire quickly. Passwords are never stored or shown in plain text.</p>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <div className="card">
            <h1 className="auth-title">Choose a new password</h1>
            <p className="auth-sub">At least 10 characters, with upper and lower case letters and a number.</p>
            {error ? <Alert tone="danger">{error}</Alert> : null}
            <form onSubmit={submit} style={{ marginTop: 14 }}>
              <Field label="New password" htmlFor="new-password" hint={strength.problems[0] ?? 'Password strength looks good.'}>
                <TextInput id="new-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>
              <Field label="Confirm new password" htmlFor="confirm-password" error={confirm && password !== confirm ? 'Passwords do not match.' : null}>
                <TextInput id="confirm-password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </Field>
              <Button type="submit" block loading={busy} disabled={!password || !token}>
                Update password
              </Button>
            </form>
            {!token ? <Alert tone="warn" title="Missing token."> Open the full reset link from your administrator.</Alert> : null}
          </div>
        </div>
      </section>
    </div>
  );
}

export function ActivateAccountPage() {
  const { backend, route, notify } = useApp();
  const token = route.query.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await backend.activateAccount(token, password);
      notify('Account activated. Please sign in.', 'success');
      navigate('/');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell">
      <section className="auth-hero" aria-hidden="true">
        <h1>Activate your account</h1>
        <p>Your administrator created an account for you. Set your own password to activate it — nobody else knows it.</p>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <div className="card">
            <h1 className="auth-title">Set your password</h1>
            <p className="auth-sub">This activation link can be used once and expires in 72 hours.</p>
            {error ? <Alert tone="danger">{error}</Alert> : null}
            <form onSubmit={submit} style={{ marginTop: 14 }}>
              <Field label="New password" htmlFor="activation-password">
                <TextInput id="activation-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
              </Field>
              <Field label="Confirm password" htmlFor="activation-confirm">
                <TextInput id="activation-confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
              </Field>
              <Button type="submit" block loading={busy} disabled={!password || !token}>Activate account</Button>
            </form>
          </div>
        </div>
      </section>
    </div>
  );
}
