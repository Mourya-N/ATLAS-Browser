import path from 'node:path';
import { Pool } from 'pg';
import { runPostgresMigrations } from './postgres-repository';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL environment variable is required to run PostgreSQL migrations.');
    process.exit(1);
  }
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const migrationsDir = path.resolve(__dirname, './migrations');
    await runPostgresMigrations(pool, migrationsDir);
    console.log('PostgreSQL migrations applied successfully.');
  } finally {
    await pool.end();
  }
}

void main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
