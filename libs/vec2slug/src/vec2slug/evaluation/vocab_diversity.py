"""Vocabulary diversity measurement for predicted slugs.

Measures whether a model produces varied predictions or collapses to a small
set of generic labels. Pure reduce (no per-sample column to add).
"""

from typing import Any

import datasets

from .transform import Transform


class VocabDiversity(Transform):
    """Ratio of unique predicted slugs to total predictions."""

    def transform(self, dataset: datasets.Dataset) -> datasets.Dataset:
        # No per-sample column to add; all work is in evaluate
        return dataset

    def evaluate(
        self, dataset: datasets.Dataset, stats: dict[str, Any]
    ) -> dict[str, Any]:
        predictions = dataset["prediction"]
        total = len(predictions)
        unique = len(set(predictions))
        return {
            "vocab_diversity": unique / total if total > 0 else 0.0,
            "unique_predictions": unique,
        }
