"""Split the corpus into train/val/test based on embedding clusters.

Uses KMeans clustering on the embeddings to group similar documents,
then assigns entire clusters to splits. This prevents near-duplicate
leakage: texts about the same topic stay in the same split.

Usage:
    uv run split_dataset.py openai     # split based on OpenAI embeddings
    uv run split_dataset.py harrier    # split based on harrier embeddings
    uv run split_dataset.py all        # both

Output:
    data/splits_openai.parquet         # columns: id, split
    data/splits_harrier.parquet        # columns: id, split
"""

from __future__ import annotations

import sys
from pathlib import Path

import duckdb
import numpy as np
from sklearn.cluster import KMeans

# ── Configuration ──────────────────────────────────────────────────────────────

DATA_DIR = Path(__file__).parent / "data"
CORPUS_FILE = DATA_DIR / "corpus_with_slugs.parquet"

# Target split ratios
TRAIN_RATIO = 0.80
VAL_RATIO = 0.10
TEST_RATIO = 0.10

# Number of clusters. More clusters = finer-grained grouping.
# Too few and large topic groups get split across train/test.
# Too many and we lose the grouping benefit.
# ~200 clusters for 10k docs gives ~50 docs per cluster on average.
N_CLUSTERS = 200

SEED = 42


# ── Core logic ────────────────────────────────────────────────────────────────


def load_embeddings(encoder: str) -> tuple[list[str], np.ndarray]:
    """Load (ids, embeddings) from the embedding parquet."""
    path = DATA_DIR / f"embeddings_{encoder}.parquet"
    if not path.exists():
        print(f"Embeddings not found: {path}")
        sys.exit(1)

    conn = duckdb.connect()
    rows = conn.execute(f"SELECT id, embedding FROM '{path}'").fetchall()
    conn.close()

    ids = [r[0] for r in rows]
    embeddings = np.array([r[1] for r in rows], dtype=np.float32)
    return ids, embeddings


def cluster_split(
    ids: list[str], embeddings: np.ndarray
) -> dict[str, str]:
    """Assign each document to train/val/test based on KMeans clusters.

    Entire clusters are assigned to one split, so near-duplicates
    (documents in the same cluster) never leak across splits.
    """
    print(f"Clustering {len(ids)} documents into {N_CLUSTERS} clusters...")
    kmeans = KMeans(n_clusters=N_CLUSTERS, random_state=SEED, n_init=10)
    labels = kmeans.fit_predict(embeddings)

    # Shuffle cluster IDs deterministically, then assign to splits
    rng = np.random.RandomState(SEED)
    cluster_order = rng.permutation(N_CLUSTERS)

    # Count documents per cluster to assign splits by cumulative count
    cluster_sizes = np.bincount(labels, minlength=N_CLUSTERS)
    total = len(ids)
    train_target = int(total * TRAIN_RATIO)
    val_target = int(total * (TRAIN_RATIO + VAL_RATIO))

    cluster_to_split = {}
    cumulative = 0
    for cluster_id in cluster_order:
        if cumulative < train_target:
            cluster_to_split[cluster_id] = "train"
        elif cumulative < val_target:
            cluster_to_split[cluster_id] = "val"
        else:
            cluster_to_split[cluster_id] = "test"
        cumulative += cluster_sizes[cluster_id]

    # Map documents to splits
    splits = {}
    for doc_id, cluster_id in zip(ids, labels):
        splits[doc_id] = cluster_to_split[cluster_id]

    # Report
    counts = {"train": 0, "val": 0, "test": 0}
    for s in splits.values():
        counts[s] += 1
    print(f"  train: {counts['train']} ({counts['train']/total:.1%})")
    print(f"  val:   {counts['val']} ({counts['val']/total:.1%})")
    print(f"  test:  {counts['test']} ({counts['test']/total:.1%})")

    return splits


def write_splits(splits: dict[str, str], encoder: str):
    """Write splits to parquet."""
    output_path = DATA_DIR / f"splits_{encoder}.parquet"

    conn = duckdb.connect()
    conn.execute("CREATE TABLE splits (id VARCHAR, split VARCHAR)")
    conn.executemany(
        "INSERT INTO splits VALUES (?, ?)", list(splits.items())
    )
    conn.execute(f"""
        COPY (SELECT * FROM splits)
        TO '{output_path}' (FORMAT PARQUET, COMPRESSION ZSTD)
    """)
    conn.close()
    print(f"Wrote {output_path}")


def split_for_encoder(encoder: str):
    """Run the full split pipeline for one encoder."""
    print(f"\n{'='*60}")
    print(f"  Splitting by {encoder} embeddings")
    print(f"{'='*60}\n")

    ids, embeddings = load_embeddings(encoder)
    splits = cluster_split(ids, embeddings)
    write_splits(splits, encoder)

    # Show how much the splits overlap with the slugged corpus
    conn = duckdb.connect()
    output_path = DATA_DIR / f"splits_{encoder}.parquet"
    matched = conn.execute(f"""
        SELECT s.split, count(*) as n
        FROM '{output_path}' s
        JOIN '{CORPUS_FILE}' c ON s.id = c.id
        GROUP BY s.split ORDER BY s.split
    """).fetchall()
    conn.close()
    print(f"\nWith slugs (from {CORPUS_FILE.name}):")
    for split, n in matched:
        print(f"  {split}: {n}")


# ── CLI ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: uv run split_dataset.py [openai|harrier|all]")
        sys.exit(1)

    command = sys.argv[1]
    if command == "all":
        split_for_encoder("openai")
        split_for_encoder("harrier")
    elif command in ("openai", "harrier"):
        split_for_encoder(command)
    else:
        print(f"Unknown encoder: {command}. Use 'openai', 'harrier', or 'all'.")
        sys.exit(1)
