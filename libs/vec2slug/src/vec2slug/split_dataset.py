"""Split the corpus into train/val/test based on embedding clusters.

Uses KMeans clustering to group similar documents, then assigns
entire clusters to splits to prevent near-duplicate leakage.

Usage:
    uv run slug-split openai
    uv run slug-split harrier
    uv run slug-split all
"""

import argparse
import math

import duckdb
import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq
from sklearn.cluster import MiniBatchKMeans

from .config import ENCODERS, SEED, TRAIN_RATIO, VAL_RATIO, Encoder
from .libs.workspace import SPLIT_SCHEMA, Id, Workspace


def cluster_split(
    ids: list[Id], embeddings: np.ndarray, *, n_clusters: int | None = None
) -> list[tuple[str, str, int]]:
    """Assign each document to train/val/test based on KMeans clusters.

    Returns list of (id, split, cluster) tuples.
    If n_clusters is not given, uses sqrt(n) heuristic with a minimum of 200.
    """
    if n_clusters is None:
        n_clusters = max(200, int(math.sqrt(len(ids))))

    print(f"Clustering {len(ids)} documents into {n_clusters} clusters...")
    kmeans = MiniBatchKMeans(
        n_clusters=n_clusters,
        random_state=SEED,
        n_init="auto",
        batch_size=min(15_000, len(ids)),
        verbose=1,
    )
    labels = kmeans.fit_predict(embeddings)

    rng = np.random.RandomState(SEED)
    cluster_order = rng.permutation(n_clusters)

    cluster_sizes = np.bincount(labels, minlength=n_clusters)
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

    results = []
    counts = {"train": 0, "val": 0, "test": 0}
    for document_id, cluster_id in zip(ids, labels):
        split = cluster_to_split[cluster_id]
        results.append((document_id, split, int(cluster_id)))
        counts[split] += 1

    print(f"  train: {counts['train']} ({counts['train'] / total:.1%})")
    print(f"  val:   {counts['val']} ({counts['val'] / total:.1%})")
    print(f"  test:  {counts['test']} ({counts['test'] / total:.1%})")

    return results


def split_for_encoder(workspace: Workspace, encoder: Encoder):
    print(f"\nSplitting by {encoder} embeddings\n")

    ids, embeddings = workspace.load_embeddings(encoder)
    rows = cluster_split(ids, embeddings)

    output = workspace.splits_path(encoder)
    output.parent.mkdir(parents=True, exist_ok=True)

    table = pa.table(
        {
            "id": [row[0] for row in rows],
            "split": [row[1] for row in rows],
            "cluster": [row[2] for row in rows],
        },
        schema=SPLIT_SCHEMA,
    )
    pq.write_table(table, output, compression="zstd")
    print(f"Wrote {len(rows)} split assignments to {output}")

    corpus_path = workspace.corpus_path()
    if corpus_path.exists():
        matched = duckdb.sql(f"""
            SELECT s.split, count(*) as n
            FROM '{output}' s
            JOIN '{corpus_path}' c ON s.id = c.id
            GROUP BY s.split ORDER BY s.split
        """).fetchall()
        print(f"\nWith slugs (from {corpus_path.name}):")
        for split, count in matched:
            print(f"  {split}: {count}")


def main():
    parser = argparse.ArgumentParser(description="Split corpus into train/val/test")
    parser.add_argument("encoder", choices=[*ENCODERS, "all"])
    parser.add_argument("--workspace", default="original")
    args = parser.parse_args()

    workspace = Workspace(args.workspace)

    if args.encoder == "all":
        for encoder in ENCODERS:
            split_for_encoder(workspace, encoder)
    else:
        split_for_encoder(workspace, args.encoder)


if __name__ == "__main__":
    main()
