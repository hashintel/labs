"""Slug validity check.

Validates that each prediction is a well-formed kebab-case slug
using the same rules applied during distillation. Catches model
outputs that break format constraints (non-ASCII, stopwords,
too many words, etc.).
"""

from typing import Any

import datasets
import numpy as np
import pyarrow as pa

from ..distill_slugs import validate_slug
from .transform import Transform


class Validity(Transform):
    """Checks whether each predicted slug passes the distillation validation rules."""

    def transform(self, dataset: datasets.Dataset) -> datasets.Dataset:
        valid = pa.array([validate_slug(p) is not None for p in dataset["prediction"]])
        return dataset.add_column("valid", valid)

    def evaluate(self, dataset: datasets.Dataset, stats: dict[str, Any]) -> dict[str, Any]:
        return {
            "validity_rate": float(np.mean(dataset["valid"])),
        }
