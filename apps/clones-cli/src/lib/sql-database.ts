import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Database as RawDatabase } from 'sql.js';

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
  constructor(
    private rawDb: RawDatabase,
    private sql: string
  ) {}

  run(...params: SqlValue[]): void {
    this.rawDb.run(this.sql, params as Parameters<RawDatabase['run']>[1]);
  }

  get(...params: SqlValue[]): Record<string, SqlValue> | undefined {
    const stmt = this.rawDb.prepare(this.sql);
    try {
      if (params.length > 0) {
        stmt.bind(params as Parameters<typeof stmt.bind>[0]);
      }
      if (stmt.step()) {
        return stmt.getAsObject() as Record<string, SqlValue>;
      }
      return undefined;
    } finally {
      stmt.free();
    }
  }

  all(...params: SqlValue[]): Record<string, SqlValue>[] {
    const stmt = this.rawDb.prepare(this.sql);
    try {
      if (params.length > 0) {
        stmt.bind(params as Parameters<typeof stmt.bind>[0]);
      }
      const results: Record<string, SqlValue>[] = [];
      while (stmt.step()) {
        results.push(stmt.getAsObject() as Record<string, SqlValue>);
      }
      return results;
    } finally {
      stmt.free();
    }
  }
}

export class SqlDatabase {
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
  }

  prepare(sql: string): SqlStatement {
    return new WrappedStatement(this.raw, sql);
  }

  transaction<T>(fn: () => T): () => T {
    return () => {
      this.raw.run('BEGIN TRANSACTION');
      try {
        const result = fn();
        this.raw.run('COMMIT');
        return result;
      } catch (error) {
        this.raw.run('ROLLBACK');
        throw error;
      }
    };
  }

  save(): void {
    if (!this.filePath) return;
    const data = this.raw.export();
    writeFileSync(this.filePath, Buffer.from(data));
  }

  close(): void {
    if (this.filePath) {
      this.save();
    }
    this.raw.close();
  }
}
