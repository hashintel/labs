"""Prepare a large-scale corpus with URL-extracted slugs from FineWeb-Edu.

Instead of distilling slugs through an LLM, this pipeline extracts them
directly from the URL path. Many web pages have human-written slugs in
their URLs (written for SEO/readability), which are exactly the kind of
short descriptive labels we want to learn.

At FineWeb-Edu's scale (~29M documents), a ~25% extraction rate yields
millions of (text, slug) pairs at zero labeling cost.

Usage:
    uv run slug-prepare-urls fetch --target 100000
    uv run slug-prepare-urls fetch --target 500000 --tasks 4
"""

import argparse
import os
import re
import sys
from urllib.parse import urlparse

import duckdb
from datatrove.data import DocumentsPipeline
from datatrove.executor import LocalPipelineExecutor
from datatrove.pipeline.base import PipelineStep
from datatrove.pipeline.filters import LambdaFilter
from datatrove.pipeline.filters.gopher_repetition_filter import GopherRepetitionFilter
from datatrove.pipeline.filters.language_filter import LanguageFilter
from datatrove.pipeline.readers import HuggingFaceDatasetReader
from datatrove.pipeline.tokens.counter import TokensCounter
from datatrove.pipeline.writers import ParquetWriter

from .config import DATA_DIR, LOGS_DIR, MAX_TOKENS, MIN_TOKENS, TOKENIZER

# ── Paths ──────────────────────────────────────────────────────────────────────

URL_STAGING_DIR = DATA_DIR / "staging" / "url-corpus"
URL_CORPUS_FILE = DATA_DIR / "url_corpus_with_slugs.parquet"


# ── Slug extraction ────────────────────────────────────────────────────────────


def extract_slug_from_url(url: str) -> str | None:
    """Extract a clean kebab-case slug from a URL path.

    Returns None if the URL doesn't contain an extractable slug.
    A "clean" slug has 3-8 mostly-alphabetic hyphenated tokens,
    no numeric IDs, and no site-infrastructure noise.
    """
    try:
        parsed = urlparse(url)
        path = parsed.path.strip("/")
        if not path:
            return None

        # Take the last meaningful path segment (skip index.html etc)
        segments = [
            s
            for s in path.split("/")
            if s
            and not re.match(
                r"^(index|page|post|article|default|category|tag|archive)\.(html?|php|aspx?)$",
                s,
                re.I,
            )
        ]
        if not segments:
            return None

        last = segments[-1]

        # Strip file extensions
        last = re.sub(r"\.(html?|php|aspx?|htm|shtml|xml)$", "", last, flags=re.I)

        # Must look like a slug: lowercase alphanumeric with hyphens or underscores
        if not re.match(r"^[a-z0-9][a-z0-9_-]{3,}$", last, re.I):
            return None

        if "-" not in last and "_" not in last:
            return None

        # Normalize
        slug = last.lower().replace("_", "-")
        tokens = slug.split("-")

        # Length filter
        if not (3 <= len(tokens) <= 8):
            return None

        # Reject numeric-heavy slugs (dates, IDs)
        numeric_tokens = sum(1 for t in tokens if re.match(r"^\d+$", t))
        if numeric_tokens >= 2:
            return None
        for t in tokens:
            if re.match(r"^\d+$", t) and int(t) > 31:
                return None

        # Require at least 3 meaningful tokens (length > 1)
        meaningful = [t for t in tokens if len(t) > 1]
        if len(meaningful) < 3:
            return None

        return slug
    except Exception:
        return None


# ── Datatrove pipeline steps ──────────────────────────────────────────────────


class SlugExtractFilter(PipelineStep):
    """Filter that extracts URL slugs and adds them to document metadata.

    Documents without extractable clean slugs are rejected.
    """

    name = "🏷️ Slug Extract"
    type = "🔻 - FILTER"

    def run(
        self, data: DocumentsPipeline, rank: int = 0, world_size: int = 1
    ) -> DocumentsPipeline:
        if not data:
            return
        for doc in data:
            url = doc.metadata.get("url", "")
            slug = extract_slug_from_url(url)
            if slug:
                doc.metadata["slug"] = slug
                yield doc


