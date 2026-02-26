import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Database as RawDatabase, Statement } from 'sql.js';

export type SqlValue = string | number | null | Uint8Array;

export interface SqlStatement {
  run(...params: SqlValue[]): void;
  get(...params: SqlValue[]): Record<string, SqlValue> | undefined;
  all(...params: SqlValue[]): Record<string, SqlValue>[];
}

type SqlJsStatic = {
  Database: new (data?: ArrayLike<number> | Buffer | null) => RawDatabase;
};

let cachedSqlJs: SqlJsStatic | null = null;

async function ensureSqlJs(): Promise<SqlJsStatic> {
  if (cachedSqlJs) return cachedSqlJs;

  const { default: initSqlJs } = await import('sql.js');

  // Help sql.js find its WASM file when running as a bundled CLI.
  const require = createRequire(import.meta.url);
  const wasmBinary = readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'));

  cachedSqlJs = (await initSqlJs({ wasmBinary })) as unknown as SqlJsStatic;
  return cachedSqlJs;
}

class WrappedStatement implements SqlStatement {
  private cached: Statement | null = null;

  constructor(
    private rawDb: RawDatabase,
    private sql: string,
    private markDirty: () => void
  ) {}

  private ensureStmt(): Statement {
    if (!this.cached) {
      this.cached = this.rawDb.prepare(this.sql);
    }
    return this.cached;
  }

  run(...params: SqlValue[]): void {
    const stmt = this.ensureStmt();
    stmt.reset();
    if (params.length > 0) {
      stmt.bind(params as Parameters<typeof stmt.bind>[0]);
    }
    stmt.step();
    this.markDirty();
  }

  get(...params: SqlValue[]): Record<string, SqlValue> | undefined {
    const stmt = this.ensureStmt();
    stmt.reset();
    if (params.length > 0) {
      stmt.bind(params as Parameters<typeof stmt.bind>[0]);
    }
    if (stmt.step()) {
      return stmt.getAsObject() as Record<string, SqlValue>;
    }
    return undefined;
  }

  all(...params: SqlValue[]): Record<string, SqlValue>[] {
    const stmt = this.ensureStmt();
    stmt.reset();
    if (params.length > 0) {
      stmt.bind(params as Parameters<typeof stmt.bind>[0]);
    }
    const results: Record<string, SqlValue>[] = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject() as Record<string, SqlValue>);
    }
    return results;
  }

  free(): void {
    if (this.cached) {
      this.cached.free();
      this.cached = null;
    }
  }
}

export class SqlDatabase {
  private dirty = false;
  private statements = new Set<WrappedStatement>();

  private constructor(
    private raw: RawDatabase,
    private filePath: string | null
  ) {}

  static async open(path: string): Promise<SqlDatabase> {
    const SQL = await ensureSqlJs();

    if (path === ':memory:') {
      return new SqlDatabase(new SQL.Database(), null);
    }

    if (existsSync(path)) {
      const buffer = readFileSync(path);
      return new SqlDatabase(new SQL.Database(buffer), path);
    }

    return new SqlDatabase(new SQL.Database(), path);
  }

  exec(sql: string): void {
    this.raw.exec(sql);
    this.dirty = true;
  }

  prepare(sql: string): SqlStatement {
    const stmt = new WrappedStatement(this.raw, sql, () => {
      this.dirty = true;
    });
    this.statements.add(stmt);
    return stmt;
  }

  transaction<T>(fn: () => T): () => T {
    return () => {
      this.raw.run('BEGIN TRANSACTION');
      try {
        const result = fn();
        this.raw.run('COMMIT');
        if (this.filePath) {
          this.save();
        }
        return result;
      } catch (error) {
        this.raw.run('ROLLBACK');
        throw error;
      }
    };
  }

  save(): void {
    if (!this.filePath) return;
    if (!this.dirty) return;
    const data = this.raw.export();
    const tempPath = join(dirname(this.filePath), `.db.${randomUUID()}.tmp`);
    writeFileSync(tempPath, Buffer.from(data));
    renameSync(tempPath, this.filePath);
    this.dirty = false;
  }

  close(): void {
    for (const stmt of this.statements) {
      stmt.free();
    }
    this.statements.clear();
    if (this.filePath) {
      this.save();
    }
    this.raw.close();
  }
}
