"""Length bucket breakdown of evaluation metrics.

Assigns each sample to a source text length bucket based on token_count,
then computes per-bucket aggregate metrics. This surfaces whether model
quality correlates with document length independently of source.
"""

from typing import Any

import datasets
import numpy as np

from .transform import Transform

# Bucket boundaries in tokens (inclusive lower, exclusive upper)
BUCKETS = [
    (50, 200, "short"),
    (200, 500, "medium"),
    (500, 1000, "long"),
]


def _assign_bucket(token_count: int) -> str:
    for lo, hi, name in BUCKETS:
        if lo <= token_count < hi:
            return name
    return "other"


class LengthBucket(Transform):
    """Breaks down key metrics by source text length bucket."""

    def transform(self, dataset: datasets.Dataset) -> datasets.Dataset:
        return dataset.map(
            lambda token_count: {"length_bucket": _assign_bucket(token_count)},
            input_columns=["token_count"],
        )

    def evaluate(
        self, dataset: datasets.Dataset, stats: dict[str, Any]
    ) -> dict[str, Any]:
        breakdown = {}
        for bucket in sorted(set(dataset["length_bucket"])):
            subset = dataset.filter(lambda row, b=bucket: row["length_bucket"] == b)
            breakdown[bucket] = {
                "n": len(subset),
                "mean_token_count": np.mean(subset["token_count"]),
                "exact_match": np.mean(subset["exact_match"]),
                "mean_f1": np.mean(subset["f1"]),
                "mean_rouge_l": np.mean(subset["rouge_l"]),
                "mean_bertscore_f1": np.mean(subset["bertscore_f1"]),
                "mean_distinctiveness": np.mean(subset["distinctiveness"]),
            }
        return {"per_length_bucket": breakdown}
