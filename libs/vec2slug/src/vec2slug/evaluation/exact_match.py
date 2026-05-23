"""Exact match between predicted and gold slugs.

Adds a per-sample boolean column and reports the overall match rate.
"""

from typing import Any

import datasets
import numpy as np
import pyarrow.compute as pc

from .transform import Transform


class ExactMatch(Transform):
    """Exact string match between predicted and reference slugs."""

    def transform(self, dataset: datasets.Dataset) -> datasets.Dataset:
        matches = pc.equal(
            dataset.data.column("prediction"),
            dataset.data.column("reference"),
        )

        return dataset.add_column("exact_match", matches)

    def evaluate(
        self, dataset: datasets.Dataset, stats: dict[str, Any]
    ) -> dict[str, Any]:
        return {
            "exact_match": np.mean(dataset["exact_match"]),
        }
