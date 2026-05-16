"""Shared I/O helpers for parquet read/write via DuckDB."""

from pathlib import Path

import duckdb
import numpy as np


def load_corpus_texts(corpus_file: Path) -> list[tuple[str, str]]:
    """Load (id, text) pairs from a corpus parquet."""
    return duckdb.sql(f"SELECT id, text FROM '{corpus_file}' ORDER BY id").fetchall()


def write_embeddings(ids: list[str], embeddings: np.ndarray, output_path: Path):
    """Write id + embedding array to parquet via DuckDB."""
    import pyarrow as pa

    dim = embeddings.shape[1]
    embeddings_tbl = pa.table(
        {
            "id": ids,
            "embedding": [embeddings[i].tolist() for i in range(len(ids))],
        }
    )

    conn = duckdb.connect()
    conn.execute(f"""
        COPY (SELECT * FROM embeddings_tbl)
        TO '{output_path}' (FORMAT PARQUET, COMPRESSION ZSTD)
    """)
    conn.close()
    print(f"Wrote {len(ids)} embeddings ({dim}d) to {output_path}")


def load_embeddings(embeddings_file: Path) -> tuple[list[str], np.ndarray]:
    """Load (ids, embeddings) from an embeddings parquet."""
    conn = duckdb.connect()
    rows = conn.execute(
        f"SELECT id, embedding FROM '{embeddings_file}' ORDER BY id"
    ).fetchall()
    conn.close()

    ids = [r[0] for r in rows]
    embeddings = np.array([r[1] for r in rows], dtype=np.float32)
    return ids, embeddings


def write_id_column(
    data: dict[str, str], output_path: Path, columns: tuple[str, str] = ("id", "value")
):
    """Write a dict as a two-column parquet (id -> value)."""
    conn = duckdb.connect()
    conn.execute(f"CREATE TABLE tbl ({columns[0]} VARCHAR, {columns[1]} VARCHAR)")
    conn.executemany("INSERT INTO tbl VALUES (?, ?)", list(data.items()))
    conn.execute(f"""
        COPY (SELECT * FROM tbl)
        TO '{output_path}' (FORMAT PARQUET, COMPRESSION ZSTD)
    """)
    conn.close()
    print(f"Wrote {len(data)} rows to {output_path}")
