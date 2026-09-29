/**
 * Простой SQL-раннер миграций на `pg` (без ORM — решение PD-0, см. README «Миграции»).
 *
 * - Файлы `migrations/NNNN_name.sql` применяются по алфавиту, каждый в своей транзакции.
 * - Применённые запоминаются в таблице `schema_migrations(name, applied_at)`.
 * - Откатов нет: исправление — новой миграцией вперёд.
 *
 * Запуск: `pnpm --filter @pundoku/api migrate` (dev, tsx) или `node dist/db/migrate.js`
 * (в Docker перед стартом сервера). Папка миграций — `./migrations` относительно
 * рабочей директории процесса (apps/api локально, /app в контейнере).
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { env } from "../config/env.js";

const MIGRATIONS_DIR = path.resolve(process.cwd(), "migrations");

async function listMigrationFiles(): Promise<string[]> {
  const entries = await readdir(MIGRATIONS_DIR);
  return entries.filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
}

export async function runMigrations(databaseUrl: string): Promise<string[]> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    const done = new Set(
      (await client.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name),
    );

    for (const file of await listMigrationFiles()) {
      if (done.has(file)) continue;
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`Миграция ${file} не применилась: ${(error as Error).message}`, { cause: error });
      }
      applied.push(file);
    }
  } finally {
    await client.end();
  }
  return applied;
}

const isDirectRun = process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isDirectRun) {
  runMigrations(env.databaseUrl)
    .then((applied) => {
      console.log(applied.length === 0 ? "[migrate] нет новых миграций" : `[migrate] применено: ${applied.join(", ")}`);
    })
    .catch((error: unknown) => {
      console.error("[migrate] ошибка:", error);
      process.exit(1);
    });
}
