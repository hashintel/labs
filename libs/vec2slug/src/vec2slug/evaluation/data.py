from typing import Any

from datasets import Dataset


def _split_slug(slug: str) -> tuple[str, ...]:
    """Split a slug into tokens, handling empty strings correctly."""
    if not slug:
        return ()
    return tuple(slug.split("-"))


def add_tokens(item: dict[str, Any]):
    pred_tokens = _split_slug(item["prediction"])
    ref_tokens = _split_slug(item["reference"])
    item["prediction_tokens"] = pred_tokens
    item["reference_tokens"] = ref_tokens
    item["prediction_length"] = len(pred_tokens)
    item["reference_length"] = len(ref_tokens)
    return item


def transform_dataset(dataset: Dataset) -> Dataset:
    return dataset.map(add_tokens)
