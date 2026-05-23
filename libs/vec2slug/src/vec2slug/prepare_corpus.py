"""Corpus preparation pipeline.

Pulls samples from three sources (FineWeb-Edu, arXiv, GitHub issues),
filters for English, quality, and token length, writes to per-source
staging parquet, then merges into a single unified corpus.parquet.

Usage:
    uv run -m vec2slug.prepare_corpus fetch
    uv run -m vec2slug.prepare_corpus merge
    uv run -m vec2slug.prepare_corpus all
"""


import os
import sys

import duckdb
from datatrove.data import DocumentsPipeline
from datatrove.executor import LocalPipelineExecutor
from datatrove.pipeline.base import PipelineStep
from datatrove.pipeline.filters import LambdaFilter
from datatrove.pipeline.filters.fineweb_quality_filter import FineWebQualityFilter
from datatrove.pipeline.filters.gopher_repetition_filter import GopherRepetitionFilter
from datatrove.pipeline.filters.language_filter import LanguageFilter
from datatrove.pipeline.readers import HuggingFaceDatasetReader, ParquetReader
from datatrove.pipeline.tokens.counter import TokensCounter
from datatrove.pipeline.writers import ParquetWriter

from .config import (
    MAX_TOKENS,
    MIN_TOKENS,
    READER_LIMIT_MULTIPLIER,
    SOURCE_SPLIT,
    TOKENIZER,
    TOTAL_SAMPLES,
)
from .libs.workspace import Workspace

WORKSPACE = Workspace("original")


# ── Adapters ───────────────────────────────────────────────────────────────────


def arxiv_adapter(self, data: dict, path: str, id_in_file: int | str):
    """Map arXiv metadata to Document: abstract -> text, arxiv id -> id."""
    abstract = data.get("abstract", "").strip()
    title = data.get("title", "").strip()
    arxiv_id = data.get("id", f"{path}/{id_in_file}")
    categories = data.get("categories", "")
    return {
        "text": abstract,
        "id": arxiv_id,
        "media": [],
        "metadata": {
            "title": title,
            "categories": categories,
            "url": f"https://arxiv.org/abs/{arxiv_id}",
        },
    }


def github_issues_adapter(self, data: dict, path: str, id_in_file: int | str):
    """Extract the opening issue body from the conversation events."""
    events = data.get("events", [])
    repo = data.get("repo", "")
    issue_number = data.get("issue_number", "")

    text = ""
    title = ""
    for event in events:
        if event.get("action") == "opened":
            text = event.get("text", "").strip()
            title = event.get("title", "").strip()
            break

    if title and text:
        text = f"{title}\n\n{text}"
    elif title:
        text = title

    doc_id = (
        f"{repo}#{issue_number}" if repo and issue_number else f"{path}/{id_in_file}"
    )
    url = (
        f"https://github.com/{repo}/issues/{issue_number}"
        if repo and issue_number
        else ""
    )

    return {
        "text": text,
        "id": doc_id,
        "media": [],
        "metadata": {"title": title, "repo": repo, "url": url},
    }


# ── Pipeline helpers ──────────────────────────────────────────────────────────


def token_length_filter(doc) -> bool:
    count = doc.metadata.get("token_count", 0)
    return MIN_TOKENS <= count <= MAX_TOKENS


def TokenLengthFilter():
    return LambdaFilter(filter_function=token_length_filter)


class Take(PipelineStep):
    name = "✂️ Take"
    type = "🔻 - FILTER"

    def __init__(self, n: int):
        super().__init__()
        self.n = n

    def run(self, data: DocumentsPipeline, rank: int = 0, world_size: int = 1) -> DocumentsPipeline:
        if not data:
            return
        count = 0
        for doc in data:
            if count >= self.n:
                return
            yield doc
            count += 1


class Nop(PipelineStep):
    name = "🔄 Nop"
    type = "🔻 - FILTER"

    def run(self, data: DocumentsPipeline, rank: int = 0, world_size: int = 1) -> DocumentsPipeline:
        if data:
            yield from data


