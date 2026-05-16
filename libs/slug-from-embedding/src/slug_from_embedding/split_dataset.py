"""Split the corpus into train/val/test based on embedding clusters.

Uses KMeans clustering to group similar documents, then assigns
entire clusters to splits to prevent near-duplicate leakage.

Usage:
    uv run -m slug_from_embedding.split_dataset openai
    uv run -m slug_from_embedding.split_dataset harrier
    uv run -m slug_from_embedding.split_dataset all
"""


import sys

import numpy as np
from sklearn.cluster import KMeans

from .config import (
    CORPUS_WITH_SLUGS_FILE,
    ENCODERS,
    N_CLUSTERS,
    SEED,
    TEST_RATIO,
    TRAIN_RATIO,
    VAL_RATIO,
    embeddings_file,
    splits_file,
)
from .io import load_embeddings, write_id_column


def cluster_split(ids: list[str], embeddings: np.ndarray) -> dict[str, str]:
    """Assign each document to train/val/test based on KMeans clusters."""
    print(f"Clustering {len(ids)} documents into {N_CLUSTERS} clusters...")
    kmeans = KMeans(n_clusters=N_CLUSTERS, random_state=SEED, n_init=10)
    labels = kmeans.fit_predict(embeddings)

    rng = np.random.RandomState(SEED)
    cluster_order = rng.permutation(N_CLUSTERS)

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

    splits = {}
    for doc_id, cluster_id in zip(ids, labels):
        splits[doc_id] = cluster_to_split[cluster_id]

    counts = {"train": 0, "val": 0, "test": 0}
    for s in splits.values():
        counts[s] += 1
    print(f"  train: {counts['train']} ({counts['train']/total:.1%})")
    print(f"  val:   {counts['val']} ({counts['val']/total:.1%})")
    print(f"  test:  {counts['test']} ({counts['test']/total:.1%})")

    return splits


def split_for_encoder(encoder: str):
    print(f"\n{'='*60}")
    print(f"  Splitting by {encoder} embeddings")
    print(f"{'='*60}\n")

    ids, embeddings = load_embeddings(embeddings_file(encoder))
    splits = cluster_split(ids, embeddings)
    output = splits_file(encoder)
    write_id_column(splits, output, columns=("id", "split"))

    # Show overlap with slugged corpus
    import duckdb
    matched = duckdb.sql(f"""
        SELECT s.split, count(*) as n
        FROM '{output}' s
        JOIN '{CORPUS_WITH_SLUGS_FILE}' c ON s.id = c.id
        GROUP BY s.split ORDER BY s.split
    """).fetchall()
    print(f"\nWith slugs (from {CORPUS_WITH_SLUGS_FILE.name}):")
    for split, n in matched:
        print(f"  {split}: {n}")


def main():
    if len(sys.argv) < 2:
        names = ", ".join(ENCODERS)
        print(f"Usage: uv run -m slug_from_embedding.split_dataset [{names}|all]")
        sys.exit(1)

    command = sys.argv[1]
    if command == "all":
        for encoder in ENCODERS:
            split_for_encoder(encoder)
    elif command in ENCODERS:
        split_for_encoder(command)
    else:
        print(f"Unknown encoder: {command}")
        sys.exit(1)


if __name__ == "__main__":
    main()
