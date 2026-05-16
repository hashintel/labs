"""Neighbor distinctiveness measurement for predicted slugs.

For each sample, finds its top-k nearest neighbors by cosine similarity in
embedding space, then measures how different the predicted slugs are using
similarity-weighted token-level Jaccard distance.

Weighting by cosine similarity means close neighbors (near-duplicates)
dominate the score while distant neighbors contribute little. This avoids
inflating distinctiveness for isolated documents whose "neighbors" are
not genuinely nearby.

High distinctiveness means the model assigns different slugs to nearby
embeddings: it can tell apart related-but-different documents. Low
distinctiveness means the model collapses to generic labels for similar inputs.
"""

from typing import Any

import datasets
import numpy as np

from .transform import Transform


def _jaccard_distance(a: set, b: set) -> float:
    """1 - Jaccard similarity. Returns 0 for identical sets, 1 for disjoint."""
    union = a | b
    if not union:
        return 0.0
    return 1.0 - len(a & b) / len(union)


class Distinctiveness(Transform):
    """Similarity-weighted Jaccard distance to top-k cosine neighbors in embedding space."""

    def __init__(self, k: int = 5):
        self.k = k

    def transform(self, dataset: datasets.Dataset) -> datasets.Dataset:
        # Arrow list<double> -> numpy via the flat values buffer (no Python iteration)
        arrow_col = dataset.data.column("text_embedding").combine_chunks()
        dim = arrow_col.offsets[1].as_py() - arrow_col.offsets[0].as_py()
        embeddings = arrow_col.values.to_numpy().reshape(-1, dim)

        # Pairwise cosine similarity. Self-similarity is set to -1 so that
        # argsort(row)[-k:] returns the k most similar *other* samples.
        # (Self would be at 1.0, the maximum; -1 pushes it to the bottom of
        # the ascending sort, so [-k:] never includes it.)
        norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
        normed = embeddings / np.maximum(norms, 1e-8)
        sim = normed @ normed.T
        np.fill_diagonal(sim, -1)

        # Tokenize all predicted slugs once
        token_sets = [set(slug.split("-")) for slug in dataset["prediction"]]

        # For each sample, compute similarity-weighted Jaccard distance to
        # its k nearest neighbors:
        #   distinctiveness_i = Σ(sim_ij * jaccard_ij) / Σ(sim_ij)
        # Close neighbors dominate; distant ones contribute little.
        # argpartition would be O(n) vs argsort's O(n log n) per row, but at
        # n~1000 the difference is negligible and argsort is clearer.
        n = len(dataset)
        per_sample = []
        for i in range(n):
            neighbor_indices = np.argsort(sim[i])[-self.k :]
            weights = np.array([sim[i, j] for j in neighbor_indices])
            distances = np.array(
                [
                    _jaccard_distance(token_sets[i], token_sets[j])
                    for j in neighbor_indices
                ]
            )
            weight_sum = weights.sum()
            if weight_sum > 0:
                d = float((weights * distances).sum() / weight_sum)
            else:
                d = 0.0
            per_sample.append(d)

        return dataset.add_column("distinctiveness", per_sample)

    def evaluate(
        self, dataset: datasets.Dataset, stats: dict[str, Any]
    ) -> dict[str, Any]:
        return {
            "mean_distinctiveness": float(np.mean(dataset["distinctiveness"])),
        }
