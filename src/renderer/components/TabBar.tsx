import React, { useState } from 'react';
import {
  Bot,
  ChevronDown,
  ChevronRight,
  Copy,
  FolderPlus,
  Layers,
  Pin,
  Plus,
  RotateCcw,
  Search,
  Volume2,
  VolumeX,
  X
} from 'lucide-react';
import type { TabGroup, TabInfo } from '@shared/types';
import { useAtlasStore } from '../store/useAtlasStore';

interface TabBarProps {
  vertical: boolean;
}

export const TabBar: React.FC<TabBarProps> = ({ vertical }) => {
  const { tabs, activeTabId, groups, isPrivateWindow, setTabSearchOpen } = useAtlasStore();
  const [contextMenu, setContextMenu] = useState<{ tab: TabInfo; x: number; y: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [dragTabId, setDragTabId] = useState<string | null>(null);

  const groupMap = new Map<string, TabGroup>(groups.map((g) => [g.id, g]));

  const handleRenameSubmit = async (tabId: string) => {
    await window.atlas.renameTab(tabId, renameText.trim() || null);
    setRenamingId(null);
  };

  const renderTab = (tab: TabInfo, idx: number) => {
    const active = tab.id === activeTabId;
    const displayTitle = tab.customTitle || tab.title || tab.url || 'New Tab';
    const group = tab.groupId ? groupMap.get(tab.groupId) : undefined;
    if (group?.collapsed && !active) return null;

    return (
      <div
        key={tab.id}
        draggable
        onDragStart={() => setDragTabId(tab.id)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={async () => {
          if (dragTabId && dragTabId !== tab.id) {
            await window.atlas.reorderTab(dragTabId, idx);
          }
          setDragTabId(null);
        }}
        onClick={() => window.atlas.activateTab(tab.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenu({ tab, x: e.clientX, y: e.clientY });
        }}
        title={tab.url}
        className={`group app-no-drag relative flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs cursor-pointer transition-colors border ${
          vertical ? 'w-full' : tab.isPinned ? 'w-10 justify-center shrink-0' : 'min-w-[130px] max-w-[210px] flex-1'
        } ${
          active
            ? 'bg-atlas-surface text-atlas-text border-atlas-border shadow-sm'
            : 'bg-transparent text-atlas-muted hover:bg-atlas-elevated/70 border-transparent'
        }`}
        style={group ? { borderLeftWidth: 3, borderLeftColor: group.color } : undefined}
      >
        {tab.isLoading ? (
          <span className="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-atlas-accent border-t-transparent animate-spin" />
        ) : tab.favicon ? (
          <img src={tab.favicon} alt="" className="h-3.5 w-3.5 shrink-0 rounded-sm" />
        ) : (
          <span className="h-3.5 w-3.5 shrink-0 rounded-sm bg-atlas-elevated flex items-center justify-center text-[9px] font-bold">
            {(displayTitle[0] || 'A').toUpperCase()}
          </span>
        )}

        {(!tab.isPinned || vertical) && (
          renamingId === tab.id ? (
            <input
              autoFocus
              value={renameText}
              onChange={(e) => setRenameText(e.target.value)}
              onBlur={() => void handleRenameSubmit(tab.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleRenameSubmit(tab.id);
                if (e.key === 'Escape') setRenamingId(null);
              }}
              onClick={(e) => e.stopPropagation()}
              className="flex-1 min-w-0 bg-atlas-bg px-1 py-0.5 rounded text-xs text-atlas-text outline-none border border-atlas-accent"
            />
          ) : (
            <span className="flex-1 truncate font-medium">
              {tab.crashed ? '⚠ Crashed — ' : ''}
              {displayTitle}
            </span>
          )
        )}

        {tab.agentActive && (
          <Bot className="h-3.5 w-3.5 shrink-0 text-atlas-accent animate-pulse" aria-label="Agent active" />
        )}

        {tab.isPinned && !vertical && <Pin className="h-2.5 w-2.5 shrink-0 text-atlas-muted" />}

        {tab.isMuted && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void window.atlas.muteTab(tab.id);
            }}
            className="text-atlas-warning hover:text-atlas-text"
            aria-label="Unmute tab"
          >
            <VolumeX className="h-3 w-3" />
          </button>
        )}

        {(!tab.isPinned || vertical) && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void window.atlas.closeTab(tab.id);
            }}
            aria-label="Close tab"
            className="opacity-0 group-hover:opacity-100 rounded p-0.5 hover:bg-atlas-elevated text-atlas-muted hover:text-atlas-text transition-opacity"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
    );
  };

  return (
    <>
      <div
        className={
          vertical
            ? 'flex flex-col h-full w-56 bg-atlas-bg border-r border-atlas-border p-2 gap-1.5 select-none'
            : 'app-drag-region flex items-center h-10 bg-atlas-bg border-b border-atlas-border px-2 gap-1.5 select-none pl-20'
        }
      >
        {isPrivateWindow && (
          <span className="app-no-drag shrink-0 rounded bg-purple-600/20 text-purple-300 border border-purple-500/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
            Private
          </span>
        )}

        {vertical && groups.length > 0 && (
          <div className="flex flex-wrap gap-1 pb-1 border-b border-atlas-border">
            {groups.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => window.atlas.updateTabGroup(g.id, { collapsed: !g.collapsed })}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-atlas-surface border border-atlas-border"
                style={{ borderColor: g.color }}
              >
                {g.collapsed ? <ChevronRight className="h-2.5 w-2.5" /> : <ChevronDown className="h-2.5 w-2.5" />}
                {g.title}
              </button>
            ))}
          </div>
        )}

        <div
          className={
            vertical
              ? 'flex-1 overflow-y-auto flex flex-col gap-1'
              : 'flex-1 overflow-x-auto flex items-center gap-1 min-w-0'
          }
        >
          {tabs.map((tab, idx) => renderTab(tab, idx))}
        </div>

        <div className={`app-no-drag flex items-center gap-1 ${vertical ? 'pt-2 border-t border-atlas-border justify-between' : 'shrink-0'}`}>
          <button
            type="button"
            onClick={() => window.atlas.createTab({ activate: true })}
            title="New Tab (Cmd/Ctrl+T)"
            className="rounded-md p-1.5 text-atlas-muted hover:text-atlas-text hover:bg-atlas-elevated"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setTabSearchOpen(true)}
            title="Search Tabs (Cmd/Ctrl+Shift+A)"
            className="rounded-md p-1.5 text-atlas-muted hover:text-atlas-text hover:bg-atlas-elevated"
          >
            <Search className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => window.atlas.restoreClosedTab()}
            title="Restore Closed Tab (Cmd/Ctrl+Shift+T)"
            className="rounded-md p-1.5 text-atlas-muted hover:text-atlas-text hover:bg-atlas-elevated"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

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
            style={{ left: Math.min(contextMenu.x, window.innerWidth - 210), top: Math.min(contextMenu.y, window.innerHeight - 260) }}
            onClick={(e) => e.stopPropagation()}
            className="fixed w-52 rounded-xl border border-atlas-border bg-atlas-surface p-1.5 shadow-2xl text-xs text-atlas-text"
          >
            <button
              type="button"
              onClick={() => {
                void window.atlas.duplicateTab(contextMenu.tab.id);
                setContextMenu(null);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-atlas-elevated"
            >
              <Copy className="h-3.5 w-3.5" /> Duplicate Tab
            </button>
            <button
              type="button"
              onClick={() => {
                void window.atlas.pinTab(contextMenu.tab.id);
                setContextMenu(null);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-atlas-elevated"
            >
              <Pin className="h-3.5 w-3.5" /> {contextMenu.tab.isPinned ? 'Unpin Tab' : 'Pin Tab'}
            </button>
            <button
              type="button"
              onClick={() => {
                void window.atlas.muteTab(contextMenu.tab.id);
                setContextMenu(null);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-atlas-elevated"
            >
              {contextMenu.tab.isMuted ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
              {contextMenu.tab.isMuted ? 'Unmute Tab' : 'Mute Tab'}
            </button>
            <button
              type="button"
              onClick={() => {
                setRenameText(contextMenu.tab.customTitle || contextMenu.tab.title);
                setRenamingId(contextMenu.tab.id);
                setContextMenu(null);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-atlas-elevated"
            >
              <Layers className="h-3.5 w-3.5" /> Rename Tab
            </button>
            <button
              type="button"
              onClick={async () => {
                const grp = await window.atlas.createTabGroup('Research', '#3b82f6');
                await window.atlas.assignTabGroup(contextMenu.tab.id, grp.id);
                setContextMenu(null);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-atlas-elevated"
            >
              <FolderPlus className="h-3.5 w-3.5" /> Add to New Group
            </button>
            <div className="my-1 border-t border-atlas-border" />
            <button
              type="button"
              onClick={() => {
                void window.atlas.closeTab(contextMenu.tab.id);
                setContextMenu(null);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-atlas-danger hover:bg-atlas-danger/10"
            >
              <X className="h-3.5 w-3.5" /> Close Tab
            </button>
          </div>
        </div>
      )}
    </>
  );
};
