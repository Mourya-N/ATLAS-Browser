import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  BookmarkEntry,
  BookmarkFolder,
  DownloadItem,
  HistoryEntry,
  ReadingListItem,
  TabGroup,
  TabInfo
} from '@shared/types';

export interface SavedTabRow {
  id: string;
  windowId: number;
  url: string;
  title: string;
  customTitle: string | null;
  favicon: string | null;
  isPinned: boolean;
  isMuted: boolean;
  groupId: string | null;
  orderIndex: number;
  zoomFactor: number;
  isActive: boolean;
  lastActiveAt: number;
}

export class BrowserRepository {
  constructor(private readonly db: Database.Database) {}

  // --- History ---
  recordVisit(url: string, title: string, favicon?: string | null): HistoryEntry {
    const now = Date.now();
    const existing = this.db
      .prepare('SELECT * FROM history WHERE url = ?')
      .get(url) as Record<string, unknown> | undefined;

    if (existing) {
      const newCount = Number(existing.visit_count) + 1;
      const resolvedTitle = title || String(existing.title);
      const resolvedFavicon = favicon ?? (existing.favicon as string | null);
      this.db
        .prepare(
          'UPDATE history SET title = ?, favicon = ?, visit_count = ?, last_visited_at = ? WHERE id = ?'
        )
        .run(resolvedTitle, resolvedFavicon, newCount, now, existing.id);
      return {
        id: String(existing.id),
        url,
        title: resolvedTitle,
        favicon: resolvedFavicon,
        visitCount: newCount,
        lastVisitedAt: now,
        firstVisitedAt: Number(existing.first_visited_at)
      };
    }

    const id = randomUUID();
    this.db
      .prepare(
        'INSERT INTO history (id, url, title, favicon, visit_count, last_visited_at, first_visited_at) VALUES (?, ?, ?, ?, 1, ?, ?)'
      )
      .run(id, url, title || url, favicon ?? null, now, now);

    return {
      id,
      url,
      title: title || url,
      favicon: favicon ?? null,
      visitCount: 1,
      lastVisitedAt: now,
      firstVisitedAt: now
    };
  }

  searchHistory(query = '', limit = 100, sinceMs?: number): HistoryEntry[] {
    const pattern = `%${query.trim()}%`;
    const rows = sinceMs
      ? (this.db
          .prepare(
            'SELECT * FROM history WHERE (url LIKE ? OR title LIKE ?) AND last_visited_at >= ? ORDER BY last_visited_at DESC LIMIT ?'
          )
          .all(pattern, pattern, sinceMs, limit) as Record<string, unknown>[])
      : (this.db
          .prepare(
            'SELECT * FROM history WHERE url LIKE ? OR title LIKE ? ORDER BY last_visited_at DESC LIMIT ?'
          )
          .all(pattern, pattern, limit) as Record<string, unknown>[]);

    return rows.map(this.mapHistoryRow);
  }

