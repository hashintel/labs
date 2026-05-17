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
import torch
from tqdm import tqdm

from ..training.config import resolve_device
from .transform import Transform


def _jaccard_distance(a: set, b: set) -> float:
    """1 - Jaccard similarity. Returns 0 for identical sets, 1 for disjoint."""
    union = a | b
    if not union:
        return 0.0
    return 1.0 - len(a & b) / len(union)


class Distinctiveness(Transform):
    """Similarity-weighted Jaccard distance to top-k cosine neighbors in embedding space.

    Computes in batches to avoid materializing the full n×n similarity matrix.
    Each batch computes similarity against all embeddings, finds top-k
    neighbors, and discards the partial similarity rows. Memory is
    O(batch_size × n) instead of O(n²).
    """

    def __init__(self, k: int = 5, batch_size: int = 2048, device: str | None = None):
        self.k = k
        self.batch_size = batch_size
        self.device = device or resolve_device()

    def transform(self, dataset: datasets.Dataset) -> datasets.Dataset:
        n = len(dataset)

        # Arrow list<float> -> numpy via the flat values buffer
        arrow_col = dataset.data.column("text_embedding").combine_chunks()
        dim = arrow_col.offsets[1].as_py() - arrow_col.offsets[0].as_py()
        embeddings = arrow_col.values.to_numpy().reshape(-1, dim).astype(np.float32)

        # Normalize and upload to device once
        normed = torch.from_numpy(embeddings)
        normed = normed / normed.norm(dim=1, keepdim=True).clamp(min=1e-8)
        normed = normed.to(self.device)

        token_sets = [set(slug.split("-")) for slug in dataset["prediction"]]

        per_sample = np.zeros(n)
        for start in tqdm(
            range(0, n, self.batch_size),
            desc="Distinctiveness",
            unit="batch",
        ):
            end = min(start + self.batch_size, n)
            # [batch_size, dim] @ [dim, n] -> [batch_size, n] on device
            batch_sim = normed[start:end] @ normed.T
            # Zero out self-similarity
            idx = torch.arange(end - start, device=self.device)
            batch_sim[idx, idx + start] = -1.0

            # Top-k on device, then transfer indices to CPU
            _, top_indices = batch_sim.topk(self.k, dim=1)
            top_indices = top_indices.cpu().numpy()
            batch_sim_cpu = batch_sim.cpu().numpy()

            for i in range(end - start):
                global_i = start + i
                neighbors = top_indices[i]
                weights = batch_sim_cpu[i, neighbors]
                distances = np.array(
                    [
                        _jaccard_distance(token_sets[global_i], token_sets[j])
                        for j in neighbors
                    ]
                )
                weight_sum = weights.sum()
                if weight_sum > 0:
                    per_sample[global_i] = (
                        (weights * distances).sum() / weight_sum
                    )

        return dataset.add_column("distinctiveness", per_sample.tolist())

    def evaluate(
        self, dataset: datasets.Dataset, stats: dict[str, Any]
    ) -> dict[str, Any]:
        return {
            "mean_distinctiveness": float(np.mean(dataset["distinctiveness"])),
        }
