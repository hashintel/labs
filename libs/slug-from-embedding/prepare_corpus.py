"""Corpus preparation pipeline for slug-from-embedding.

Pulls samples from three sources (FineWeb-Edu, arXiv, GitHub issues),
filters for English, quality, and token length, writes to per-source
staging parquet, then merges into a single unified corpus.parquet.

Usage:
    uv run prepare_corpus.py fetch    # Step 1: pull and filter from each source
    uv run prepare_corpus.py merge    # Step 2: merge staging into corpus.parquet
    uv run prepare_corpus.py all      # Both steps sequentially
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from datatrove.data import DocumentsPipeline
from datatrove.executor import LocalPipelineExecutor
from datatrove.pipeline.base import PipelineStep
from datatrove.pipeline.filters import (
    LambdaFilter,
)
from datatrove.pipeline.filters.fineweb_quality_filter import FineWebQualityFilter
from datatrove.pipeline.filters.gopher_repetition_filter import GopherRepetitionFilter
from datatrove.pipeline.filters.language_filter import LanguageFilter
from datatrove.pipeline.readers import HuggingFaceDatasetReader, ParquetReader
from datatrove.pipeline.tokens.counter import TokensCounter
from datatrove.pipeline.writers import ParquetWriter

# ── Configuration ──────────────────────────────────────────────────────────────

TOTAL_SAMPLES = 10_000
SPLIT = {
    "fineweb-edu": 0.50,  # 5000 samples
    "arxiv": 0.25,  # 2500 samples
    "github-issues": 0.25,  # 2500 samples
}

# Token limits for the length filter. Roughly 200-4000 chars in English.
MIN_TOKENS = 50
MAX_TOKENS = 1000
TOKENIZER = "gpt2"

DATA_DIR = Path(__file__).parent / "data"
STAGING_DIR = DATA_DIR / "staging"
OUTPUT_FILE = DATA_DIR / "corpus.parquet"
LOGS_DIR = DATA_DIR / "logs"

# Safety cap on the reader: how many raw docs to read per source at most.
# Prevents downloading excessive parquet shards. Set to 3x the target to
# account for filter losses (~70% pass rate observed in test runs).
READER_LIMIT_MULTIPLIER = 3


# ── Adapters ───────────────────────────────────────────────────────────────────
# Each adapter maps source-specific fields to the datatrove Document format.
# Fields not consumed by text/id end up in metadata automatically.


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

    # Find the opening event
    text = ""
    title = ""
    for event in events:
        if event.get("action") == "opened":
            text = event.get("text", "").strip()
            title = event.get("title", "").strip()
            break

    # Prepend title to text if both exist, since the title often carries
    # the core "aboutness" that we want the slug to reflect.
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
        "metadata": {
            "title": title,
            "repo": repo,
            "url": url,
        },
    }


# ── Pipeline helpers ──────────────────────────────────────────────────────────


def token_length_filter(doc) -> bool:
    """Keep documents within the configured token count range."""
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

    def run(
        self, data: DocumentsPipeline, rank: int = 0, world_size: int = 1
    ) -> DocumentsPipeline:
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

    def run(
        self, data: DocumentsPipeline, rank: int = 0, world_size: int = 1
    ) -> DocumentsPipeline:
        if data:
            yield from data


# ── Pipeline definitions ──────────────────────────────────────────────────────


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
        output_folder=str(STAGING_DIR / name),
        compression="zstd",
        expand_metadata=True,
    )


def make_pipelines() -> dict[str, list]:
    """Build the pipeline for each source. Returns {source_name: pipeline_steps}."""
    target = {name: int(TOTAL_SAMPLES * frac) for name, frac in SPLIT.items()}

    pipelines = {}

    # ── FineWeb-Edu ────────────────────────────────────────────────────────
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

    # ── arXiv ──────────────────────────────────────────────────────────────
    # Use ParquetReader instead of HuggingFaceDatasetReader to bypass a
    # schema cast error (versions/authors_parsed declared as binary but
    # stored as structured types in the actual parquet files).
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

    # ── GitHub Issues ──────────────────────────────────────────────────────
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


# ── Execution ─────────────────────────────────────────────────────────────────


def fetch():
    """Run the fetch pipelines for all sources."""
    pipelines = make_pipelines()

    for name, pipeline in pipelines.items():
        print(f"\n{'=' * 60}")
        print(f"  Fetching: {name}")
        print(f"{'=' * 60}\n")

        executor = LocalPipelineExecutor(
            pipeline=pipeline,
            logging_dir=str(LOGS_DIR / name),
            tasks=1,
        )
        executor.run()


def merge():
    """Merge per-source staging parquet into a single corpus.parquet."""
    import duckdb

    DATA_DIR.mkdir(parents=True, exist_ok=True)

    # Build a UNION ALL query that reads each source's staging parquet,
    # adds a `source` column, and truncates to the exact target count.
    parts = []
    for name, frac in SPLIT.items():
        staging_path = STAGING_DIR / name / "*.parquet"
        target_count = int(TOTAL_SAMPLES * frac)
        parts.append(
            f"""
            (SELECT text, id, url, token_count, '{name}' AS source
            FROM read_parquet('{staging_path}')
            LIMIT {target_count})
            """
        )

    query = " UNION ALL ".join(parts)
    duckdb.sql(f"COPY ({query}) TO '{OUTPUT_FILE}' (FORMAT PARQUET, COMPRESSION ZSTD)")

    # Report final counts
    result = duckdb.sql(
        f"SELECT source, count(*) as n FROM '{OUTPUT_FILE}' GROUP BY source ORDER BY source"
    ).fetchall()
    total = sum(row[1] for row in result)
    print(f"\nWrote {OUTPUT_FILE} ({total} samples)")
    for source, count in result:
        print(f"  {source}: {count}")


# ── CLI ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: uv run prepare_corpus.py [fetch|merge|all]")
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
        print(f"Unknown command: {command}. Use 'fetch', 'merge', or 'all'.")
        sys.exit(1)

    # Force exit: fasttext and multiprocess.Manager can leave background
    # threads/processes that prevent clean shutdown.
    os._exit(0)
