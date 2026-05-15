"""Distill slug labels for the corpus using Claude Haiku via the Batch API.

Usage:
    uv run -m slug_from_embedding.distill_slugs test
    uv run -m slug_from_embedding.distill_slugs submit
    uv run -m slug_from_embedding.distill_slugs poll
    uv run -m slug_from_embedding.distill_slugs collect
    uv run -m slug_from_embedding.distill_slugs all
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
import time

import duckdb

from .config import (
    BATCH_ID_FILE,
    BATCH_RESULTS_FILE,
    CORPUS_FILE,
    CORPUS_WITH_SLUGS_FILE,
    DISTILL_MAX_TOKENS,
    DISTILL_MODEL,
    DISTILL_TEMPERATURE,
    ID_MAP_FILE,
    POLL_INTERVAL,
    POLL_MAX_WAIT,
    SUCCESS_RATE_WARN,
    anthropic_client,
)
from .io import load_corpus_texts

# ── Stopwords ─────────────────────────────────────────────────────────────────

STOPWORDS = {
    "the", "a", "an", "of", "for", "in", "on", "to", "and", "or", "is", "it",
    "with", "by", "at", "as", "be", "are", "was", "were", "this", "that",
    "from", "but", "not", "no",
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

_FEW_SHOT_MESSAGES: list[dict] = []
for _ex in FEW_SHOT_EXAMPLES:
    _FEW_SHOT_MESSAGES.append({"role": "user", "content": _ex["text"]})
    _FEW_SHOT_MESSAGES.append({"role": "assistant", "content": _ex["slug"]})

# ── Validation ─────────────────────────────────────────────────────────────────

SLUG_PATTERN = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
MAX_SLUG_WORDS = 8


def validate_slug(text: str) -> str | None:
    slug = text.strip().lower().strip("\"'`")
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
    for block in content_blocks:
        if getattr(block, "type", None) == "text":
            return block.text
    return None


# ── Helpers ────────────────────────────────────────────────────────────────────


def build_messages(text: str) -> list[dict]:
    return _FEW_SHOT_MESSAGES + [{"role": "user", "content": text}]


def make_custom_id(doc_id: str) -> str:
    return hashlib.sha256(doc_id.encode()).hexdigest()


# ── Commands ──────────────────────────────────────────────────────────────────


def cmd_test():
    client = anthropic_client()
    samples = duckdb.sql(
        f"SELECT id, text, source FROM '{CORPUS_FILE}' ORDER BY random() LIMIT 5"
    ).fetchall()

    for doc_id, text, source in samples:
        response = client.messages.create(
            model=DISTILL_MODEL,
            max_tokens=DISTILL_MAX_TOKENS,
            temperature=DISTILL_TEMPERATURE,
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
    client = anthropic_client()
    corpus = load_corpus_texts(CORPUS_FILE)
    print(f"Building batch for {len(corpus)} documents...")

    seen_ids = set()
    id_map = {}
    requests = []
    for doc_id, text in corpus:
        if doc_id in seen_ids:
            raise ValueError(f"Duplicate id in corpus: {doc_id}")
        seen_ids.add(doc_id)
        custom_id = make_custom_id(doc_id)
        id_map[custom_id] = doc_id
        requests.append({
            "custom_id": custom_id,
            "params": {
                "model": DISTILL_MODEL,
                "max_tokens": DISTILL_MAX_TOKENS,
                "temperature": DISTILL_TEMPERATURE,
                "system": SYSTEM_PROMPT,
                "messages": build_messages(text),
            },
        })

    ID_MAP_FILE.write_text(json.dumps(id_map))
    print(f"ID mapping saved to {ID_MAP_FILE}")

    print("Submitting batch...")
    batch = client.messages.batches.create(requests=requests)
    BATCH_ID_FILE.write_text(batch.id)
    print(f"Batch submitted: {batch.id}")
    print(f"Status: {batch.processing_status}")
    print(f"Batch ID saved to {BATCH_ID_FILE}")
    print(f"Inspect at: https://console.anthropic.com/settings/workspaces/default/batches/{batch.id}")


def cmd_poll():
    client = anthropic_client()
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
    client = anthropic_client()
    print(f"Streaming results from API to {BATCH_RESULTS_FILE}...")
    n = 0
    with open(BATCH_RESULTS_FILE, "w") as f:
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
    print(f"Wrote {n} raw results to {BATCH_RESULTS_FILE}")


def cmd_collect():
    batch_id = BATCH_ID_FILE.read_text().strip()
    id_map = json.loads(ID_MAP_FILE.read_text())

    if BATCH_RESULTS_FILE.exists():
        print(f"Using cached raw results from {BATCH_RESULTS_FILE}")
    else:
        _stream_results_to_file(batch_id)

    slugs: dict[str, str] = {}
    invalid_count = 0
    error_count = 0
    total = 0
    invalid_samples: list[tuple[str, str]] = []

    with open(BATCH_RESULTS_FILE) as f:
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

    print(f"\nResults: {len(slugs)} valid, {invalid_count} invalid, {error_count} errored, {total} total")

    if total == 0:
        raise RuntimeError("No results found")
    success_rate = len(slugs) / total
    if success_rate < SUCCESS_RATE_WARN:
        print(f"\n⚠  WARNING: success rate {success_rate:.1%} below {SUCCESS_RATE_WARN:.0%}")
    if not slugs:
        raise RuntimeError("Zero valid slugs")

    conn = duckdb.connect()
    conn.execute("CREATE TABLE slugs (id VARCHAR, slug VARCHAR)")
    conn.executemany("INSERT INTO slugs VALUES (?, ?)", list(slugs.items()))
    conn.execute(f"""
        COPY (
            SELECT c.text, c.id, c.url, c.token_count, c.source, s.slug
            FROM '{CORPUS_FILE}' c
            JOIN slugs s ON c.id = s.id
        ) TO '{CORPUS_WITH_SLUGS_FILE}' (FORMAT PARQUET, COMPRESSION ZSTD)
    """)
    final_count = conn.execute(f"SELECT count(*) FROM '{CORPUS_WITH_SLUGS_FILE}'").fetchone()[0]
    print(f"Wrote {CORPUS_WITH_SLUGS_FILE} ({final_count} samples with slugs)")
    conn.close()


def cmd_all():
    cmd_submit()
    cmd_poll()
    cmd_collect()


def main():
    if len(sys.argv) < 2:
        print("Usage: uv run -m slug_from_embedding.distill_slugs [test|submit|poll|collect|all]")
        sys.exit(1)

    commands = {"test": cmd_test, "submit": cmd_submit, "poll": cmd_poll, "collect": cmd_collect, "all": cmd_all}
    command = sys.argv[1]
    if command not in commands:
        print(f"Unknown command: {command}. Use one of: {', '.join(commands)}")
        sys.exit(1)

    commands[command]()


if __name__ == "__main__":
    main()
