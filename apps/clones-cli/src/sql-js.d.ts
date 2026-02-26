declare module 'sql.js' {
  export interface Database {
    run(sql: string, params?: unknown[]): void;
    exec(sql: string): unknown[];
    prepare(sql: string): Statement;
    export(): Uint8Array;
    close(): void;
  }

  export interface Statement {
    bind(params?: unknown[] | Record<string, unknown>): boolean;
    step(): boolean;
    getAsObject(): Record<string, unknown>;
    free(): void;
  }

  interface SqlJsStatic {
    Database: new (data?: ArrayLike<number> | Buffer | null) => Database;
  }

  export default function initSqlJs(options?: {
    wasmBinary?: ArrayLike<number> | Buffer;
    locateFile?: (filename: string) => string;
  }): Promise<SqlJsStatic>;
}
