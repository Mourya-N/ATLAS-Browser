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
import { useAtlasStore } from '../store/useAtlasStore';

interface TabBarProps {
  vertical: boolean;
}

export const TabBar: React.FC<TabBarProps> = ({ vertical }) => {
  const { tabs, activeTabId, groups, isPrivateWindow, setTabSearchOpen, setVerticalTabs } = useAtlasStore();
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
    await window.atlas.renameTab(tabId, renameText.trim() || null);
    setRenamingId(null);
  };

  const getTabTitle = (tab: TabInfo) => {
    if (tab.customTitle) return tab.customTitle;
    if (tab.url === 'atlas://newtab' || tab.url === 'about:blank') return 'New Tab';
    return tab.title || tab.url;
  };

  const getTabInitial = (tab: TabInfo) => {
    if (tab.url === 'atlas://newtab' || tab.url === 'about:blank') return 'A';
    const titleAlpha = (tab.customTitle || tab.title || '').match(/[A-Za-z]/)?.[0];
    try {
      const host = new URL(tab.url).hostname.replace(/^www\./, '');
      const hostAlpha = host.match(/[A-Za-z]/)?.[0];
      return (hostAlpha || titleAlpha || 'A').toUpperCase();
    } catch {
      return (titleAlpha || 'A').toUpperCase();
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
              void window.atlas.reorderTab(dragTabId, index);
            }
            setDragTabId(null);
          }}
          onClick={() => void window.atlas.activateTab(tab.id)}
          onContextMenu={(e) => {
            e.preventDefault();
            setContextMenu({ tab, x: e.clientX, y: e.clientY });
          }}
          title={displayTitle}
          className={`group app-no-drag relative flex items-center gap-2 select-none cursor-pointer transition-colors duration-150 ease-atlas ${
            vertical
              ? `w-full rounded-lg px-2.5 h-8 ${
                  active
                    ? 'bg-atlas-surface text-atlas-text border border-atlas-border shadow-atlas-sm'
                    : 'text-atlas-secondary hover:bg-atlas-elevated/70 hover:text-atlas-text'
                }`
              : tab.isPinned
              ? `h-[32px] mt-auto px-2.5 ${
                  active
                    ? 'rounded-t-[8px] border-x border-t border-atlas-border bg-atlas-surface text-atlas-text -mb-[1px] pb-[1px] z-10'
                    : 'my-auto rounded-[7px] text-atlas-secondary hover:bg-atlas-elevated/70 hover:text-atlas-text'
                }`
              : `h-[32px] w-44 min-w-[116px] max-w-[208px] px-2.5 ${
                  active
                    ? 'mt-auto rounded-t-[8px] border-x border-t border-atlas-border bg-atlas-surface text-atlas-text -mb-[1px] pb-[1px] z-10'
                    : 'my-auto rounded-[7px] text-atlas-secondary hover:bg-atlas-elevated/70 hover:text-atlas-text'
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
              <span className="h-3 w-3 rounded-full border-[1.5px] border-atlas-accent border-t-transparent animate-spin" />
            ) : tab.favicon ? (
              <img src={tab.favicon} alt="" className="h-3.5 w-3.5 rounded-[3px] object-contain" />
            ) : (
              <span
                className={`flex h-4 w-4 items-center justify-center rounded-[4px] text-[9.5px] font-semibold ${
                  active
                    ? 'bg-atlas-accent/12 text-atlas-accent'
                    : 'bg-atlas-elevated text-atlas-muted'
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
                className="w-full min-w-0 bg-transparent text-[12px] text-atlas-text outline-none border-b border-atlas-accent"
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
                void window.atlas.muteTab(tab.id);
              }}
              className="shrink-0 rounded p-0.5 text-atlas-muted hover:text-atlas-text"
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
                void window.atlas.closeTab(tab.id);
              }}
              aria-label="Close tab"
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] transition-opacity duration-150 ${
                active
                  ? 'opacity-65 hover:opacity-100 hover:bg-atlas-elevated text-atlas-secondary hover:text-atlas-text'
                  : 'opacity-0 group-hover:opacity-75 hover:!opacity-100 hover:bg-atlas-hover text-atlas-muted hover:text-atlas-text'
              }`}
            >
              <X className="h-3 w-3" strokeWidth={1.75} />
            </button>
          )}
        </div>

        {/* Hairline separator between inactive tabs */}
        {showDivider && <span className="mx-0.5 h-3.5 w-px bg-atlas-border shrink-0" />}
      </div>
    );
  };

  return (
    <>
      <div
        className={
          vertical
            ? 'flex flex-col h-full w-56 bg-atlas-shell border-r border-atlas-border p-2 gap-1.5 select-none'
            : 'app-drag-region flex items-end h-[38px] bg-atlas-shell border-b border-atlas-border pr-2.5 gap-1 select-none pl-20'
        }
      >
        {/* Private indicator (typographic pill, zero neon) */}
        {!vertical && isPrivateWindow && (
          <div className="app-no-drag flex items-center h-full mr-1 shrink-0">
            <span className="inline-flex items-center gap-1 rounded-md border border-atlas-border bg-atlas-surface px-2 py-0.5 text-[11px] font-medium text-atlas-secondary">
              <Lock className="h-3 w-3 text-atlas-muted" strokeWidth={1.75} />
              Private
            </span>
          </div>
        )}

        {vertical && (
          <div className="flex items-center justify-between px-1 pb-1 text-[11px] font-medium text-atlas-muted">
            <span className="flex items-center gap-1.5">
              {isPrivateWindow && <Lock className="h-3 w-3" />}
              {isPrivateWindow ? 'Private Tabs' : `Tabs (${tabs.length})`}
            </span>
            <button
              type="button"
              onClick={() => void window.atlas.createTab({ url: 'atlas://newtab', activate: true })}
              title="New Tab"
              className="rounded-md p-1 text-atlas-secondary hover:bg-atlas-elevated hover:text-atlas-text"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {vertical && groups.length > 0 && (
          <div className="flex flex-wrap gap-1 pb-1.5 border-b border-atlas-border">
            {groups.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => window.atlas.updateTabGroup(g.id, { collapsed: !g.collapsed })}
                className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium bg-atlas-surface border border-atlas-border text-atlas-secondary hover:text-atlas-text"
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
              onClick={() => void window.atlas.createTab({ url: 'atlas://newtab', activate: true })}
              title="New Tab (Cmd/Ctrl+T)"
              aria-label="New Tab"
              className="app-no-drag ml-1 mb-1 flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-[7px] text-atlas-muted hover:bg-atlas-elevated hover:text-atlas-text transition-colors"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          )}
        </div>

        {/* Right / Vertical Footer Actions */}
        <div
          className={`app-no-drag flex items-center gap-0.5 ${
            vertical ? 'pt-2 border-t border-atlas-border justify-between' : 'h-full shrink-0 pl-1'
          }`}
        >
          {vertical && (
            <button
              type="button"
              onClick={() => {
                setVerticalTabs(false);
                void window.atlas.updateSettings({ verticalTabs: false });
              }}
              title="Switch to Horizontal Tabs"
              className="rounded-md p-1.5 text-atlas-muted hover:bg-atlas-elevated hover:text-atlas-text transition-colors"
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
              className="rounded-[7px] p-1.5 text-atlas-muted hover:bg-atlas-elevated hover:text-atlas-text transition-colors"
            >
              <Search className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
            <button
              type="button"
              onClick={() => void window.atlas.restoreClosedTab()}
              title="Reopen Closed Tab (Cmd/Ctrl+Shift+T)"
              aria-label="Reopen Closed Tab"
              className="rounded-[7px] p-1.5 text-atlas-muted hover:bg-atlas-elevated hover:text-atlas-text transition-colors"
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
            className="atlas-glass fixed w-52 rounded-xl border border-atlas-border p-1.5 shadow-atlas-float text-xs text-atlas-text"
            onClick={(e) => e.stopPropagation()}
          >
            <CtxItem
              icon={<Copy className="h-3.5 w-3.5" />}
              label="Duplicate Tab"
              onClick={() => {
                void window.atlas.duplicateTab(contextMenu.tab.id);
                setContextMenu(null);
              }}
            />
            <CtxItem
              icon={<Pin className="h-3.5 w-3.5" />}
              label={contextMenu.tab.isPinned ? 'Unpin Tab' : 'Pin Tab'}
              onClick={() => {
                void window.atlas.pinTab(contextMenu.tab.id);
                setContextMenu(null);
              }}
            />
            <CtxItem
              icon={contextMenu.tab.isMuted ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
              label={contextMenu.tab.isMuted ? 'Unmute Tab' : 'Mute Tab'}
              onClick={() => {
                void window.atlas.muteTab(contextMenu.tab.id);
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
                const grp = await window.atlas.createTabGroup('Workspace');
                await window.atlas.assignTabGroup(contextMenu.tab.id, grp.id);
                setContextMenu(null);
              }}
            />
            <CtxItem
              icon={<Columns2 className="h-3.5 w-3.5" />}
              label={vertical ? 'Use Horizontal Tabs' : 'Use Vertical Tabs'}
              onClick={() => {
                const next = !vertical;
                setVerticalTabs(next);
                void window.atlas.updateSettings({ verticalTabs: next });
                setContextMenu(null);
              }}
            />
            <div className="my-1 border-t border-atlas-border" />
            <CtxItem
              icon={<X className="h-3.5 w-3.5" />}
              label="Close Tab"
              danger
              onClick={() => {
                void window.atlas.closeTab(contextMenu.tab.id);
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
      danger ? 'text-atlas-danger hover:bg-atlas-danger/10' : 'text-atlas-text hover:bg-atlas-elevated/80'
    }`}
  >
    <span className="text-atlas-muted">{icon}</span>
    <span>{label}</span>
  </button>
);
