import pg from "pg";
import type { ColumnInfo, ForeignKey, TableConfig } from "./types.js";

export async function introspectTables(
  url: string,
  tables: Record<string, TableConfig>,
): Promise<Record<string, TableConfig>> {
  const pool = new pg.Pool({ connectionString: url });
  try {
    const result: Record<string, TableConfig> = {};
    for (const [name, tc] of Object.entries(tables)) {
      const columns = await discoverColumns(pool, name);
      const discoveredFks = await discoverForeignKeys(pool, name);
      const foreignKeys = { ...discoveredFks, ...tc.foreignKeys };

      result[name] = {
        primaryKey: tc.primaryKey,
        columns,
        foreignKeys: Object.keys(foreignKeys).length > 0 ? foreignKeys : undefined,
      };
    }
    return result;
  } finally {
    await pool.end();
  }
}

async function discoverColumns(pool: pg.Pool, table: string): Promise<ColumnInfo[]> {
  const { rows } = await pool.query(
    `SELECT column_name, data_type, is_nullable
     FROM information_schema.columns
     WHERE table_name = $1 AND table_schema = 'public'
     ORDER BY ordinal_position`,
    [table],
  );
  return rows.map((r) => ({
    name: r.column_name as string,
    type: r.data_type as string,
    nullable: r.is_nullable === "YES",
  }));
}

async function discoverForeignKeys(
  pool: pg.Pool,
  table: string,
): Promise<Record<string, ForeignKey>> {
  const { rows } = await pool.query(
    `SELECT
       kcu.column_name,
       ccu.table_name  AS ref_table,
       ccu.column_name AS ref_column
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
     JOIN information_schema.constraint_column_usage ccu
       ON tc.constraint_name = ccu.constraint_name
       AND tc.table_schema = ccu.table_schema
     WHERE tc.constraint_type = 'FOREIGN KEY'
       AND tc.table_name = $1
       AND tc.table_schema = 'public'`,
    [table],
  );

  const fks: Record<string, ForeignKey> = {};
  for (const r of rows) {
    const col = r.column_name as string;
    fks[col] = {
      columns: col,
      references: r.ref_table as string,
      on: r.ref_column as string,
    };
  }
  return fks;
}
