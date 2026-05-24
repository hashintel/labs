"""Per-source breakdown of evaluation metrics.

Slices the dataset by the `source` column and runs evaluate on each
subset, nesting the results under a `per_source` key.
"""

from typing import Any

import datasets
import numpy as np

from .transform import Transform


class PerSource(Transform):
    """Breaks down key metrics by source (arxiv, fineweb-edu, github-issues)."""

    def transform(self, dataset: datasets.Dataset) -> datasets.Dataset:
        return dataset

    def evaluate(
        self, dataset: datasets.Dataset, stats: dict[str, Any]
    ) -> dict[str, Any]:
        breakdown = {}
        for source in sorted(set(dataset["source"])):
            subset = dataset.filter(lambda row, s=source: row["source"] == s)
            breakdown[source] = {
                "n": len(subset),
                "exact_match": np.mean(subset["exact_match"]),
                "mean_f1": np.mean(subset["f1"]),
                "mean_rouge1": np.mean(subset["rouge1"]),
                "mean_rouge_l": np.mean(subset["rouge_l"]),
                "mean_bertscore_f1": np.mean(subset["bertscore_f1"]),
            }
        return {"per_source": breakdown}
