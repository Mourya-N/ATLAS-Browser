import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  CloudOff,
  Copy,
  Download,
  KeyRound,
  Laptop,
  Lock,
  LogOut,
  MailCheck,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserCheck,
  X
} from 'lucide-react';
import type { CloudConnectionStatus, CloudConsentSettings, CloudDevice } from '@shared/types';
import { useLavrayStore } from '../../store/useLavrayStore';

type AuthScreen = 'welcome' | 'signin' | 'signup' | 'forgot';
type AccountTab = 'profile' | 'sync' | 'devices' | 'security';

export const AccountView: React.FC = () => {
  const { setOverlayView, pushToast } = useLavrayStore();
  const [status, setStatus] = useState<CloudConnectionStatus | null>(null);
  const [devices, setDevices] = useState<CloudDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Auth forms
  const [authScreen, setAuthScreen] = useState<AuthScreen>('welcome');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPasswordReset, setNewPasswordReset] = useState('');
  const [devResetHint, setDevResetHint] = useState<string | null>(null);
  const [devVerifyHint, setDevVerifyHint] = useState<string | null>(null);
  const [verifyTokenInput, setVerifyTokenInput] = useState('');
  const [showInitialSyncPrompt, setShowInitialSyncPrompt] = useState(false);

  // Signed-in tabs
  const [tab, setTab] = useState<AccountTab>('profile');
  const [profileNameInput, setProfileNameInput] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [recoveryKeyShown, setRecoveryKeyShown] = useState<string | null>(null);
  const [unlockRecoveryInput, setUnlockRecoveryInput] = useState('');
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [lastSyncSummary, setLastSyncSummary] = useState<string | null>(null);

  const refreshAll = async () => {
    try {
      const s = await window.lavray.getCloudStatus();
      setStatus(s);
      setProfileNameInput(s.displayName || '');
      if (s.authenticated && s.reachable) {
        try {
          const list = await window.lavray.listCloudDevices();
          setDevices(list);
        } catch {
          setDevices([]);
        }
      } else {
        setDevices([]);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshAll();
  }, []);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const s = await window.lavray.cloudLogin({ email: email.trim(), password });
      setStatus(s);
      setProfileNameInput(s.displayName || '');
      setPassword('');
      setShowInitialSyncPrompt(true);
      pushToast('Signed in to LAVRAY Account', 'success');
      void refreshAll();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Sign in failed', 'danger');
    } finally {
      setBusy(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const s = await window.lavray.cloudRegister({
        email: email.trim(),
        password,
        displayName: displayName.trim() || undefined
      });
      setStatus(s);
      setProfileNameInput(s.displayName || '');
      setPassword('');
      if (s.devVerificationToken) setDevVerifyHint(s.devVerificationToken);
      setShowInitialSyncPrompt(true);
      pushToast('LAVRAY Account created', 'success');
      void refreshAll();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Registration failed', 'danger');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleConsent = async (key: keyof CloudConsentSettings, val: boolean) => {
    if (!status) return;
    setBusy(true);
    try {
      const next = await window.lavray.updateCloudConsent({ [key]: val });
      setStatus(next);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Failed to update sync setting', 'danger');
    } finally {
      setBusy(false);
    }
  };

  const handleSyncNow = async () => {
    setBusy(true);
    try {
      const r = await window.lavray.syncCloudNow();
      const pushedTotal = Object.values(r.synced).reduce((a, b) => a + b, 0);
      const summary = `Pushed ${pushedTotal} • Pulled ${r.pulled ?? 0}${
        r.conflictsResolved ? ` • Resolved ${r.conflictsResolved} conflict(s)` : ''
      }`;
      setLastSyncSummary(summary);
      pushToast(`Sync complete (${summary})`, 'success');
      await refreshAll();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Sync failed', 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-lavray-bg text-lavray-text overflow-y-auto">
      <div className="flex items-center justify-between border-b border-lavray-border px-6 py-4 bg-lavray-shell">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-lavray-accent/15 text-lavray-accent">
            <UserCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-[15px] font-semibold">LAVRAY Account & Sync</h1>
            <p className="text-[12px] text-lavray-muted">
              Local-first browser profile with optional end-to-end encrypted cloud sync
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOverlayView(null)}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-lavray-muted hover:bg-lavray-elevated hover:text-lavray-text"
          aria-label="Close Account View"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mx-auto w-full max-w-4xl p-6 space-y-6">
        {loading ? (
          <div className="rounded-xl border border-lavray-border bg-lavray-surface p-8 text-center text-[13px] text-lavray-muted">
            Checking LAVRAY Account status...
          </div>
        ) : !status?.authenticated ? (
          <div className="space-y-5">
            <div className="rounded-xl border border-lavray-border bg-lavray-surface p-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 text-[12.5px]">
                {status?.reachable ? (
                  <Cloud className="h-4 w-4 text-emerald-500 shrink-0" />
                ) : (
                  <CloudOff className="h-4 w-4 text-amber-500 shrink-0" />
                )}
                <span>
                  Backend: <code className="text-[11.5px]">{status?.cloudEndpointUrl}</code>{' '}
                  {status?.reachable ? '(Online)' : '(Offline — local profile active)'}
                </span>
              </div>
              <span className="rounded-full bg-lavray-elevated px-2.5 py-0.5 text-[11px] font-medium text-lavray-secondary">
                Local-First Mode
              </span>
            </div>

            {authScreen === 'welcome' && (
              <div className="rounded-2xl border border-lavray-border bg-lavray-surface p-6 space-y-5">
                <div className="space-y-1.5">
                  <h2 className="text-lg font-semibold">Welcome to LAVRAY Account</h2>
                  <p className="text-[13px] text-lavray-muted leading-relaxed">
                    LAVRAY works completely locally without an account. Sign in or create an account to
                    sync your bookmarks, preferences, reading list, and optionally your HAYA AI history
                    across devices with AES-256-GCM encryption.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => setAuthScreen('signup')}
                    className="rounded-xl bg-lavray-accent px-4 py-2 text-[13px] font-medium text-lavray-accent-fg"
                  >
                    Create LAVRAY Account
                  </button>
                  <button
                    type="button"
                    onClick={() => setAuthScreen('signin')}
                    className="rounded-xl border border-lavray-border bg-lavray-bg px-4 py-2 text-[13px] font-medium hover:bg-lavray-elevated"
                  >
                    Sign In
                  </button>
                  <button
                    type="button"
                    onClick={() => setAuthScreen('forgot')}
                    className="rounded-xl px-3 py-2 text-[12.5px] text-lavray-muted hover:text-lavray-text"
                  >
                    Forgot Password?
                  </button>
                </div>
              </div>
            )}

            {(authScreen === 'signin' || authScreen === 'signup') && (
              <form
                onSubmit={authScreen === 'signin' ? handleSignIn : handleSignUp}
                className="rounded-2xl border border-lavray-border bg-lavray-surface p-6 space-y-4 max-w-lg"
              >
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold">
                    {authScreen === 'signin' ? 'Sign In to LAVRAY' : 'Create LAVRAY Account'}
                  </h2>
                  <button
                    type="button"
                    onClick={() => setAuthScreen(authScreen === 'signin' ? 'signup' : 'signin')}
                    className="text-[12px] text-lavray-accent hover:underline"
                  >
                    {authScreen === 'signin' ? 'Need an account?' : 'Already have an account?'}
                  </button>
                </div>

                {authScreen === 'signup' && (
                  <div>
                    <label className="block text-[12px] text-lavray-secondary mb-1">Display Name</label>
                    <input
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Your name"
                      className="w-full rounded-lg border border-lavray-border bg-lavray-bg px-3 py-2 text-[13px] outline-none"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-[12px] text-lavray-secondary mb-1">Email</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full rounded-lg border border-lavray-border bg-lavray-bg px-3 py-2 text-[13px] outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[12px] text-lavray-secondary mb-1">
                    Password (minimum 8 characters)
                  </label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full rounded-lg border border-lavray-border bg-lavray-bg px-3 py-2 text-[13px] outline-none"
                  />
                </div>

                <div className="flex items-center justify-between pt-2">
                  <button
                    type="submit"
                    disabled={busy}
                    className="rounded-xl bg-lavray-accent px-4 py-2 text-[13px] font-medium text-lavray-accent-fg disabled:opacity-50"
                  >
                    {busy ? 'Working...' : authScreen === 'signin' ? 'Sign In' : 'Create Account'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setAuthScreen('forgot')}
                    className="text-[12px] text-lavray-muted hover:text-lavray-text"
                  >
                    Forgot password?
                  </button>
                </div>
              </form>
            )}

            {authScreen === 'forgot' && (
              <div className="rounded-2xl border border-lavray-border bg-lavray-surface p-6 space-y-4 max-w-lg">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold">Reset Password</h2>
                  <button
                    type="button"
                    onClick={() => setAuthScreen('signin')}
                    className="text-[12px] text-lavray-accent hover:underline"
                  >
                    Back to Sign In
                  </button>
                </div>
                <div className="flex gap-2">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Account email"
                    className="flex-1 rounded-lg border border-lavray-border bg-lavray-bg px-3 py-2 text-[13px] outline-none"
                  />
                  <button
                    type="button"
                    disabled={busy || !email.trim()}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const r = await window.lavray.forgotCloudPassword(email.trim());
                        if (r.devResetToken) setDevResetHint(r.devResetToken);
                        pushToast('If that email exists, a reset token was issued.', 'info');
                      } catch (err) {
                        pushToast(err instanceof Error ? err.message : 'Request failed', 'danger');
                      } finally {
                        setBusy(false);
                      }
                    }}
                    className="rounded-lg bg-lavray-accent px-3 py-2 text-[12px] font-medium text-lavray-accent-fg"
                  >
                    Request Reset
                  </button>
                </div>

                {devResetHint && (
                  <div className="rounded-lg border border-lavray-border bg-lavray-bg p-2.5 text-[11.5px]">
                    Dev Reset Token: <code className="select-all font-mono">{devResetHint}</code>
                  </div>
                )}

                <div className="space-y-2 pt-2 border-t border-lavray-border">
                  <input
                    value={resetToken}
                    onChange={(e) => setResetToken(e.target.value)}
                    placeholder="Paste reset token"
                    className="w-full rounded-lg border border-lavray-border bg-lavray-bg px-3 py-2 text-[13px] outline-none"
                  />
                  <input
                    type="password"
                    value={newPasswordReset}
                    onChange={(e) => setNewPasswordReset(e.target.value)}
                    placeholder="New password (8+ chars)"
                    className="w-full rounded-lg border border-lavray-border bg-lavray-bg px-3 py-2 text-[13px] outline-none"
                  />
                  <button
                    type="button"
                    disabled={busy || !resetToken.trim() || newPasswordReset.length < 8}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await window.lavray.resetCloudPassword({
                          token: resetToken.trim(),
                          newPassword: newPasswordReset
                        });
                        pushToast('Password reset! You can now sign in.', 'success');
                        setAuthScreen('signin');
                      } catch (err) {
                        pushToast(err instanceof Error ? err.message : 'Reset failed', 'danger');
                      } finally {
                        setBusy(false);
                      }
                    }}
                    className="rounded-lg border border-lavray-border px-3 py-2 text-[12.5px] font-medium hover:bg-lavray-elevated"
                  >
                    Confirm Password Reset
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            {showInitialSyncPrompt && (
              <div className="rounded-2xl border border-lavray-accent/40 bg-lavray-accent/5 p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="text-[13px] font-semibold">Choose what to sync across your devices</div>
                  <div className="text-[12px] text-lavray-muted">
                    Local bookmarks, history, and HAYA data stay untouched. Enable only the categories you want.
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setTab('sync');
                      setShowInitialSyncPrompt(false);
                    }}
                    className="rounded-lg bg-lavray-accent px-3 py-1.5 text-[12px] font-medium text-lavray-accent-fg"
                  >
                    Configure Sync
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowInitialSyncPrompt(false)}
                    className="rounded-lg border border-lavray-border px-3 py-1.5 text-[12px]"
                  >
                    Keep Local Only
                  </button>
                </div>
              </div>
            )}

            {/* Status Banner */}
            <div className="rounded-2xl border border-lavray-border bg-lavray-surface p-4 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-lavray-accent text-lavray-accent-fg font-semibold text-sm">
                  {(status.displayName || status.userEmail || 'L').slice(0, 1).toUpperCase()}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-semibold">
                      {status.displayName || status.userEmail}
                    </span>
                    {status.emailVerified ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10.5px] font-medium text-emerald-500">
                        <CheckCircle2 className="h-3 w-3" /> Verified
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10.5px] font-medium text-amber-500">
                        Unverified
                      </span>
                    )}
                    {status.e2eeEnabled && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-lavray-accent/15 px-2 py-0.5 text-[10.5px] font-medium text-lavray-accent">
                        <Lock className="h-3 w-3" /> E2EE {status.e2eeUnlocked ? 'Unlocked' : 'Locked'}
                      </span>
                    )}
                  </div>
                  <div className="text-[12px] text-lavray-muted">
                    {status.userEmail} •{' '}
                    {status.syncState === 'offline'
                      ? 'Offline (changes queued locally)'
                      : status.syncState === 'expired'
                        ? 'Session expired — sign in again'
                        : status.lastSyncedAt
                          ? `Last synced ${new Date(status.lastSyncedAt).toLocaleTimeString()}`
                          : 'Not synced yet'}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleSyncNow}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-lavray-accent px-3.5 py-2 text-[12.5px] font-medium text-lavray-accent-fg disabled:opacity-50"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
                  Sync Now
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    const next = await window.lavray.cloudLogout();
                    setStatus(next);
                    pushToast('Signed out. All local browser & HAYA data preserved.', 'info');
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-lavray-border px-3.5 py-2 text-[12.5px] hover:bg-lavray-elevated"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Sign Out
                </button>
              </div>
            </div>

            {lastSyncSummary && (
              <div className="rounded-xl border border-lavray-border bg-lavray-surface px-4 py-2.5 text-[12px] text-lavray-secondary">
                {lastSyncSummary}
              </div>
            )}

            {/* Sub-navigation */}
            <div className="flex gap-1 border-b border-lavray-border">
              {(
                [
                  ['profile', 'Profile'],
                  ['sync', 'Sync Settings'],
                  ['devices', `Devices (${devices.length})`],
                  ['security', 'Security & E2EE']
                ] as Array<[AccountTab, string]>
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className={`px-4 py-2 text-[12.5px] font-medium border-b-2 transition-colors ${
                    tab === id
                      ? 'border-lavray-accent text-lavray-text'
                      : 'border-transparent text-lavray-muted hover:text-lavray-text'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === 'profile' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="rounded-2xl border border-lavray-border bg-lavray-surface p-5 space-y-4">
                  <h3 className="text-[13.5px] font-semibold">Profile Details</h3>
                  <div>
                    <label className="block text-[12px] text-lavray-secondary mb-1">Display Name</label>
                    <div className="flex gap-2">
                      <input
                        value={profileNameInput}
                        onChange={(e) => setProfileNameInput(e.target.value)}
                        className="flex-1 rounded-lg border border-lavray-border bg-lavray-bg px-3 py-1.5 text-[13px] outline-none"
                      />
                      <button
                        type="button"
                        disabled={busy || !profileNameInput.trim()}
                        onClick={async () => {
                          setBusy(true);
                          try {
                            const s = await window.lavray.updateCloudProfile({
                              displayName: profileNameInput.trim()
                            });
                            setStatus(s);
                            pushToast('Profile updated', 'success');
                          } finally {
                            setBusy(false);
                          }
                        }}
                        className="rounded-lg bg-lavray-accent px-3 py-1.5 text-[12px] font-medium text-lavray-accent-fg"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                  <div className="text-[12px] text-lavray-muted">
                    User ID: <code className="text-[11px]">{status.userId}</code>
                  </div>
                </div>

                <div className="rounded-2xl border border-lavray-border bg-lavray-surface p-5 space-y-3">
                  <div className="flex items-center gap-2">
                    <MailCheck className="h-4 w-4 text-lavray-accent" />
                    <h3 className="text-[13.5px] font-semibold">Email Verification</h3>
                  </div>
                  {status.emailVerified ? (
                    <p className="text-[12.5px] text-emerald-500">
                      Your email address is verified.
                    </p>
                  ) : (
                    <div className="space-y-2.5">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          try {
                            const r = await window.lavray.requestEmailVerification();
                            if (r.devToken) setDevVerifyHint(r.devToken);
                            pushToast('Verification token requested', 'info');
                          } finally {
                            setBusy(false);
                          }
                        }}
                        className="rounded-lg border border-lavray-border px-3 py-1.5 text-[12px] hover:bg-lavray-elevated"
                      >
                        Send Verification Token
                      </button>
                      {devVerifyHint && (
                        <div className="rounded-lg border border-lavray-border bg-lavray-bg p-2 text-[11px]">
                          Dev Token: <code className="select-all font-mono">{devVerifyHint}</code>
                        </div>
                      )}
                      <div className="flex gap-2">
                        <input
                          value={verifyTokenInput}
                          onChange={(e) => setVerifyTokenInput(e.target.value)}
                          placeholder="Enter verification token"
                          className="flex-1 rounded-lg border border-lavray-border bg-lavray-bg px-3 py-1.5 text-[12.5px] outline-none"
                        />
                        <button
                          type="button"
                          disabled={busy || !verifyTokenInput.trim()}
                          onClick={async () => {
                            setBusy(true);
                            try {
                              const s = await window.lavray.verifyCloudEmail(verifyTokenInput.trim());
                              setStatus(s);
                              pushToast('Email verified!', 'success');
                            } catch (err) {
                              pushToast(err instanceof Error ? err.message : 'Verification failed', 'danger');
                            } finally {
                              setBusy(false);
                            }
                          }}
                          className="rounded-lg bg-lavray-accent px-3 py-1.5 text-[12px] font-medium text-lavray-accent-fg"
                        >
                          Verify
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {tab === 'sync' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="rounded-2xl border border-lavray-border bg-lavray-surface p-5 space-y-3">
                  <h3 className="text-[13.5px] font-semibold">LAVRAY Browser Data</h3>
                  <p className="text-[11.5px] text-lavray-muted">
                    Select which browser categories synchronize with your account.
                  </p>
                  {(
                    [
                      ['syncBookmarks', 'Bookmarks & Folders'],
                      ['syncPreferences', 'Browser Preferences & Theme'],
                      ['syncReadingList', 'Reading List'],
                      ['syncHistory', 'Browsing History (E2EE when enabled)'],
                      ['syncTabs', 'Open Non-Private Tabs'],
                      ['syncNotes', 'Saved Notes']
                    ] as Array<[keyof CloudConsentSettings, string]>
                  ).map(([k, label]) => (
                    <label key={k} className="flex items-center justify-between py-1 text-[12.5px] cursor-pointer">
                      <span>{label}</span>
                      <input
                        type="checkbox"
                        checked={Boolean(status.consent[k])}
                        onChange={(e) => void handleToggleConsent(k, e.target.checked)}
                        className="h-4 w-4 accent-lavray-accent"
                      />
                    </label>
                  ))}
                </div>

                <div className="rounded-2xl border border-lavray-border bg-lavray-surface p-5 space-y-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-lavray-accent" />
                    <h3 className="text-[13.5px] font-semibold">HAYA AI Data (Separate & Opt-In)</h3>
                  </div>
                  <p className="text-[11.5px] text-lavray-muted">
                    HAYA data is kept logically separate from browsing data. API keys are never synced, and
                    your conversations are never used to train models.
                  </p>
                  {(
                    [
                      ['syncHayaConversations', 'HAYA Conversations & Messages (E2EE)'],
                      ['syncHayaPreferences', 'HAYA Model Preferences & Custom Instructions'],
                      ['syncMemory', 'User-Approved HAYA Memory (E2EE)']
                    ] as Array<[keyof CloudConsentSettings, string]>
                  ).map(([k, label]) => (
                    <label key={k} className="flex items-center justify-between py-1 text-[12.5px] cursor-pointer">
                      <span>{label}</span>
                      <input
                        type="checkbox"
                        checked={Boolean(status.consent[k])}
                        onChange={(e) => void handleToggleConsent(k, e.target.checked)}
                        className="h-4 w-4 accent-lavray-accent"
                      />
                    </label>
                  ))}
                </div>
              </div>
            )}

            {tab === 'devices' && (
              <div className="rounded-2xl border border-lavray-border bg-lavray-surface p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-[13.5px] font-semibold">Connected Devices</h3>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await window.lavray.revokeOtherCloudSessions();
                        pushToast('All other device sessions revoked', 'success');
                        await refreshAll();
                      } finally {
                        setBusy(false);
                      }
                    }}
                    className="rounded-lg border border-lavray-border px-3 py-1.5 text-[12px] hover:bg-lavray-elevated"
                  >
                    Sign Out All Other Devices
                  </button>
                </div>

                <div className="divide-y divide-lavray-border">
                  {devices.map((d) => (
                    <div key={d.id} className="py-3 flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <Laptop className="h-4 w-4 text-lavray-muted" />
                        <div>
                          <div className="flex items-center gap-2 text-[13px] font-medium">
                            <span>{d.deviceName}</span>
                            {d.isCurrent && (
                              <span className="rounded-full bg-lavray-accent/15 px-2 py-0.5 text-[10px] text-lavray-accent">
                                This Device
                              </span>
                            )}
                            {d.revokedAt && (
                              <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] text-red-500">
                                Revoked
                              </span>
                            )}
                          </div>
                          <div className="text-[11.5px] text-lavray-muted">
                            {d.platform} • v{d.appVersion} • Last seen{' '}
                            {new Date(d.lastSeenAt).toLocaleString()}
                          </div>
                        </div>
                      </div>
                      {!d.revokedAt && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            try {
                              await window.lavray.revokeCloudDevice(d.id);
                              pushToast('Device session revoked', 'info');
                              await refreshAll();
                            } finally {
                              setBusy(false);
                            }
                          }}
                          className="rounded-lg border border-lavray-border px-2.5 py-1 text-[11.5px] text-red-500 hover:bg-red-500/10"
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                  ))}
                  {devices.length === 0 && (
                    <div className="py-4 text-[12.5px] text-lavray-muted">No connected devices found.</div>
                  )}
                </div>
              </div>
            )}

            {tab === 'security' && (
              <div className="space-y-5">
                <div className="rounded-2xl border border-lavray-border bg-lavray-surface p-5 space-y-3">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-lavray-accent" />
                    <h3 className="text-[13.5px] font-semibold">
                      End-to-End Encryption (AES-256-GCM)
                    </h3>
                  </div>
                  <p className="text-[12px] text-lavray-muted">
                    Encrypts sensitive browsing history, HAYA conversations, HAYA preferences, and approved
                    memory on your device before upload. Your Account Master Key stays in your OS keychain and
                    is never sent to LAVRAY servers in plaintext.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          const res = await window.lavray.setupCloudE2ee();
                          setRecoveryKeyShown(res.recoveryKey);
                          pushToast('E2EE enabled! Save your Recovery Key safely.', 'success');
                          await refreshAll();
                        } catch (err) {
                          pushToast(err instanceof Error ? err.message : 'Failed to enable E2EE', 'danger');
                        } finally {
                          setBusy(false);
                        }
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-lavray-accent px-3 py-1.5 text-[12px] font-medium text-lavray-accent-fg"
                    >
                      <KeyRound className="h-3.5 w-3.5" />
                      {status.e2eeEnabled ? 'Rotate / Regenerate Recovery Key' : 'Enable End-to-End Encryption'}
                    </button>
                  </div>

                  {recoveryKeyShown && (
                    <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 space-y-2">
                      <div className="flex items-center justify-between text-[12px] font-semibold text-amber-500">
                        <span>Save Your Recovery Key Now</span>
                        <button
                          type="button"
                          onClick={() => {
                            void navigator.clipboard.writeText(recoveryKeyShown);
                            pushToast('Recovery Key copied to clipboard', 'success');
                          }}
                          className="inline-flex items-center gap-1 text-[11.5px] underline"
                        >
                          <Copy className="h-3 w-3" /> Copy
                        </button>
                      </div>
                      <code className="block break-all font-mono text-[12px] select-all">
                        {recoveryKeyShown}
                      </code>
                      <p className="text-[11px] text-lavray-muted">
                        If you lose all signed-in devices and lose this Recovery Key, encrypted cloud records
                        cannot be decrypted by anyone, including LAVRAY.
                      </p>
                    </div>
                  )}

                  {status.e2eeEnabled && !status.e2eeUnlocked && (
                    <div className="flex gap-2 pt-2">
                      <input
                        value={unlockRecoveryInput}
                        onChange={(e) => setUnlockRecoveryInput(e.target.value)}
                        placeholder="Paste Recovery Key to unlock E2EE on this device"
                        className="flex-1 rounded-lg border border-lavray-border bg-lavray-bg px-3 py-1.5 text-[12.5px] outline-none"
                      />
                      <button
                        type="button"
                        disabled={busy || !unlockRecoveryInput.trim()}
                        onClick={async () => {
                          setBusy(true);
                          try {
                            const s = await window.lavray.unlockCloudE2ee(unlockRecoveryInput.trim());
                            setStatus(s);
                            setUnlockRecoveryInput('');
                            pushToast('E2EE vault unlocked on this device', 'success');
                          } catch (err) {
                            pushToast(err instanceof Error ? err.message : 'Invalid Recovery Key', 'danger');
                          } finally {
                            setBusy(false);
                          }
                        }}
                        className="rounded-lg bg-lavray-accent px-3 py-1.5 text-[12px] font-medium text-lavray-accent-fg"
                      >
                        Unlock
                      </button>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="rounded-2xl border border-lavray-border bg-lavray-surface p-5 space-y-3">
                    <h3 className="text-[13.5px] font-semibold">Change Password</h3>
                    <input
                      type="password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder="Current password"
                      className="w-full rounded-lg border border-lavray-border bg-lavray-bg px-3 py-1.5 text-[12.5px] outline-none"
                    />
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="New password (8+ chars)"
                      className="w-full rounded-lg border border-lavray-border bg-lavray-bg px-3 py-1.5 text-[12.5px] outline-none"
                    />
                    <button
                      type="button"
                      disabled={busy || !currentPassword || newPassword.length < 8}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await window.lavray.changeCloudPassword({ currentPassword, newPassword });
                          setCurrentPassword('');
                          setNewPassword('');
                          pushToast('Password updated and other sessions revoked', 'success');
                        } catch (err) {
                          pushToast(err instanceof Error ? err.message : 'Failed to change password', 'danger');
                        } finally {
                          setBusy(false);
                        }
                      }}
                      className="rounded-lg border border-lavray-border px-3 py-1.5 text-[12px] hover:bg-lavray-elevated"
                    >
                      Update Password
                    </button>
                  </div>

                  <div className="rounded-2xl border border-lavray-border bg-lavray-surface p-5 space-y-3">
                    <h3 className="text-[13.5px] font-semibold">Data Export & Account Deletion</h3>
                    <button
                      type="button"
                      onClick={async () => {
                        const json = await window.lavray.exportCloudData();
                        const blob = new Blob([json], { type: 'application/json' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `lavray-account-export-${Date.now()}.json`;
                        a.click();
                        URL.revokeObjectURL(url);
                        pushToast('Account data exported as JSON', 'success');
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-lavray-border px-3 py-1.5 text-[12px] hover:bg-lavray-elevated"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Export Account Data (JSON)
                    </button>

                    <div className="pt-2 border-t border-lavray-border space-y-2">
                      <div className="flex items-center gap-1.5 text-[12px] text-red-500 font-medium">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        Delete Cloud Account
                      </div>
                      <input
                        value={deleteConfirmText}
                        onChange={(e) => setDeleteConfirmText(e.target.value)}
                        placeholder='Type "DELETE" to confirm'
                        className="w-full rounded-lg border border-red-500/40 bg-lavray-bg px-3 py-1.5 text-[12px] outline-none"
                      />
                      <button
                        type="button"
                        disabled={busy || deleteConfirmText !== 'DELETE'}
                        onClick={async () => {
                          setBusy(true);
                          try {
                            const s = await window.lavray.deleteCloudAccount();
                            setStatus(s);
                            setDeleteConfirmText('');
                            pushToast('Cloud account deleted. Local profile preserved.', 'info');
                          } catch (err) {
                            pushToast(err instanceof Error ? err.message : 'Deletion failed', 'danger');
                          } finally {
                            setBusy(false);
                          }
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-40"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Permanently Delete Cloud Account
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
