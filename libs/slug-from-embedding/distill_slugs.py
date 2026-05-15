"""Distill slug labels for the corpus using Claude Haiku via the Batch API.

Reads corpus.parquet, submits all documents to Anthropic's Message Batches API
for slug generation, polls for completion, validates outputs, and writes the
result to corpus_with_slugs.parquet.

Usage:
    uv run distill_slugs.py submit     # Step 1: submit batch to Anthropic
    uv run distill_slugs.py poll       # Step 2: poll until batch completes
    uv run distill_slugs.py collect    # Step 3: collect results and write parquet
    uv run distill_slugs.py all        # All steps (blocks until batch completes)

    # To test the prompt on a small sample before the full run:
    uv run distill_slugs.py test       # Run prompt on 5 samples via sync API
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import time
from pathlib import Path

import anthropic
import duckdb
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")


def _client() -> anthropic.Anthropic:
    key = os.environ.get("ANTHROPHIC_KEY") or os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        print("Set ANTHROPHIC_KEY or ANTHROPIC_API_KEY in .env")
        sys.exit(1)
    return anthropic.Anthropic(api_key=key)


# ── Configuration ──────────────────────────────────────────────────────────────

MODEL = "claude-haiku-4-5-20251001"
MAX_TOKENS = 64  # slugs are short
TEMPERATURE = 0  # style consistency is critical

DATA_DIR = Path(__file__).parent / "data"
CORPUS_FILE = DATA_DIR / "corpus.parquet"
OUTPUT_FILE = DATA_DIR / "corpus_with_slugs.parquet"
BATCH_ID_FILE = DATA_DIR / "batch_id.txt"
ID_MAP_FILE = DATA_DIR / "id_map.json"
RESULTS_FILE = DATA_DIR / "batch_results.jsonl"

POLL_INTERVAL = 30  # seconds between status checks
POLL_MAX_WAIT = 24 * 60 * 60  # give up polling after 24h
SUCCESS_RATE_WARN = 0.95  # warn if fewer than this fraction validate

# ── Stopwords ─────────────────────────────────────────────────────────────────

STOPWORDS = {
    "the",
    "a",
    "an",
    "of",
    "for",
    "in",
    "on",
    "to",
    "and",
    "or",
    "is",
    "it",
    "with",
    "by",
    "at",
    "as",
    "be",
    "are",
    "was",
    "were",
    "this",
    "that",
    "from",
    "but",
    "not",
    "no",
}

# ── Prompt ─────────────────────────────────────────────────────────────────────

SYSTEM_PROMPT = f"""\
You generate short kebab-case slugs that capture the core topic of a text.

