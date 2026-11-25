import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export class AtlasDatabase {
  public readonly db: Database.Database;

  constructor(dbPath: string, migrationsDir?: string) {
    const dir = path.dirname(dbPath);
    if (dbPath !== ':memory:' && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('synchronous = NORMAL');
    this.runMigrations(migrationsDir ?? this.resolveDefaultMigrationsDir());
  }

  private resolveDefaultMigrationsDir(): string {
    const candidates = [
      path.join(__dirname, 'migrations'),
      path.join(__dirname, '../db/migrations'),
      path.join(process.cwd(), 'src/main/db/migrations'),
      path.join(process.cwd(), 'dist/main/migrations')
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    throw new Error('Could not locate SQL migrations directory');
  }

  public runMigrations(migrationsDir: string): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      );
    `);

    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const getApplied = this.db.prepare('SELECT version FROM schema_migrations WHERE version = ?');
    const insertMigration = this.db.prepare(
      'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)'
    );

    for (const file of files) {
      const match = /^(\d+)_(.+)\.sql$/.exec(file);
      if (!match) continue;
      const version = Number(match[1]);
      const name = match[2];
      const existing = getApplied.get(version) as { version: number } | undefined;
      if (existing) continue;

      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      const tx = this.db.transaction(() => {
        this.db.exec(sql);
        insertMigration.run(version, name, Date.now());
      });
      tx();
    }
  }

  public checkIntegrity(): boolean {
    const row = this.db.pragma('integrity_check', { simple: true }) as string;
    return row === 'ok';
  }

  public transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  public close(): void {
    this.db.close();
  }
}
