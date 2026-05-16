from pathlib import Path
from typing import Any

import duckdb
from datasets import Dataset

from slug_from_embedding.config import CORPUS_WITH_SLUGS_FILE, Encoder, embeddings_file


def load_dataset(path: Path, *, encoder: Encoder) -> Dataset:
    table = duckdb.sql(
        f"""
        SELECT
            prediction.id as id,
            corpus.source as source,
            corpus.token_count as token_count,
            prediction.predicted_slug as prediction,
            corpus.slug as reference,
            embeddings.embedding as text_embedding
        FROM '{path}' as prediction
        JOIN '{CORPUS_WITH_SLUGS_FILE}' as corpus
            ON prediction.id = corpus.id
        JOIN '{embeddings_file(encoder)}' as embeddings
            ON prediction.id = embeddings.id
        """
    ).to_arrow_table()

    return Dataset(table)


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