  getTopSites(limit = 8): HistoryEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM history ORDER BY visit_count DESC, last_visited_at DESC LIMIT ?')
      .all(limit) as Record<string, unknown>[];
    return rows.map(this.mapHistoryRow);
  }

  deleteHistoryItem(id: string): void {
    this.db.prepare('DELETE FROM history WHERE id = ?').run(id);
  }

  clearHistory(beforeMs?: number): void {
    if (beforeMs) {
      this.db.prepare('DELETE FROM history WHERE last_visited_at >= ?').run(beforeMs);
    } else {
      this.db.prepare('DELETE FROM history').run();
    }
  }

  private mapHistoryRow(r: Record<string, unknown>): HistoryEntry {
    return {
      id: String(r.id),
      url: String(r.url),
      title: String(r.title),
      favicon: (r.favicon as string | null) ?? null,
      visitCount: Number(r.visit_count),
      lastVisitedAt: Number(r.last_visited_at),
      firstVisitedAt: Number(r.first_visited_at)
    };
  }

  // --- Bookmarks ---
  listBookmarks(query = ''): { bookmarks: BookmarkEntry[]; folders: BookmarkFolder[] } {
    const foldersRows = this.db
      .prepare('SELECT * FROM bookmark_folders ORDER BY created_at ASC')
      .all() as Record<string, unknown>[];

    const pattern = `%${query.trim()}%`;
    const bmRows = query.trim()
      ? (this.db
          .prepare('SELECT * FROM bookmarks WHERE url LIKE ? OR title LIKE ? ORDER BY created_at DESC')
          .all(pattern, pattern) as Record<string, unknown>[])
      : (this.db
          .prepare('SELECT * FROM bookmarks ORDER BY created_at DESC')
          .all() as Record<string, unknown>[]);

    return {
      folders: foldersRows.map((f) => ({
        id: String(f.id),
        name: String(f.name),
        parentId: (f.parent_id as string | null) ?? null,
        createdAt: Number(f.created_at)
      })),
      bookmarks: bmRows.map((b) => ({
        id: String(b.id),
        url: String(b.url),
        title: String(b.title),
        folderId: (b.folder_id as string | null) ?? null,
        favicon: (b.favicon as string | null) ?? null,
        createdAt: Number(b.created_at),
        updatedAt: Number(b.updated_at)
      }))
    };
  }

  addBookmark(url: string, title: string, folderId?: string | null, favicon?: string | null): BookmarkEntry {
    const now = Date.now();
    const id = randomUUID();
    this.db
      .prepare(
        'INSERT INTO bookmarks (id, url, title, folder_id, favicon, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(id, url, title || url, folderId ?? null, favicon ?? null, now, now);
    return {
      id,
      url,
      title: title || url,
      folderId: folderId ?? null,
      favicon: favicon ?? null,
      createdAt: now,
      updatedAt: now
    };
  }

  updateBookmark(id: string, patch: { title?: string; url?: string; folderId?: string | null }): void {
    const existing = this.db.prepare('SELECT * FROM bookmarks WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!existing) return;
    this.db
      .prepare('UPDATE bookmarks SET title = ?, url = ?, folder_id = ?, updated_at = ? WHERE id = ?')
      .run(
        patch.title ?? String(existing.title),
        patch.url ?? String(existing.url),
        patch.folderId === undefined ? (existing.folder_id as string | null) : patch.folderId,
        Date.now(),
        id
      );
  }

  deleteBookmark(id: string): void {
    this.db.prepare('DELETE FROM bookmarks WHERE id = ?').run(id);
  }

  createBookmarkFolder(name: string, parentId?: string | null): BookmarkFolder {
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare('INSERT INTO bookmark_folders (id, name, parent_id, created_at) VALUES (?, ?, ?, ?)')
      .run(id, name, parentId ?? null, now);
    return { id, name, parentId: parentId ?? null, createdAt: now };
  }

  // --- Downloads ---
  upsertDownload(item: DownloadItem): void {
    this.db
      .prepare(
        `INSERT INTO downloads (id, url, filename, save_path, mime_type, total_bytes, received_bytes, state, is_dangerous, started_at, completed_at, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           save_path = excluded.save_path,
           total_bytes = excluded.total_bytes,
           received_bytes = excluded.received_bytes,
           state = excluded.state,
           completed_at = excluded.completed_at,
           error = excluded.error`
      )
      .run(
        item.id,
        item.url,
        item.filename,
        item.savePath,
        item.mimeType,
        item.totalBytes,
        item.receivedBytes,
        item.state,
        item.isDangerous ? 1 : 0,
        item.startedAt,
        item.completedAt ?? null,
        item.error ?? null
      );
  }

  listDownloads(limit = 100): DownloadItem[] {
    const rows = this.db
      .prepare('SELECT * FROM downloads ORDER BY started_at DESC LIMIT ?')
      .all(limit) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      url: String(r.url),
      filename: String(r.filename),
      savePath: String(r.save_path),
      mimeType: String(r.mime_type),
      totalBytes: Number(r.total_bytes),
      receivedBytes: Number(r.received_bytes),
      state: r.state as DownloadItem['state'],
      isDangerous: Boolean(r.is_dangerous),
      startedAt: Number(r.started_at),
      completedAt: (r.completed_at as number | null) ?? null,
      error: (r.error as string | null) ?? null
    }));
  }

  // --- Session Restore (Tabs & Groups) ---
  saveSessionSnapshot(tabs: TabInfo[], activeTabId: string | null, groups: TabGroup[]): void {
    const nonPrivateTabs = tabs.filter((t) => !t.isPrivate);
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM browser_tabs').run();
      this.db.prepare('DELETE FROM tab_groups').run();

      const insertGroup = this.db.prepare(
        'INSERT INTO tab_groups (id, title, color, collapsed, created_at) VALUES (?, ?, ?, ?, ?)'
      );
      for (const g of groups) {
        insertGroup.run(g.id, g.title, g.color, g.collapsed ? 1 : 0, g.createdAt);
      }

      const insertTab = this.db.prepare(
        `INSERT INTO browser_tabs (id, window_id, url, title, custom_title, favicon, is_pinned, is_muted, group_id, order_index, zoom_factor, is_active, last_active_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const t of nonPrivateTabs) {
        insertTab.run(
          t.id,
          t.windowId,
          t.url,
          t.title,
          t.customTitle ?? null,
          t.favicon ?? null,
          t.isPinned ? 1 : 0,
          t.isMuted ? 1 : 0,
          t.groupId ?? null,
          t.orderIndex,
          t.zoomFactor,
          t.id === activeTabId ? 1 : 0,
          t.lastActiveAt
        );
      }
    });
    tx();
  }

  loadSessionSnapshot(): { tabs: SavedTabRow[]; groups: TabGroup[] } {
    const groupRows = this.db
      .prepare('SELECT * FROM tab_groups ORDER BY created_at ASC')
      .all() as Record<string, unknown>[];
    const tabRows = this.db
      .prepare('SELECT * FROM browser_tabs ORDER BY order_index ASC')
      .all() as Record<string, unknown>[];

    return {
      groups: groupRows.map((g) => ({
        id: String(g.id),
        title: String(g.title),
        color: String(g.color),
        collapsed: Boolean(g.collapsed),
        createdAt: Number(g.created_at)
      })),
      tabs: tabRows.map((t) => ({
        id: String(t.id),
        windowId: Number(t.window_id),
        url: String(t.url),
        title: String(t.title),
        customTitle: (t.custom_title as string | null) ?? null,
        favicon: (t.favicon as string | null) ?? null,
        isPinned: Boolean(t.is_pinned),
        isMuted: Boolean(t.is_muted),
        groupId: (t.group_id as string | null) ?? null,
        orderIndex: Number(t.order_index),
        zoomFactor: Number(t.zoom_factor),
        isActive: Boolean(t.is_active),
        lastActiveAt: Number(t.last_active_at)
      }))
    };
  }

  // --- Reading List ---
  listReadingList(limit = 100): ReadingListItem[] {
    const rows = this.db
      .prepare('SELECT * FROM reading_list ORDER BY saved_at DESC LIMIT ?')
      .all(limit) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      url: String(r.url),
      title: String(r.title),
      siteName: (r.site_name as string | null) ?? null,
      excerpt: (r.excerpt as string | null) ?? null,
      status: (r.status as ReadingListItem['status']) || 'unread',
      progress: Number(r.progress ?? 0),
      savedAt: Number(r.saved_at),
      updatedAt: Number(r.updated_at)
    }));
  }

  saveReadingListItem(input: {
    url: string;
    title: string;
    siteName?: string | null;
    excerpt?: string | null;
    progress?: number;
  }): ReadingListItem {
    const now = Date.now();
    const existing = this.db
      .prepare('SELECT * FROM reading_list WHERE url = ?')
      .get(input.url) as Record<string, unknown> | undefined;

    if (existing) {
      const progress = input.progress ?? Number(existing.progress ?? 0);
      const status: ReadingListItem['status'] =
        progress >= 95 ? 'read' : progress > 5 ? 'reading' : ((existing.status as ReadingListItem['status']) || 'unread');
      this.db
        .prepare('UPDATE reading_list SET title = ?, site_name = ?, excerpt = ?, status = ?, progress = ?, updated_at = ? WHERE id = ?')
        .run(
          input.title || String(existing.title),
          input.siteName ?? existing.site_name ?? null,
          input.excerpt ?? existing.excerpt ?? null,
          status,
          progress,
          now,
          existing.id
        );
      return {
        id: String(existing.id),
        url: input.url,
        title: input.title || String(existing.title),
        siteName: input.siteName ?? (existing.site_name as string | null) ?? null,
        excerpt: input.excerpt ?? (existing.excerpt as string | null) ?? null,
        status,
        progress,
        savedAt: Number(existing.saved_at),
        updatedAt: now
      };
    }

    const id = randomUUID();
    const progress = input.progress ?? 0;
    const status: ReadingListItem['status'] = progress >= 95 ? 'read' : progress > 5 ? 'reading' : 'unread';
    this.db
      .prepare(
        'INSERT INTO reading_list (id, url, title, site_name, excerpt, status, progress, saved_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(id, input.url, input.title || input.url, input.siteName ?? null, input.excerpt ?? null, status, progress, now, now);

    return {
      id,
      url: input.url,
      title: input.title || input.url,
      siteName: input.siteName ?? null,
      excerpt: input.excerpt ?? null,
      status,
      progress,
      savedAt: now,
      updatedAt: now
    };
  }

  updateReadingListStatus(id: string, patch: { status?: ReadingListItem['status']; progress?: number }): void {
    const existing = this.db.prepare('SELECT * FROM reading_list WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!existing) return;
    const progress = patch.progress ?? Number(existing.progress ?? 0);
    const status = patch.status ?? (existing.status as ReadingListItem['status']);
    this.db
      .prepare('UPDATE reading_list SET status = ?, progress = ?, updated_at = ? WHERE id = ?')
      .run(status, progress, Date.now(), id);
  }

  deleteReadingListItem(id: string): void {
    this.db.prepare('DELETE FROM reading_list WHERE id = ?').run(id);
  }
}