def Filter(limit: int, *, fine_web: bool = True) -> tuple[PipelineStep, ...]:
    return (
        LanguageFilter(languages=["en"], language_threshold=0.65),
        FineWebQualityFilter() if fine_web else Nop(),
        GopherRepetitionFilter(),
        TokensCounter(tokenizer_name_or_path=TOKENIZER),
        TokenLengthFilter(),
        Take(limit),
    )


def Writer(name: str) -> ParquetWriter:
    return ParquetWriter(
        output_folder=str(WORKSPACE.staging_dir(name)),
        compression="zstd",
        expand_metadata=True,
    )


def make_pipelines() -> dict[str, list]:
    target = {name: int(TOTAL_SAMPLES * frac) for name, frac in SOURCE_SPLIT.items()}

    pipelines = {}

    pipelines["fineweb-edu"] = [
        HuggingFaceDatasetReader(
            dataset="HuggingFaceFW/fineweb-edu",
            dataset_options={"name": "sample-10BT", "split": "train"},
            streaming=True,
            limit=target["fineweb-edu"] * READER_LIMIT_MULTIPLIER,
        ),
        *Filter(target["fineweb-edu"]),
        Writer("fineweb-edu"),
    ]

    pipelines["arxiv"] = [
        ParquetReader(
            data_folder="hf://datasets/bluuebunny/arxiv_metadata_by_year",
            glob_pattern="data/*.parquet",
            limit=target["arxiv"] * READER_LIMIT_MULTIPLIER,
            adapter=arxiv_adapter,
        ),
        *Filter(target["arxiv"]),
        Writer("arxiv"),
    ]

    pipelines["github-issues"] = [
        HuggingFaceDatasetReader(
            dataset="bigcode/the-stack-github-issues",
            dataset_options={"split": "train"},
            streaming=True,
            limit=target["github-issues"] * READER_LIMIT_MULTIPLIER,
            adapter=github_issues_adapter,
        ),
        *Filter(target["github-issues"], fine_web=False),
        Writer("github-issues"),
    ]

    return pipelines


# ── Commands ──────────────────────────────────────────────────────────────────


def fetch():
    pipelines = make_pipelines()
    for name, pipeline in pipelines.items():
        print(f"\n{'=' * 60}")
        print(f"  Fetching: {name}")
        print(f"{'=' * 60}\n")
        executor = LocalPipelineExecutor(
            pipeline=pipeline,
            logging_dir=str(WORKSPACE.logs_dir(name)),
            tasks=1,
        )
        executor.run()


def merge():
    WORKSPACE.ensure()
    corpus_partial = WORKSPACE.corpus_partial_path()

    parts = []
    for name, frac in SOURCE_SPLIT.items():
        staging_path = WORKSPACE.staging_dir(name) / "*.parquet"
        target_count = int(TOTAL_SAMPLES * frac)
        parts.append(
            f"""
            (SELECT text, id, url, token_count, '{name}' AS source
            FROM read_parquet('{staging_path}')
            LIMIT {target_count})
            """
        )

    query = " UNION ALL ".join(parts)
    duckdb.sql(f"COPY ({query}) TO '{corpus_partial}' (FORMAT PARQUET, COMPRESSION ZSTD)")

    result = duckdb.sql(
        f"SELECT source, count(*) as n FROM '{corpus_partial}' GROUP BY source ORDER BY source"
    ).fetchall()
    total = sum(row[1] for row in result)
    print(f"\nWrote {corpus_partial} ({total} samples)")
    for source, count in result:
        print(f"  {source}: {count}")


def main():
    if len(sys.argv) < 2:
        print("Usage: uv run -m vec2slug.prepare_corpus [fetch|merge|all]")
        sys.exit(1)

    command = sys.argv[1]
    if command == "fetch":
        fetch()
    elif command == "merge":
        merge()
    elif command == "all":
        fetch()
        merge()
    else:
        print(f"Unknown command: {command}")
        sys.exit(1)

    os._exit(0)


if __name__ == "__main__":
    main()
