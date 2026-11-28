import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Columns2,
  Copy,
  FolderPlus,
  Layers,
  Lock,
  Pin,
  Plus,
  RotateCcw,
  Rows3,
  Search,
  Volume2,
  VolumeX,
  X
} from 'lucide-react';
import type { TabInfo } from '@shared/types';
import { useLavrayStore } from '../store/useLavrayStore';

interface TabBarProps {
  vertical: boolean;
}

export const TabBar: React.FC<TabBarProps> = ({ vertical }) => {
  const { tabs, activeTabId, groups, isPrivateWindow, setTabSearchOpen, setVerticalTabs } = useLavrayStore();
  const [contextMenu, setContextMenu] = useState<{ tab: TabInfo; x: number; y: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [dragTabId, setDragTabId] = useState<string | null>(null);

  const startRename = (tab: TabInfo) => {
    setRenamingId(tab.id);
    setRenameText(tab.customTitle || tab.title);
    setContextMenu(null);
  };

  const commitRename = async (tabId: string) => {
    await window.lavray.renameTab(tabId, renameText.trim() || null);
    setRenamingId(null);
  };

  const getTabTitle = (tab: TabInfo) => {
    if (tab.customTitle) return tab.customTitle;
    if (tab.url === 'lavray://newtab' || tab.url === 'about:blank') return 'New Tab';
    return tab.title || tab.url;
  };

  const getTabInitial = (tab: TabInfo) => {
    if (tab.url === 'lavray://newtab' || tab.url === 'about:blank') return 'L';
    const titleAlpha = (tab.customTitle || tab.title || '').match(/[A-Za-z]/)?.[0];
    try {
      const host = new URL(tab.url).hostname.replace(/^www\./, '');
      const hostAlpha = host.match(/[A-Za-z]/)?.[0];
      return (hostAlpha || titleAlpha || 'L').toUpperCase();
    } catch {
      return (titleAlpha || 'L').toUpperCase();
    }
  };

  const renderTab = (tab: TabInfo, index: number) => {
    const active = tab.id === activeTabId;
    const nextTab = tabs[index + 1];
    const showDivider = !vertical && !active && nextTab && nextTab.id !== activeTabId;
    const group = groups.find((g) => g.id === tab.groupId);
    if (group?.collapsed && !active) return null;

    const displayTitle = getTabTitle(tab);

    return (
      <div
        key={tab.id}
        className={`relative flex items-center shrink-0 ${vertical ? 'w-full' : 'h-full'}`}
      >
        <div
          draggable
          onDragStart={() => setDragTabId(tab.id)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => {
            if (dragTabId && dragTabId !== tab.id) {
              void window.lavray.reorderTab(dragTabId, index);
            }
            setDragTabId(null);
          }}
          onClick={() => void window.lavray.activateTab(tab.id)}
          onContextMenu={(e) => {
            e.preventDefault();
            setContextMenu({ tab, x: e.clientX, y: e.clientY });
          }}
          title={displayTitle}
          className={`group app-no-drag relative flex items-center gap-2 select-none cursor-pointer transition-colors duration-150 ease-lavray ${
            vertical
              ? `w-full rounded-lg px-2.5 h-8 ${
                  active
                    ? 'bg-lavray-surface text-lavray-text border border-lavray-border shadow-lavray-sm'
                    : 'text-lavray-secondary hover:bg-lavray-elevated/70 hover:text-lavray-text'
                }`
              : tab.isPinned
              ? `h-[32px] mt-auto px-2.5 ${
                  active
                    ? 'rounded-t-[8px] border-x border-t border-lavray-border bg-lavray-surface text-lavray-text -mb-[1px] pb-[1px] z-10'
                    : 'my-auto rounded-[7px] text-lavray-secondary hover:bg-lavray-elevated/70 hover:text-lavray-text'
                }`
              : `h-[32px] w-44 min-w-[116px] max-w-[208px] px-2.5 ${
                  active
                    ? 'mt-auto rounded-t-[8px] border-x border-t border-lavray-border bg-lavray-surface text-lavray-text -mb-[1px] pb-[1px] z-10'
                    : 'my-auto rounded-[7px] text-lavray-secondary hover:bg-lavray-elevated/70 hover:text-lavray-text'
                }`
          }`}
          style={
            group
              ? { boxShadow: `inset 0 2px 0 0 ${group.color}` }
              : undefined
          }
        >
          {/* Favicon / Loader / Monogram */}
          <div className="flex h-4 w-4 shrink-0 items-center justify-center">
            {tab.isLoading ? (
              <span className="h-3 w-3 rounded-full border-[1.5px] border-lavray-accent border-t-transparent animate-spin" />
            ) : tab.favicon ? (
              <img src={tab.favicon} alt="" className="h-3.5 w-3.5 rounded-[3px] object-contain" />
            ) : (
              <span
                className={`flex h-4 w-4 items-center justify-center rounded-[4px] text-[9.5px] font-semibold ${
                  active
                    ? 'bg-lavray-accent/12 text-lavray-accent'
                    : 'bg-lavray-elevated text-lavray-muted'
                }`}
              >
                {getTabInitial(tab)}
              </span>
            )}
          </div>

          {!tab.isPinned && (
            renamingId === tab.id ? (
              <input
                autoFocus
                value={renameText}
                onChange={(e) => setRenameText(e.target.value)}
                onBlur={() => void commitRename(tab.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void commitRename(tab.id);
                  if (e.key === 'Escape') setRenamingId(null);
                }}
                onClick={(e) => e.stopPropagation()}
                className="w-full min-w-0 bg-transparent text-[12px] text-lavray-text outline-none border-b border-lavray-accent"
              />
            ) : (
              <span className="flex-1 truncate text-[12px] font-medium leading-none tracking-[-0.005em]">
                {displayTitle}
              </span>
            )
          )}

          {/* Audio Indicator */}
          {tab.isMuted && !tab.isPinned && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void window.lavray.muteTab(tab.id);
              }}
              className="shrink-0 rounded p-0.5 text-lavray-muted hover:text-lavray-text"
              title="Unmute tab"
            >
              <VolumeX className="h-3 w-3" />
            </button>
          )}

          {/* Reserved Close Button */}
          {!tab.isPinned && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void window.lavray.closeTab(tab.id);
              }}
              aria-label="Close tab"
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] transition-opacity duration-150 ${
                active
                  ? 'opacity-65 hover:opacity-100 hover:bg-lavray-elevated text-lavray-secondary hover:text-lavray-text'
                  : 'opacity-0 group-hover:opacity-75 hover:!opacity-100 hover:bg-lavray-hover text-lavray-muted hover:text-lavray-text'
              }`}
            >
              <X className="h-3 w-3" strokeWidth={1.75} />
            </button>
          )}
        </div>

        {/* Hairline separator between inactive tabs */}
        {showDivider && <span className="mx-0.5 h-3.5 w-px bg-lavray-border shrink-0" />}
      </div>
    );
  };

  return (
    <>
      <div
        className={
          vertical
            ? 'flex flex-col h-full w-56 bg-lavray-shell border-r border-lavray-border p-2 gap-1.5 select-none'
            : 'app-drag-region flex items-end h-[38px] bg-lavray-shell border-b border-lavray-border pr-2.5 gap-1 select-none pl-20'
        }
      >
        {/* Private indicator (typographic pill, zero neon) */}
        {!vertical && isPrivateWindow && (
          <div className="app-no-drag flex items-center h-full mr-1 shrink-0">
            <span className="inline-flex items-center gap-1 rounded-md border border-lavray-border bg-lavray-surface px-2 py-0.5 text-[11px] font-medium text-lavray-secondary">
              <Lock className="h-3 w-3 text-lavray-muted" strokeWidth={1.75} />
              Private
            </span>
          </div>
        )}

        {vertical && (
          <div className="flex items-center justify-between px-1 pb-1 text-[11px] font-medium text-lavray-muted">
            <span className="flex items-center gap-1.5">
              {isPrivateWindow && <Lock className="h-3 w-3" />}
              {isPrivateWindow ? 'Private Tabs' : `Tabs (${tabs.length})`}
            </span>
            <button
              type="button"
              onClick={() => void window.lavray.createTab({ url: 'lavray://newtab', activate: true })}
              title="New Tab"
              className="rounded-md p-1 text-lavray-secondary hover:bg-lavray-elevated hover:text-lavray-text"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {vertical && groups.length > 0 && (
          <div className="flex flex-wrap gap-1 pb-1.5 border-b border-lavray-border">
            {groups.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => window.lavray.updateTabGroup(g.id, { collapsed: !g.collapsed })}
                className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium bg-lavray-surface border border-lavray-border text-lavray-secondary hover:text-lavray-text"
                style={{ borderColor: g.color }}
              >
                {g.collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {g.title}
              </button>
            ))}
          </div>
        )}

        {/* Tab Strip */}
        <div
          className={
            vertical
              ? 'flex-1 overflow-y-auto flex flex-col gap-0.5'
              : 'no-scrollbar flex-1 overflow-x-auto flex items-end h-full min-w-0'
          }
        >
          {tabs.map((tab, idx) => renderTab(tab, idx))}

          {!vertical && (
            <button
              type="button"
              onClick={() => void window.lavray.createTab({ url: 'lavray://newtab', activate: true })}
              title="New Tab (Cmd/Ctrl+T)"
              aria-label="New Tab"
              className="app-no-drag ml-1 mb-1 flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-[7px] text-lavray-muted hover:bg-lavray-elevated hover:text-lavray-text transition-colors"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          )}
        </div>

        {/* Right / Vertical Footer Actions */}
        <div
          className={`app-no-drag flex items-center gap-0.5 ${
            vertical ? 'pt-2 border-t border-lavray-border justify-between' : 'h-full shrink-0 pl-1'
          }`}
        >
          {vertical && (
            <button
              type="button"
              onClick={() => {
                setVerticalTabs(false);
                void window.lavray.updateSettings({ verticalTabs: false });
              }}
              title="Switch to Horizontal Tabs"
              className="rounded-md p-1.5 text-lavray-muted hover:bg-lavray-elevated hover:text-lavray-text transition-colors"
            >
              <Rows3 className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          )}
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => setTabSearchOpen(true)}
              title="Search Open Tabs (Cmd/Ctrl+Shift+A)"
              aria-label="Search Open Tabs"
              className="rounded-[7px] p-1.5 text-lavray-muted hover:bg-lavray-elevated hover:text-lavray-text transition-colors"
            >
              <Search className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
            <button
              type="button"
              onClick={() => void window.lavray.restoreClosedTab()}
              title="Reopen Closed Tab (Cmd/Ctrl+Shift+T)"
              aria-label="Reopen Closed Tab"
              className="rounded-[7px] p-1.5 text-lavray-muted hover:bg-lavray-elevated hover:text-lavray-text transition-colors"
            >
              <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          </div>
        </div>
      </div>

      {/* Selective Liquid Glass Tab Context Menu */}
      {contextMenu && (
        <div
          className="fixed inset-0 z-50"
          onClick={() => setContextMenu(null)}
          onContextMenu={(e) => {
            e.preventDefault();
            setContextMenu(null);
          }}
        >
          <div
            style={{ left: contextMenu.x, top: contextMenu.y }}
            className="lavray-glass fixed w-52 rounded-xl border border-lavray-border p-1.5 shadow-lavray-float text-xs text-lavray-text"
            onClick={(e) => e.stopPropagation()}
          >
            <CtxItem
              icon={<Copy className="h-3.5 w-3.5" />}
              label="Duplicate Tab"
              onClick={() => {
                void window.lavray.duplicateTab(contextMenu.tab.id);
                setContextMenu(null);
              }}
            />
            <CtxItem
              icon={<Pin className="h-3.5 w-3.5" />}
              label={contextMenu.tab.isPinned ? 'Unpin Tab' : 'Pin Tab'}
              onClick={() => {
                void window.lavray.pinTab(contextMenu.tab.id);
                setContextMenu(null);
              }}
            />
            <CtxItem
              icon={contextMenu.tab.isMuted ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
              label={contextMenu.tab.isMuted ? 'Unmute Tab' : 'Mute Tab'}
              onClick={() => {
                void window.lavray.muteTab(contextMenu.tab.id);
                setContextMenu(null);
              }}
            />
            <CtxItem
              icon={<Layers className="h-3.5 w-3.5" />}
              label="Rename Tab"
              onClick={() => startRename(contextMenu.tab)}
            />
            <CtxItem
              icon={<FolderPlus className="h-3.5 w-3.5" />}
              label="Add to New Group"
              onClick={async () => {
                const grp = await window.lavray.createTabGroup('Workspace');
                await window.lavray.assignTabGroup(contextMenu.tab.id, grp.id);
                setContextMenu(null);
              }}
            />
            <CtxItem
              icon={<Columns2 className="h-3.5 w-3.5" />}
              label={vertical ? 'Use Horizontal Tabs' : 'Use Vertical Tabs'}
              onClick={() => {
                const next = !vertical;
                setVerticalTabs(next);
                void window.lavray.updateSettings({ verticalTabs: next });
                setContextMenu(null);
              }}
            />
            <div className="my-1 border-t border-lavray-border" />
            <CtxItem
              icon={<X className="h-3.5 w-3.5" />}
              label="Close Tab"
              danger
              onClick={() => {
                void window.lavray.closeTab(contextMenu.tab.id);
                setContextMenu(null);
              }}
            />
          </div>
        </div>
      )}
    </>
  );
};

const CtxItem: React.FC<{
  icon: React.ReactNode;
  label: string;
  danger?: boolean;
  onClick: () => void;
}> = ({ icon, label, danger, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors ${
      danger ? 'text-lavray-danger hover:bg-lavray-danger/10' : 'text-lavray-text hover:bg-lavray-elevated/80'
    }`}
  >
    <span className="text-lavray-muted">{icon}</span>
    <span>{label}</span>
  </button>
);
