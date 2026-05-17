from typing import Any

from datasets import Dataset


def add_tokens(item: dict[str, Any]):
    pred_tokens = tuple(item["prediction"].split("-"))
    ref_tokens = tuple(item["reference"].split("-"))
    item["prediction_tokens"] = pred_tokens
    item["reference_tokens"] = ref_tokens
    item["prediction_length"] = len(pred_tokens)
    item["reference_length"] = len(ref_tokens)
    return item


def transform_dataset(dataset: Dataset) -> Dataset:
    return dataset.map(add_tokens)
