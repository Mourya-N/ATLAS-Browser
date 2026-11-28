import React from 'react';
import {
  BookOpen,
  Bookmark,
  Columns2,
  Download,
  History,
  PanelLeftClose,
  Rows3,
  Search,
  Settings,
  Shield,
  Sparkles
} from 'lucide-react';
import { useLavrayStore, type OverlayView } from '../store/useLavrayStore';
import { LavrayMark } from './BrandMarks';

export const SidebarRail: React.FC = () => {
  const {
    sidebarOpen,
    setSidebarOpen,
    activeOverlayView,
    setOverlayView,
    openLavraySearch,
    verticalTabs,
    setVerticalTabs,
    downloads,
    adBlockStats
  } = useLavrayStore();

  if (!sidebarOpen) return null;

  const activeDownloads = downloads.filter((d) => d.state === 'progressing').length;

  const navBtn = (
    active: boolean,
    title: string,
    icon: React.ReactNode,
    onClick: () => void,
    badge?: number | string
  ) => (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`relative flex h-8 w-8 items-center justify-center rounded-lg transition-colors duration-150 ${
        active
          ? 'bg-lavray-surface text-lavray-accent border border-lavray-border'
          : 'text-lavray-muted hover:bg-lavray-elevated hover:text-lavray-text'
      }`}
    >
      {icon}
      {badge !== undefined && (
        <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-lavray-accent px-1 text-[9px] font-semibold text-lavray-accent-fg">
          {badge}
        </span>
      )}
    </button>
  );

  const toggleOverlay = (view: Exclude<OverlayView, null>) => {
    setOverlayView(activeOverlayView === view ? null : view);
  };

  return (
    <nav
      aria-label="LAVRAY Workspace Sidebar"
      className="flex h-full w-11 shrink-0 flex-col items-center justify-between border-r border-lavray-border bg-lavray-shell py-2.5 select-none"
    >
      {/* Primary Views */}
      <div className="flex flex-col items-center gap-1">
        {navBtn(
          activeOverlayView === null,
          'Active Tab',
          <LavrayMark className="h-[16px] w-[16px]" />,
          () => setOverlayView(null)
        )}
        {navBtn(
          activeOverlayView === 'search',
          'LAVRAY Intelligent Search (Advanced Research)',
          <Search className="h-[15px] w-[15px]" strokeWidth={1.75} />,
          () => (activeOverlayView === 'search' ? setOverlayView(null) : openLavraySearch(''))
        )}
        {navBtn(
          activeOverlayView === 'intelligence',
          'Research Workspace',
          <Sparkles className="h-[15px] w-[15px]" strokeWidth={1.75} />,
          () => toggleOverlay('intelligence')
        )}
        {navBtn(
          activeOverlayView === 'reader',
          'Reading Mode & List',
          <BookOpen className="h-[15px] w-[15px]" strokeWidth={1.75} />,
          () => toggleOverlay('reader')
        )}

        <div className="my-1.5 h-px w-5 bg-lavray-border" />

        {navBtn(
          activeOverlayView === 'bookmarks',
          'Bookmarks',
          <Bookmark className="h-[15px] w-[15px]" strokeWidth={1.75} />,
          () => toggleOverlay('bookmarks')
        )}
        {navBtn(
          activeOverlayView === 'history',
          'History',
          <History className="h-[15px] w-[15px]" strokeWidth={1.75} />,
          () => toggleOverlay('history')
        )}
        {navBtn(
          activeOverlayView === 'downloads',
          'Downloads',
          <Download className="h-[15px] w-[15px]" strokeWidth={1.75} />,
          () => toggleOverlay('downloads'),
          activeDownloads > 0 ? activeDownloads : undefined
        )}
      </div>

      {/* Layout, Privacy & Preferences */}
      <div className="flex flex-col items-center gap-1">
        {navBtn(
          verticalTabs,
          verticalTabs ? 'Switch to Horizontal Tabs' : 'Switch to Vertical Tabs',
          verticalTabs ? (
            <Rows3 className="h-[15px] w-[15px]" strokeWidth={1.75} />
          ) : (
            <Columns2 className="h-[15px] w-[15px]" strokeWidth={1.75} />
          ),
          () => {
            const next = !verticalTabs;
            setVerticalTabs(next);
            void window.lavray.updateSettings({ verticalTabs: next });
          }
        )}
        {navBtn(
          activeOverlayView === 'audit',
          `Privacy & Shield (${adBlockStats?.totalBlocked ?? 0} blocked)`,
          <Shield className="h-[15px] w-[15px]" strokeWidth={1.75} />,
          () => toggleOverlay('audit')
        )}
        {navBtn(
          activeOverlayView === 'settings',
          'Settings',
          <Settings className="h-[15px] w-[15px]" strokeWidth={1.75} />,
          () => toggleOverlay('settings')
        )}
        <button
          type="button"
          onClick={() => setSidebarOpen(false)}
          title="Collapse Sidebar (Cmd/Ctrl+B)"
          aria-label="Collapse Sidebar"
          className="mt-0.5 flex h-7 w-8 items-center justify-center rounded-lg text-lavray-muted hover:bg-lavray-elevated hover:text-lavray-text transition-colors"
        >
          <PanelLeftClose className="h-[15px] w-[15px]" strokeWidth={1.75} />
        </button>
      </div>
    </nav>
  );
};
