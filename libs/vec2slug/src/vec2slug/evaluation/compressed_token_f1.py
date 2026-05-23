"""Token F1 with references mapped through vocab compression.

When the model outputs compressed vocab representatives, comparing
against raw reference slugs penalizes synonym-level differences that
the model can't control. This transform maps reference tokens through
the same compression mapping before computing F1, giving a fairer
measure of model quality.
"""

import json
from pathlib import Path
from typing import Any

import datasets
import numpy as np

from .slug_token_f1 import _compute_slug_token_f1
from .transform import Transform


class CompressedTokenF1(Transform):
    """Token F1 with references mapped through compression."""

    def __init__(self, compression_path: Path):
        self.compression = json.loads(compression_path.read_text())

    def _compress_tokens(self, tokens: list[str]) -> list[str]:
        return [self.compression.get(token, token) for token in tokens]

    def transform(self, dataset: datasets.Dataset) -> datasets.Dataset:
        compressed_refs = [
            self._compress_tokens(list(tokens))
            for tokens in dataset["reference_tokens"]
        ]

        result = _compute_slug_token_f1(
            prediction_tokens=[list(tokens) for tokens in dataset["prediction_tokens"]],
            reference_tokens=compressed_refs,
        )

        dataset = dataset.add_column("compressed_f1_precision", result["f1_precision"].tolist())
        dataset = dataset.add_column("compressed_f1_recall", result["f1_recall"].tolist())
        dataset = dataset.add_column("compressed_f1", result["f1"].tolist())
        return dataset

    def evaluate(
        self, dataset: datasets.Dataset, stats: dict[str, Any]
    ) -> dict[str, Any]:
        return {
            "compressed_mean_f1_precision": float(np.mean(dataset["compressed_f1_precision"])),
            "compressed_mean_f1_recall": float(np.mean(dataset["compressed_f1_recall"])),
            "compressed_mean_f1": float(np.mean(dataset["compressed_f1"])),
        }
