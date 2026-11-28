import React, { useEffect, useState } from 'react';
import {
  KeyRound,
  LogOut,
  Pencil,
  RefreshCw,
  SquareUser,
  UserCheck,
  UserPlus,
  Users
} from 'lucide-react';
import type { CloudConnectionStatus } from '@shared/types';
import { useLavrayStore } from '../store/useLavrayStore';
import { LavrayMark } from './BrandMarks';

interface Props {
  onClose: () => void;
}

export const ProfilePopover: React.FC<Props> = ({ onClose }) => {
  const { setOverlayView, pushToast } = useLavrayStore();
  const [status, setStatus] = useState<CloudConnectionStatus | null>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    void window.lavray.getCloudStatus().then(setStatus).catch(() => {});
  }, []);

  const displayName = status?.authenticated
    ? status.displayName || status.userEmail?.split('@')[0] || 'LAVRAY User'
    : 'Local Profile';
  const email = status?.authenticated
    ? status.userEmail || ''
    : 'Not signed in — Local-First Mode';
  const initial = displayName.slice(0, 1).toUpperCase();

  const anySyncEnabled = Boolean(
    status?.authenticated &&
      status.consent &&
      (status.consent.syncBookmarks ||
        status.consent.syncPreferences ||
        status.consent.syncReadingList ||
        status.consent.syncHistory ||
        status.consent.syncTabs ||
        status.consent.syncNotes ||
        status.consent.syncHayaConversations ||
        status.consent.syncHayaPreferences ||
        status.consent.syncMemory)
  );

  const openAccount = () => {
    setOverlayView('account');
    onClose();
  };

  return (
    <div
      data-testid="profile-popover"
      className="lavray-glass absolute right-0 top-9 z-50 w-[308px] rounded-2xl border border-lavray-border p-3 shadow-lavray-float text-[12.5px] text-lavray-text"
    >
      {/* Top Profile Card */}
      <div className="rounded-xl bg-lavray-elevated/70 border border-lavray-border/70 px-4 py-4 flex flex-col items-center text-center">
        <div className="relative flex h-14 w-14 items-center justify-center rounded-full p-[2.5px] bg-gradient-to-tr from-blue-500 via-indigo-500 to-purple-500 shadow-sm">
          <div className="flex h-full w-full items-center justify-center rounded-full bg-lavray-surface text-lg font-semibold text-lavray-text">
            {status?.avatarUrl ? (
              <img
                src={status.avatarUrl}
                alt={displayName}
                className="h-full w-full rounded-full object-cover"
              />
            ) : (
              initial
            )}
          </div>
        </div>

        <span className="mt-2.5 inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-indigo-500/20 to-purple-500/20 border border-indigo-400/30 px-2.5 py-0.5 text-[10.5px] font-semibold text-lavray-accent">
          {status?.e2eeEnabled ? 'E2EE' : status?.authenticated ? 'LAVRAY Account' : 'Local'}
        </span>

        <div className="mt-2 text-[14.5px] font-semibold leading-tight">{displayName}</div>
        <div className="mt-0.5 text-[11.5px] text-lavray-muted truncate max-w-full">{email}</div>
      </div>

      {/* Primary Profile Actions */}
      <div className="mt-2.5 space-y-0.5">
        <ProfileMenuRow
          icon={<KeyRound className="h-4 w-4" strokeWidth={1.75} />}
          label="Passwords and autofill"
          onClick={() => {
            setOverlayView('settings');
            onClose();
          }}
        />
        <ProfileMenuRow
          icon={<LavrayMark className="h-4 w-4 text-lavray-accent" />}
          label="Manage your LAVRAY Account"
          onClick={openAccount}
        />
        <ProfileMenuRow
          icon={<Pencil className="h-4 w-4" strokeWidth={1.75} />}
          label="Customize profile"
          onClick={openAccount}
        />
        <ProfileMenuRow
          icon={<RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} strokeWidth={1.75} />}
          label={
            !status?.authenticated
              ? 'Sign in to turn on sync'
              : anySyncEnabled
                ? 'Sync is on'
                : 'Sync is paused'
          }
          accent={Boolean(status?.authenticated && anySyncEnabled)}
          onClick={async () => {
            if (!status?.authenticated || !anySyncEnabled) {
              openAccount();
              return;
            }
            setSyncing(true);
            try {
              const res = await window.lavray.syncCloudNow();
              const pushed = Object.values(res.synced).reduce((a, b) => a + b, 0);
              pushToast(`Synced (${pushed} pushed, ${res.pulled ?? 0} pulled)`, 'success');
            } catch (err) {
              pushToast(err instanceof Error ? err.message : 'Sync failed', 'danger');
            } finally {
              setSyncing(false);
            }
          }}
        />
      </div>

      <div className="my-2 border-t border-lavray-border" />

      {/* Other Profiles Section */}
      <div className="px-2.5 py-1 text-[11px] font-semibold text-lavray-secondary">
        Other LAVRAY profiles
      </div>
      <div className="space-y-0.5">
        <button
          type="button"
          onClick={openAccount}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left hover:bg-lavray-elevated/80 transition-colors"
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-lavray-accent/15 text-[10px] font-semibold text-lavray-accent ring-1 ring-lavray-accent/40">
            {initial}
          </span>
          <span className="truncate font-medium">{displayName}</span>
          <span className="ml-auto text-[10px] text-lavray-muted">Active</span>
        </button>
      </div>

      <div className="my-2 border-t border-lavray-border" />

      {/* Profile / Guest / Manage Actions */}
      <div className="space-y-0.5">
        <ProfileMenuRow
          icon={<UserPlus className="h-4 w-4" strokeWidth={1.75} />}
          label={status?.authenticated ? 'Add LAVRAY profile' : 'Create LAVRAY Account'}
          onClick={openAccount}
        />
        <ProfileMenuRow
          icon={<SquareUser className="h-4 w-4" strokeWidth={1.75} />}
          label="Open guest profile"
          onClick={() => {
            void window.lavray.newPrivateWindow();
            onClose();
          }}
        />
        <ProfileMenuRow
          icon={<Users className="h-4 w-4" strokeWidth={1.75} />}
          label="Manage LAVRAY profiles"
          onClick={openAccount}
        />
        {status?.authenticated && (
          <ProfileMenuRow
            icon={<LogOut className="h-4 w-4" strokeWidth={1.75} />}
            label="Sign out"
            onClick={async () => {
              await window.lavray.cloudLogout();
              pushToast('Signed out. Local profile & HAYA data preserved.', 'info');
              onClose();
            }}
          />
        )}
        {!status?.authenticated && (
          <ProfileMenuRow
            icon={<UserCheck className="h-4 w-4" strokeWidth={1.75} />}
            label="Sign in"
            onClick={openAccount}
          />
        )}
      </div>
    </div>
  );
};

const ProfileMenuRow: React.FC<{
  icon: React.ReactNode;
  label: string;
  accent?: boolean;
  onClick: () => void;
}> = ({ icon, label, accent, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-lavray-text hover:bg-lavray-elevated/80 transition-colors"
  >
    <span className={accent ? 'text-emerald-500' : 'text-lavray-muted'}>{icon}</span>
    <span className="truncate">{label}</span>
  </button>
);
