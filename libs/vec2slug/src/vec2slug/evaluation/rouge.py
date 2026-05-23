"""ROUGE-L score between predicted and gold slugs.

Slugs are kebab-case, so we split on "-" to give ROUGE individual words.
Uses the rouge_score library directly for per-sample scores.
"""

import multiprocessing
from typing import Any

import datasets
import numpy as np
from rouge_score import rouge_scorer

from .transform import Transform


class Rouge(Transform):
    """ROUGE-1 and ROUGE-L between predicted and reference slugs."""

    def __init__(self):
        self._scorer = rouge_scorer.RougeScorer(["rouge1", "rougeL"], use_stemmer=False)

    def _score(self, prediction: str, reference: str) -> dict[str, float]:
        result = self._scorer.score(
            reference.replace("-", " "),
            prediction.replace("-", " "),
        )

        return {
            "rouge1": result["rouge1"].fmeasure,
            "rouge_l": result["rougeL"].fmeasure,
        }

    def transform(self, dataset: datasets.Dataset) -> datasets.Dataset:
        return dataset.map(
            lambda prediction, reference: self._score(prediction, reference),
            input_columns=["prediction", "reference"],
            num_proc=multiprocessing.cpu_count(),
        )

    def evaluate(
        self, dataset: datasets.Dataset, stats: dict[str, Any]
    ) -> dict[str, Any]:
        return {
            "mean_rouge1": float(np.mean(dataset["rouge1"])),
            "mean_rouge_l": float(np.mean(dataset["rouge_l"])),
        }
