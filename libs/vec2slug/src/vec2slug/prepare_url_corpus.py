"""Prepare a large-scale corpus with URL-extracted slugs from FineWeb-Edu.

Instead of distilling slugs through an LLM, this pipeline extracts them
directly from the URL path. Many web pages have human-written slugs in
their URLs (written for SEO/readability), which are exactly the kind of
short descriptive labels we want to learn.

At FineWeb-Edu's scale (~29M documents), a ~25% extraction rate yields
millions of (text, slug) pairs at zero labeling cost.

Usage:
    uv run slug-prepare-urls fetch
    uv run slug-prepare-urls fetch --tasks 8
    uv run slug-prepare-urls fetch --target 100000
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

from .config import MAX_TOKENS, MIN_TOKENS, STOPWORDS, TOKENIZER
from .libs.workspace import Workspace

WORKSPACE = Workspace("url")

MAX_STOPWORD_RATIO = 0.4

# ── Denylist for URL path segments that are site infrastructure ────────────────

INFRA_SEGMENTS = re.compile(
    r"^(index|page|post|article|default|category|tag|archive|feed|rss|print|embed)"
    r"\.(html?|php|aspx?|xml|json)$",
    re.I,
)


# ── Slug extraction ────────────────────────────────────────────────────────────


def extract_slug_from_url(url: str) -> str | None:
    """Extract a clean kebab-case slug from a URL path.

    Returns None if the URL doesn't contain an extractable slug.
    A "clean" slug has 3-8 mostly-alphabetic hyphenated tokens,
    no numeric IDs, no excessive stopwords, and no site-infrastructure noise.
    """
    try:
        parsed = urlparse(url)
        path = parsed.path.strip("/")
        if not path:
            return None

        # Take the last meaningful path segment
        segments = [
            part  #
            for part in path.split("/")
            if part and not INFRA_SEGMENTS.match(part)
        ]
        if not segments:
            return None

        last = segments[-1]

        # Strip file extensions
        last = re.sub(r"\.(html?|php|aspx?|htm|shtml|xml)$", "", last, flags=re.I)

        # Must look like a slug: alphanumeric segments separated by hyphens/underscores
        if not re.match(r"^[a-z0-9]+(?:[-_][a-z0-9]+)+$", last, re.I):
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

        # Stopword density check
        stopword_count = sum(1 for t in tokens if t in STOPWORDS)
        if stopword_count / len(tokens) > MAX_STOPWORD_RATIO:
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


def token_length_filter(doc) -> bool:
    count = doc.metadata.get("token_count", 0)
    return MIN_TOKENS <= count <= MAX_TOKENS


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

    steps.append(
        ParquetWriter(
            output_folder=str(WORKSPACE.staging_dir()),
            compression="zstd",
            expand_metadata=True,
        )
    )

    return steps


# ── Commands ──────────────────────────────────────────────────────────────────


def fetch(target: int | None = None, tasks: int = 1):
    pipeline = make_pipeline(target)
    label = f"{target}" if target else "all available"
    print(f"Fetching {label} samples with URL-extracted slugs...")
    print(f"  tasks: {tasks}")

    executor = LocalPipelineExecutor(
        pipeline=pipeline,
        logging_dir=str(WORKSPACE.logs_dir()),
        tasks=tasks,
    )
    executor.run()
    print("Fetch complete.")

    merge()


# ── Post-filters applied during merge ──────────────────────────────────────────

MAX_SLUG_FREQUENCY = 10  # slugs appearing this many times are likely infrastructure


def _post_filter_sql(source_table: str) -> str:
    """Build SQL that filters out high-frequency infrastructure slugs.

    Stopword and regex filtering happen in SlugExtractFilter during streaming.
    Frequency filtering needs global counts, so it runs at merge time.
    """
    return f"""
        WITH raw AS (
            SELECT
                text, id, url, slug, token_count,
                'fineweb-edu' AS source
            FROM {source_table}
        ),
        slug_counts AS (
            SELECT slug, count(*) as cnt FROM raw GROUP BY slug
        )
        SELECT r.*
        FROM raw r
        JOIN slug_counts sc ON r.slug = sc.slug
        WHERE sc.cnt < {MAX_SLUG_FREQUENCY}
        ORDER BY r.id
    """


def merge():
    """Merge staging parquet files, apply post-filters, write final corpus."""
    staging_path = WORKSPACE.staging_dir() / "*.parquet"
    raw_count = duckdb.sql(
        f"SELECT count(*) FROM read_parquet('{staging_path}')"
    ).fetchone()[0]

    if raw_count == 0:
        print("No data in staging. Run fetch first.")
        sys.exit(1)

    print(f"Raw samples from staging: {raw_count:,}")

    query = _post_filter_sql(f"read_parquet('{staging_path}')")
    duckdb.sql(
        f"COPY ({query}) TO '{WORKSPACE.corpus_path()}' (FORMAT PARQUET, COMPRESSION ZSTD)"
    )

    count = duckdb.sql(f"SELECT count(*) FROM '{WORKSPACE.corpus_path()}'").fetchone()[
        0
    ]
    print(f"After post-filtering: {count:,} ({count / raw_count:.1%} retained)")
    print(f"Wrote {WORKSPACE.corpus_path()}")

    # ── Distribution stats ─────────────────────────────────────────────
    stats = duckdb.sql(f"""
        SELECT
            count(*) as n,
            avg(token_count) as avg_tokens,
            count(distinct slug) as unique_slugs
        FROM '{WORKSPACE.corpus_path()}'
    """).fetchone()
    print(f"  avg tokens: {stats[1]:.0f}")
    print(f"  unique slugs: {stats[2]}")

    # Vocab size
    vocab = duckdb.sql(f"""
        WITH tokens AS (
            SELECT unnest(string_split(slug, '-')) as token
            FROM '{WORKSPACE.corpus_path()}'
        )
        SELECT count(distinct token) FROM tokens
    """).fetchone()
    print(f"  vocab size: {vocab[0]}")

    # Slug length distribution
    print("\n  Slug length distribution:")
    slug_lens = duckdb.sql(f"""
        SELECT
            len(string_split(slug, '-')) as slug_len,
            count(*) as cnt
        FROM '{WORKSPACE.corpus_path()}'
        GROUP BY slug_len
        ORDER BY slug_len
    """).fetchall()
    for length, cnt in slug_lens:
        pct = cnt / count * 100
        print(f"    {length} tokens: {cnt:>8d} ({pct:5.1f}%)")

    # Stopword density distribution
    print("\n  Stopword density in slugs:")
    stopword_stats = duckdb.sql(f"""
        WITH slug_tokens AS (
            SELECT
                slug,
                string_split(slug, '-') as tokens,
                len(string_split(slug, '-')) as n_tokens
            FROM '{WORKSPACE.corpus_path()}'
        )
        SELECT
            avg(stopword_frac) as avg_stopword_frac,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY stopword_frac) as median,
            percentile_cont(0.9) WITHIN GROUP (ORDER BY stopword_frac) as p90,
            max(stopword_frac) as max_stopword_frac
        FROM (
            SELECT
                slug,
                list_count(list_filter(tokens, t -> t IN {tuple(STOPWORDS)}))::DOUBLE / n_tokens as stopword_frac
            FROM slug_tokens
        )
    """).fetchone()
    print(
        f"    avg: {stopword_stats[0]:.1%}, median: {stopword_stats[1]:.1%}, p90: {stopword_stats[2]:.1%}, max: {stopword_stats[3]:.1%}"
    )


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
