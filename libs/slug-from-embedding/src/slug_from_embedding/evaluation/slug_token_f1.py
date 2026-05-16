"""Bag-of-words token F1 between predicted and gold kebab-case slugs.

Splits each slug on "-" to get individual tokens, then computes set-overlap
precision, recall, and F1. Ignores token ordering (ROUGE-L captures that).

Example:
    pred = "react-concurrent-suspense"
    gold = "react-suspense-data-fetching"
    tokens_pred = {react, concurrent, suspense}
    tokens_gold = {react, suspense, data, fetching}
    common = {react, suspense}
    precision = 2/3, recall = 2/4, f1 = 4/7
"""

from typing import Any

import datasets
import numpy as np

from slug_from_embedding.evaluation.transform import Transform


def _compute_slug_token_f1(
    *,
    prediction_tokens: list[list[str]],
    reference_tokens: list[list[str]],
) -> dict[str, Any]:
    uniq_prediction_tokens = [set(tokens) for tokens in prediction_tokens]
    uniq_reference_tokens = [set(tokens) for tokens in reference_tokens]

    prediction_count = np.array(
        [len(tokens) for tokens in uniq_prediction_tokens], dtype=np.float32
    )
    reference_count = np.array(
        [len(tokens) for tokens in uniq_reference_tokens], dtype=np.float32
    )

    common = np.array(
        [
            len(pred & ref)
            for pred, ref in zip(uniq_prediction_tokens, uniq_reference_tokens)
        ],
        dtype=np.float32,
    )

    precision = np.divide(
        common, prediction_count, out=np.zeros_like(common), where=prediction_count != 0
    )
    recall = np.divide(
        common, reference_count, out=np.zeros_like(common), where=reference_count != 0
    )

    denom = precision + recall
    f1 = np.divide(
        2 * precision * recall,
        denom,
        out=np.zeros_like(common),
        where=denom != 0,
    )

    return {
        "f1_precision": precision,
        "f1_recall": recall,
        "f1": f1,
    }


class SlugTokenF1(Transform):
    def transform(self, dataset: datasets.Dataset) -> datasets.Dataset:
        return dataset.map(
            lambda pred_tok, ref_tok: _compute_slug_token_f1(
                prediction_tokens=pred_tok,
                reference_tokens=ref_tok,
            ),
            input_columns=["prediction_tokens", "reference_tokens"],
            batched=True,
        )

    def evaluate(
        self, dataset: datasets.Dataset, stats: dict[str, Any]
    ) -> dict[str, Any]:

        return {
            "mean_f1_precision": np.mean(dataset["f1_precision"]),
            "mean_f1_recall": np.mean(dataset["f1_recall"]),
            "mean_f1": np.mean(dataset["f1"]),
        }
