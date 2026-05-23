"""Slug validity check.

Validates structural correctness only: well-formed kebab-case with
reasonable length. Content rules (stopwords, domain-specific filtering)
differ per corpus and are not checked here.
"""

import re
from typing import Any

import datasets
import numpy as np
import pyarrow as pa

from .transform import Transform

SLUG_PATTERN = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
MIN_LENGTH = 3
MAX_LENGTH = 80
MIN_TOKENS = 2
MAX_TOKENS = 8


def is_valid_slug(slug: str) -> bool:
    """Check structural validity: kebab-case, reasonable length."""
    if not SLUG_PATTERN.match(slug):
        return False
    if len(slug) < MIN_LENGTH or len(slug) > MAX_LENGTH:
        return False
    token_count = len(slug.split("-"))
    if token_count < MIN_TOKENS or token_count > MAX_TOKENS:
        return False
    return True


class Validity(Transform):
    """Checks whether each predicted slug is structurally valid kebab-case."""

    def transform(self, dataset: datasets.Dataset) -> datasets.Dataset:
        valid = pa.array([is_valid_slug(p) for p in dataset["prediction"]])
        return dataset.add_column("valid", valid)

    def evaluate(self, dataset: datasets.Dataset, stats: dict[str, Any]) -> dict[str, Any]:
        return {
            "validity_rate": float(np.mean(dataset["valid"])),
        }
