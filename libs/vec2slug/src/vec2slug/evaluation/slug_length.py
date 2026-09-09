"""Slug length statistics.

Measures predicted and reference slug length in words (hyphen-separated
segments). Reports mean, median, and the length distribution so output
length can be compared against the training distribution.
"""

from typing import Any

import datasets
import numpy as np
import pyarrow as pa

from .transform import Transform


def word_count(slug: str) -> int:
    """Count hyphen-separated words in a slug."""
    return len(slug.split("-")) if slug else 0


class SlugLength(Transform):
    """Per-sample predicted and reference word counts, plus aggregate stats."""

    def transform(self, dataset: datasets.Dataset) -> datasets.Dataset:
        pred_lengths = pa.array([word_count(p) for p in dataset["prediction"]])
        ref_lengths = pa.array([word_count(r) for r in dataset["reference"]])
        dataset = dataset.add_column("pred_word_count", pred_lengths)
        dataset = dataset.add_column("ref_word_count", ref_lengths)
        return dataset

    def evaluate(
        self, dataset: datasets.Dataset, stats: dict[str, Any]
    ) -> dict[str, Any]:
        pred = np.array(dataset["pred_word_count"])
        ref = np.array(dataset["ref_word_count"])
        return {
            "pred_mean_words": float(np.mean(pred)),
            "pred_median_words": float(np.median(pred)),
            "ref_mean_words": float(np.mean(ref)),
            "ref_median_words": float(np.median(ref)),
        }