class Take(PipelineStep):
    """Stop after yielding n documents."""

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


def token_length_filter(doc) -> bool:
    count = doc.metadata.get("token_count", 0)
    return MIN_TOKENS <= count <= MAX_TOKENS


# ── Pipeline construction ─────────────────────────────────────────────────────


def make_pipeline(target: int | None = None) -> list:
    """Build the datatrove pipeline.

    If target is None, processes the entire dataset without limit.
    """
    steps: list = [
        HuggingFaceDatasetReader(
            dataset="HuggingFaceFW/fineweb-edu",
            dataset_options={"name": "sample-10BT", "split": "train"},
            streaming=True,
            limit=target * 8 if target else -1,
            doc_progress=True,
        ),
        LanguageFilter(languages=["en"], language_threshold=0.65),
        SlugExtractFilter(),
        GopherRepetitionFilter(),
        TokensCounter(tokenizer_name_or_path=TOKENIZER),
        LambdaFilter(filter_function=token_length_filter),
    ]

    if target:
        steps.append(Take(target))

    steps.append(ParquetWriter(
        output_folder=str(URL_STAGING_DIR),
        compression="zstd",
        expand_metadata=True,
    ))

    return steps


# ── Commands ──────────────────────────────────────────────────────────────────


def fetch(target: int | None = None, tasks: int = 1):
    pipeline = make_pipeline(target)
    label = f"{target}" if target else "all available"
    print(f"Fetching {label} samples with URL-extracted slugs...")
    print(f"  tasks: {tasks}")

    executor = LocalPipelineExecutor(
        pipeline=pipeline,
        logging_dir=str(LOGS_DIR / "url-corpus"),
        tasks=tasks,
    )
    executor.run()
    print("Fetch complete.")

    # Merge staging into final corpus
    merge()


def merge():
    """Merge staging parquet files into a single corpus with slugs."""
    staging_path = URL_STAGING_DIR / "*.parquet"
    count = duckdb.sql(
        f"SELECT count(*) FROM read_parquet('{staging_path}')"
    ).fetchone()[0]

    if count == 0:
        print("No data in staging. Run fetch first.")
        sys.exit(1)

    duckdb.sql(f"""
        COPY (
            SELECT
                text,
                id,
                url,
                slug,
                token_count,
                'fineweb-edu' AS source
            FROM read_parquet('{staging_path}')
            ORDER BY id
        ) TO '{URL_CORPUS_FILE}' (FORMAT PARQUET, COMPRESSION ZSTD)
    """)

    print(f"\nWrote {URL_CORPUS_FILE} ({count} samples)")

    # Quick stats
    stats = duckdb.sql(f"""
        SELECT
            count(*) as n,
            avg(token_count) as avg_tokens,
            count(distinct slug) as unique_slugs
        FROM '{URL_CORPUS_FILE}'
    """).fetchone()
    print(f"  avg tokens: {stats[1]:.0f}")
    print(f"  unique slugs: {stats[2]}")

    # Vocab size
    vocab = duckdb.sql(f"""
        WITH tokens AS (
            SELECT unnest(string_split(slug, '-')) as token
            FROM '{URL_CORPUS_FILE}'
        )
        SELECT count(distinct token) FROM tokens
    """).fetchone()
    print(f"  vocab size: {vocab[0]}")


def main():
    parser = argparse.ArgumentParser(
        description="Prepare URL-slug corpus from FineWeb-Edu"
    )
    parser.add_argument("command", choices=["fetch", "merge"])
    parser.add_argument(
        "--target", type=int, default=None, help="Max samples (default: no limit)"
    )
    parser.add_argument("--tasks", type=int, default=1, help="Number of parallel tasks")
    args = parser.parse_args()

    match args.command:
        case "fetch":
            fetch(target=args.target, tasks=args.tasks)
        case "merge":
            merge()

    os._exit(0)


if __name__ == "__main__":
    main()
