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

import json
import re
import sys
import time
from pathlib import Path

import anthropic
import duckdb

# ── Configuration ──────────────────────────────────────────────────────────────

MODEL = "claude-haiku-4-5-20251001"
MAX_TOKENS = 64  # slugs are short
TEMPERATURE = 0  # style consistency is critical

DATA_DIR = Path(__file__).parent / "data"
CORPUS_FILE = DATA_DIR / "corpus.parquet"
OUTPUT_FILE = DATA_DIR / "corpus_with_slugs.parquet"
BATCH_ID_FILE = DATA_DIR / "batch_id.txt"
RESULTS_FILE = DATA_DIR / "batch_results.jsonl"

POLL_INTERVAL = 30  # seconds between status checks

# ── Prompt ─────────────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """\
You generate short kebab-case slugs that capture the core topic of a text.

Rules:
- Output ONLY the slug, nothing else.
- Use lowercase kebab-case (words joined by hyphens).
- Maximum 6 words.
- No stopwords (the, a, an, of, for, in, on, to, and, or, is, it, etc.).
- Prefer concrete nouns over abstract ones.
- The slug should distinguish this text from related texts on nearby topics."""

FEW_SHOT_EXAMPLES = [
    {
        "text": "The mitochondria are often called the powerhouse of the cell. They produce ATP through oxidative phosphorylation, converting nutrients into usable energy.",
        "slug": "mitochondria-atp-oxidative-phosphorylation",
    },
    {
        "text": "React 18 introduced concurrent features like startTransition and Suspense for data fetching, allowing apps to remain responsive during expensive renders.",
        "slug": "react-concurrent-suspense-starttransition",
    },
    {
        "text": "The vulnerability allows remote code execution via a crafted HTTP request to the admin endpoint. Affects versions 2.3.0 through 2.3.4.",
        "slug": "remote-code-execution-admin-endpoint",
    },
    {
        "text": "We present measurements of the cosmic microwave background polarization anisotropy from the BICEP2 experiment at the South Pole.",
        "slug": "cmb-polarization-bicep2-south-pole",
    },
    {
        "text": "This pull request adds dark mode support to the settings page. Users can toggle between light, dark, and system themes.",
        "slug": "dark-mode-settings-toggle",
    },
]

# ── Slug validation ───────────────────────────────────────────────────────────

SLUG_PATTERN = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
MAX_SLUG_WORDS = 8  # slightly generous to avoid discarding edge cases


def validate_slug(text: str) -> str | None:
    """Validate and clean a slug. Returns the slug if valid, None otherwise."""
    slug = text.strip().lower()

    # Strip any quotes or backticks the model might wrap it in
    slug = slug.strip("\"'`")

    if not SLUG_PATTERN.match(slug):
        return None

    if len(slug.split("-")) > MAX_SLUG_WORDS:
        return None

    if len(slug) < 3 or len(slug) > 80:
        return None

    return slug


# ── Build requests ────────────────────────────────────────────────────────────


def build_messages(text: str) -> list[dict]:
    """Build the few-shot message list for a single document."""
    messages = []
    for ex in FEW_SHOT_EXAMPLES:
        messages.append({"role": "user", "content": ex["text"]})
        messages.append({"role": "assistant", "content": ex["slug"]})
    messages.append({"role": "user", "content": text})
    return messages


def load_corpus() -> list[dict]:
    """Load corpus.parquet as a list of dicts."""
    rows = duckdb.sql(
        f"SELECT id, text, source, url, token_count FROM '{CORPUS_FILE}'"
    ).fetchall()
    columns = ["id", "text", "source", "url", "token_count"]
    return [dict(zip(columns, row)) for row in rows]


# ── Commands ──────────────────────────────────────────────────────────────────


def cmd_test():
    """Test the prompt on 5 random samples using the synchronous Messages API."""
    client = anthropic.Anthropic()
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
        raw = response.content[0].text
        slug = validate_slug(raw)
        status = "✓" if slug else f"✗ invalid: {raw!r}"
        print(f"[{source}] {doc_id}")
        print(f"  text: {text[:100]}...")
        print(f"  slug: {slug or raw}  {status}")
        print()


def cmd_submit():
    """Submit all corpus documents as a batch to Anthropic."""
    client = anthropic.Anthropic()
    corpus = load_corpus()
    print(f"Building batch for {len(corpus)} documents...")

    requests = []
    for doc in corpus:
        requests.append({
            "custom_id": doc["id"],
            "params": {
                "model": MODEL,
                "max_tokens": MAX_TOKENS,
                "temperature": TEMPERATURE,
                "system": SYSTEM_PROMPT,
                "messages": build_messages(doc["text"]),
            },
        })

    print("Submitting batch...")
    batch = client.messages.batches.create(requests=requests)
    BATCH_ID_FILE.write_text(batch.id)
    print(f"Batch submitted: {batch.id}")
    print(f"Status: {batch.processing_status}")
    print(f"Batch ID saved to {BATCH_ID_FILE}")


def cmd_poll():
    """Poll until the batch completes."""
    client = anthropic.Anthropic()
    batch_id = BATCH_ID_FILE.read_text().strip()
    print(f"Polling batch {batch_id}...")

    while True:
        batch = client.messages.batches.retrieve(batch_id)
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
        time.sleep(POLL_INTERVAL)


def cmd_collect():
    """Collect batch results, validate slugs, and write output parquet."""
    client = anthropic.Anthropic()
    batch_id = BATCH_ID_FILE.read_text().strip()

    print(f"Collecting results for batch {batch_id}...")

    # Collect results into a dict keyed by custom_id
    slugs: dict[str, str] = {}
    invalid_count = 0
    error_count = 0

    for result in client.messages.batches.results(batch_id):
        custom_id = result.custom_id
        if result.result.type == "succeeded":
            raw = result.result.message.content[0].text
            slug = validate_slug(raw)
            if slug:
                slugs[custom_id] = slug
            else:
                invalid_count += 1
                print(f"  invalid slug for {custom_id}: {raw!r}")
        else:
            error_count += 1
            print(f"  error for {custom_id}: {result.result.type}")

    print(f"\nResults: {len(slugs)} valid, {invalid_count} invalid, {error_count} errors")

    # Save raw results for debugging
    with open(RESULTS_FILE, "w") as f:
        for doc_id, slug in slugs.items():
            f.write(json.dumps({"id": doc_id, "slug": slug}) + "\n")

    # Join slugs back to corpus and write output
    # Load slugs into DuckDB and join with corpus
    slugs_list = [{"id": k, "slug": v} for k, v in slugs.items()]

    conn = duckdb.connect()
    conn.execute("CREATE TABLE slugs (id VARCHAR, slug VARCHAR)")
    conn.executemany("INSERT INTO slugs VALUES (?, ?)", [(s["id"], s["slug"]) for s in slugs_list])

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
    """Submit, poll, and collect in sequence."""
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