Rules:
- Output ONLY the slug, nothing else.
- Use lowercase kebab-case (words joined by hyphens).
- Maximum 6 words.
- No stopwords ({", ".join(sorted(STOPWORDS))}).
- Prefer concrete nouns over abstract ones.
- Include proper nouns (project names, product names, specific identifiers) when central to the topic.
- Split camelCase and snake_case identifiers into separate words (e.g. modalButton -> modal-button, token_count -> token-count).
- The slug should distinguish this text from related texts on nearby topics."""

FEW_SHOT_EXAMPLES = [
    {
        "text": "The mitochondria are often called the powerhouse of the cell. They produce ATP through oxidative phosphorylation, converting nutrients into usable energy.",
        "slug": "mitochondria-atp-oxidative-phosphorylation",
    },
    {
        "text": "React 18 introduced concurrent features like startTransition and Suspense for data fetching, allowing apps to remain responsive during expensive renders.",
        "slug": "react-concurrent-suspense-start-transition",
    },
    {
        "text": "The vulnerability allows remote code execution via a crafted HTTP request to the admin endpoint. Affects versions 2.3.0 through 2.3.4.",
        "slug": "remote-code-execution-admin-endpoint",
    },
    {
        "text": "PostgreSQL 16 added logical replication support for sequences, allowing failover clusters to maintain consistent sequence values across nodes.",
        "slug": "postgresql-16-logical-replication-sequences",
    },
    {
        "text": "We present measurements of the cosmic microwave background polarization anisotropy from the BICEP2 experiment at the South Pole.",
        "slug": "cmb-polarization-bicep2-south-pole",
    },
    {
        "text": "This pull request adds dark mode support to the settings page. Users can toggle between light, dark, and system themes.",
        "slug": "dark-mode-settings-toggle",
    },
    {
        "text": "The updateUserProfile endpoint silently drops fields that fail snake_case validation. This causes profileImage and dateOfBirth to be ignored.",
        "slug": "update-user-profile-silent-field-drop",
    },
    {
        "text": "The Battle of Hastings in 1066 was fought between the Norman-French army of William the Conqueror and the English army under King Harold II.",
        "slug": "battle-hastings-1066-norman-conquest",
    },
    {
        "text": "Sourdough relies on wild yeast and lactobacillus bacteria captured from the environment. The starter must be fed regularly to maintain activity.",
        "slug": "sourdough-starter-wild-yeast-lactobacillus",
    },
]

# Precompute the few-shot message prefix once to avoid rebuilding per document.
_FEW_SHOT_MESSAGES: list[dict] = []
for _ex in FEW_SHOT_EXAMPLES:
    _FEW_SHOT_MESSAGES.append({"role": "user", "content": _ex["text"]})
    _FEW_SHOT_MESSAGES.append({"role": "assistant", "content": _ex["slug"]})

# ── Slug validation ───────────────────────────────────────────────────────────

SLUG_PATTERN = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
MAX_SLUG_WORDS = 8  # prompt says 6, but 7-8 word slugs with compound terms are fine for training


def validate_slug(text: str) -> str | None:
    """Validate and clean a slug. Returns the slug if valid, None otherwise."""
    slug = text.strip().lower()

    # Strip any quotes or backticks the model might wrap it in
    slug = slug.strip("\"'`")

    if not SLUG_PATTERN.match(slug):
        return None

    tokens = slug.split("-")
    if len(tokens) > MAX_SLUG_WORDS:
        return None

    if any(t in STOPWORDS for t in tokens):
        return None

    if len(slug) < 3 or len(slug) > 80:
        return None

    return slug


def extract_text(content_blocks) -> str | None:
    """Find the first text block in a response, defensive against tool_use/thinking blocks."""
    for block in content_blocks:
        if getattr(block, "type", None) == "text":
            return block.text
    return None


# ── Build requests ────────────────────────────────────────────────────────────


def build_messages(text: str) -> list[dict]:
    """Build the few-shot message list for a single document."""
    return _FEW_SHOT_MESSAGES + [{"role": "user", "content": text}]


def make_custom_id(doc_id: str) -> str:
    """Create a batch-API-safe custom_id from an arbitrary document ID.

    The Anthropic batch API requires custom_id to match ^[a-zA-Z0-9_-]{1,64}$.
    We use a truncated SHA-256 hex digest (64 chars, hex-safe).
    """
    return hashlib.sha256(doc_id.encode()).hexdigest()


def load_corpus() -> list[tuple]:
    """Load corpus.parquet as a list of (id, text) tuples."""
    return duckdb.sql(f"SELECT id, text FROM '{CORPUS_FILE}'").fetchall()


# ── Commands ──────────────────────────────────────────────────────────────────


def cmd_test():
    """Test the prompt on 5 random samples using the synchronous Messages API."""
    client = _client()
    samples = duckdb.sql(
        f"SELECT id, text, source FROM '{CORPUS_FILE}' ORDER BY random() LIMIT 5"
    ).fetchall()

    for doc_id, text, source in samples:
        response = client.messages.create(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            temperature=TEMPERATURE,
            system=SYSTEM_PROMPT,
            messages=build_messages(text),
        )
        raw = extract_text(response.content) or ""
        slug = validate_slug(raw)
        status = "✓" if slug else f"✗ invalid: {raw!r}"
        print(f"[{source}] {doc_id}  (text length: {len(text)} chars)")
        print(f"  text: {text[:100]}...")
        print(f"  slug: {slug or raw}  {status}")
        print()


def cmd_submit():
    """Submit all corpus documents as a batch to Anthropic."""
    client = _client()
    corpus = load_corpus()
    print(f"Building batch for {len(corpus)} documents...")

    seen_ids = set()
    id_map = {}  # custom_id -> doc_id
    requests = []
    for doc_id, text in corpus:
        if doc_id in seen_ids:
            raise ValueError(f"Duplicate id in corpus: {doc_id}")
        seen_ids.add(doc_id)
        custom_id = make_custom_id(doc_id)
        id_map[custom_id] = doc_id
        requests.append(
            {
                "custom_id": custom_id,
                "params": {
                    "model": MODEL,
                    "max_tokens": MAX_TOKENS,
                    "temperature": TEMPERATURE,
                    "system": SYSTEM_PROMPT,
                    "messages": build_messages(text),
                },
            }
        )

    # Save the mapping so collect can translate custom_ids back to doc_ids.
    ID_MAP_FILE.write_text(json.dumps(id_map))
    print(f"ID mapping saved to {ID_MAP_FILE}")

    print("Submitting batch...")
    batch = client.messages.batches.create(requests=requests)
    BATCH_ID_FILE.write_text(batch.id)
    print(f"Batch submitted: {batch.id}")
    print(f"Status: {batch.processing_status}")
    print(f"Batch ID saved to {BATCH_ID_FILE}")
    print(
        f"Inspect at: https://console.anthropic.com/settings/workspaces/default/batches/{batch.id}"
    )


def cmd_poll():
    """Poll until the batch completes."""
    client = _client()
    batch_id = BATCH_ID_FILE.read_text().strip()
    print(f"Polling batch {batch_id}...")

    deadline = time.time() + POLL_MAX_WAIT
    consecutive_errors = 0

    while time.time() < deadline:
        try:
            batch = client.messages.batches.retrieve(batch_id)
            consecutive_errors = 0
            counts = batch.request_counts
            print(
                f"  status={batch.processing_status}  "
                f"processing={counts.processing}  "
                f"succeeded={counts.succeeded}  "
                f"errored={counts.errored}"
            )
            if batch.processing_status == "ended":
                print("Batch complete.")
                return
        except Exception as e:
            consecutive_errors += 1
            print(f"  retrieve failed ({consecutive_errors}): {e}")
            if consecutive_errors >= 5:
                raise RuntimeError("Too many consecutive retrieve failures") from e
        time.sleep(POLL_INTERVAL)

    raise TimeoutError(f"Batch did not complete within {POLL_MAX_WAIT}s")


def _stream_results_to_file(batch_id: str) -> None:
    """Stream batch results from the API to RESULTS_FILE, one JSON object per line.

    Each line contains custom_id, status (succeeded/errored), and raw text or error info.
    Validation happens later from this file, so re-running collect is free.
    """
    client = _client()
    print(f"Streaming results from API to {RESULTS_FILE}...")
    n = 0
    with open(RESULTS_FILE, "w") as f:
        for result in client.messages.batches.results(batch_id):
            record: dict = {"custom_id": result.custom_id}
            if result.result.type == "succeeded":
                raw = extract_text(result.result.message.content) or ""
                record["status"] = "succeeded"
                record["raw"] = raw
            else:
                record["status"] = result.result.type
                record["error"] = getattr(result.result, "error", None)
                if record["error"] is not None:
                    record["error"] = str(record["error"])
            f.write(json.dumps(record) + "\n")
            n += 1
    print(f"Wrote {n} raw results to {RESULTS_FILE}")


def cmd_collect():
    """Collect batch results, validate slugs, and write output parquet.

    Idempotent: if RESULTS_FILE exists, validates from disk without hitting the API.
    Delete RESULTS_FILE to force a re-fetch.
    """
    batch_id = BATCH_ID_FILE.read_text().strip()
    id_map = json.loads(ID_MAP_FILE.read_text())  # custom_id -> doc_id

    if RESULTS_FILE.exists():
        print(f"Using cached raw results from {RESULTS_FILE}")
    else:
        _stream_results_to_file(batch_id)

    # Validate from the local file. Keys are doc_ids (mapped back from custom_ids).
    slugs: dict[str, str] = {}
    invalid_count = 0
    error_count = 0
    total = 0
    invalid_samples: list[tuple[str, str]] = []

    with open(RESULTS_FILE) as f:
        for line in f:
            record = json.loads(line)
            total += 1
            custom_id = record["custom_id"]
            doc_id = id_map.get(custom_id, custom_id)
            if record["status"] == "succeeded":
                raw = record.get("raw", "")
                slug = validate_slug(raw)
                if slug:
                    if doc_id in slugs:
                        print(f"  WARNING: duplicate doc_id {doc_id}, keeping first")
                    else:
                        slugs[doc_id] = slug
                else:
                    invalid_count += 1
                    if len(invalid_samples) < 20:
                        invalid_samples.append((doc_id, raw))
            else:
                error_count += 1

    if invalid_samples:
        print(f"\nSample invalid slugs (first {len(invalid_samples)}):")
        for cid, raw in invalid_samples:
            print(f"  {cid}: {raw!r}")

    print(
        f"\nResults: {len(slugs)} valid, {invalid_count} invalid, "
        f"{error_count} errored, {total} total"
    )

    if total == 0:
        raise RuntimeError("No results found, aborting before writing parquet")

    success_rate = len(slugs) / total
    if success_rate < SUCCESS_RATE_WARN:
        print(
            f"\n⚠  WARNING: success rate {success_rate:.1%} below {SUCCESS_RATE_WARN:.0%}. "
            "The prompt or validator may be broken."
        )

    if not slugs:
        raise RuntimeError("Zero valid slugs, refusing to write empty parquet")

    # Join slugs back to corpus and write output.
    conn = duckdb.connect()
    conn.execute("CREATE TABLE slugs (id VARCHAR, slug VARCHAR)")
    conn.executemany(
        "INSERT INTO slugs VALUES (?, ?)", [(cid, s) for cid, s in slugs.items()]
    )

    conn.execute(f"""
        COPY (
            SELECT c.text, c.id, c.url, c.token_count, c.source, s.slug
            FROM '{CORPUS_FILE}' c
            JOIN slugs s ON c.id = s.id
        ) TO '{OUTPUT_FILE}' (FORMAT PARQUET, COMPRESSION ZSTD)
    """)

    final_count = conn.execute(f"SELECT count(*) FROM '{OUTPUT_FILE}'").fetchone()[0]
    print(f"Wrote {OUTPUT_FILE} ({final_count} samples with slugs)")
    conn.close()


def cmd_all():
    """Submit, poll, and collect in sequence. Long-running; ctrl-C is safe (each phase persists state)."""
    cmd_submit()
    cmd_poll()
    cmd_collect()


# ── CLI ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: uv run distill_slugs.py [test|submit|poll|collect|all]")
        sys.exit(1)

    command = sys.argv[1]
    commands = {
        "test": cmd_test,
        "submit": cmd_submit,
        "poll": cmd_poll,
        "collect": cmd_collect,
        "all": cmd_all,
    }

    if command not in commands:
        print(f"Unknown command: {command}. Use one of: {', '.join(commands)}")
        sys.exit(1)

    commands[command]()
