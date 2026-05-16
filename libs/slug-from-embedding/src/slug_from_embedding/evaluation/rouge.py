"""ROUGE-L score between predicted and gold slugs.

Slugs are kebab-case, so we split on "-" to give ROUGE individual words.
Uses the rouge_score library directly for per-sample scores.
"""

from typing import Any

import datasets
import numpy as np
from rouge_score import rouge_scorer

from .transform import Transform


class Rouge(Transform):
    """ROUGE-1 and ROUGE-L between predicted and reference slugs."""

    def __init__(self):
        self._scorer = rouge_scorer.RougeScorer(["rouge1", "rougeL"], use_stemmer=False)

    def transform(self, dataset: datasets.Dataset) -> datasets.Dataset:
        # rouge_scorer has no batch API; per-pair loop is unavoidable
        rouge1_scores = []
        rouge_l_scores = []
        for pred, ref in zip(dataset["prediction"], dataset["reference"]):
            result = self._scorer.score(
                ref.replace("-", " "),
                pred.replace("-", " "),
            )

            rouge1_scores.append(result["rouge1"].fmeasure)
            rouge_l_scores.append(result["rougeL"].fmeasure)

        dataset = dataset.add_column("rouge1", rouge1_scores)
        dataset = dataset.add_column("rouge_l", rouge_l_scores)
        return dataset

    def evaluate(
        self, dataset: datasets.Dataset, stats: dict[str, Any]
    ) -> dict[str, Any]:
        return {
            "mean_rouge1": float(np.mean(dataset["rouge1"])),
            "mean_rouge_l": float(np.mean(dataset["rouge_l"])),
        }
