"""BERTScore between predicted and gold slugs.

Slugs are kebab-case, so we split on "-" to give BERTScore individual words.
Uses the bert_score library directly for per-sample scores.
"""

from typing import Any

import datasets
import numpy as np
from bert_score import score as bert_score_fn

from .transform import Transform


class BertScore(Transform):
    """BERTScore F1 between predicted and reference slugs."""

    def transform(self, dataset: datasets.Dataset) -> datasets.Dataset:
        preds = [p.replace("-", " ") for p in dataset["prediction"]]
        refs = [r.replace("-", " ") for r in dataset["reference"]]

        P, R, F1 = bert_score_fn(preds, refs, lang="en", verbose=False)

        dataset = dataset.add_column("bertscore_precision", P.tolist())
        dataset = dataset.add_column("bertscore_recall", R.tolist())
        dataset = dataset.add_column("bertscore_f1", F1.tolist())
        return dataset

    def evaluate(
        self, dataset: datasets.Dataset, stats: dict[str, Any]
    ) -> dict[str, Any]:
        return {
            "mean_bertscore_precision": np.mean(dataset["bertscore_precision"]),
            "mean_bertscore_recall": np.mean(dataset["bertscore_recall"]),
            "mean_bertscore_f1": np.mean(dataset["bertscore_f1"]),
        }
