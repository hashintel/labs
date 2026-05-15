"""Shared configuration: paths, constants, encoder registry, env loading."""

import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from dotenv import load_dotenv

# ── Env ────────────────────────────────────────────────────────────────────────

PROJECT_ROOT = Path(__file__).parent.parent.parent
load_dotenv(PROJECT_ROOT / ".env")

# ── Paths ──────────────────────────────────────────────────────────────────────

DATA_DIR = PROJECT_ROOT / "data"
STAGING_DIR = DATA_DIR / "staging"
LOGS_DIR = DATA_DIR / "logs"

CORPUS_FILE = DATA_DIR / "corpus.parquet"
CORPUS_WITH_SLUGS_FILE = DATA_DIR / "corpus_with_slugs.parquet"

BATCH_ID_FILE = DATA_DIR / "batch_id.txt"
ID_MAP_FILE = DATA_DIR / "id_map.json"
BATCH_RESULTS_FILE = DATA_DIR / "batch_results.jsonl"


def embeddings_file(encoder: str) -> Path:
    return DATA_DIR / f"embeddings_{encoder}.parquet"


def splits_file(encoder: str) -> Path:
    return DATA_DIR / f"splits_{encoder}.parquet"


# ── Corpus ─────────────────────────────────────────────────────────────────────

TOTAL_SAMPLES = 10_000
SOURCE_SPLIT = {
    "fineweb-edu": 0.50,
    "arxiv": 0.25,
    "github-issues": 0.25,
}

MIN_TOKENS = 50
MAX_TOKENS = 1000
TOKENIZER = "gpt2"
READER_LIMIT_MULTIPLIER = 3

# ── Distillation ───────────────────────────────────────────────────────────────

DISTILL_MODEL = "claude-haiku-4-5-20251001"
DISTILL_MAX_TOKENS = 64
DISTILL_TEMPERATURE = 0
POLL_INTERVAL = 30
POLL_MAX_WAIT = 24 * 60 * 60
SUCCESS_RATE_WARN = 0.95

# ── Encoders ───────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class EncoderConfig:
    name: str
    model: str
    dim: int
    batch_size: int
    backend: Literal["openrouter", "local"]


ENCODERS: dict[str, EncoderConfig] = {
    "openai": EncoderConfig(
        name="openai",
        model="openai/text-embedding-3-small",
        dim=1536,
        batch_size=100,
        backend="openrouter",
    ),
    "harrier": EncoderConfig(
        name="harrier",
        model="microsoft/harrier-oss-v1-0.6b",
        dim=1024,
        batch_size=32,
        backend="local",
    ),
}

# ── Dataset split ──────────────────────────────────────────────────────────────

TRAIN_RATIO = 0.80
VAL_RATIO = 0.10
TEST_RATIO = 0.10
N_CLUSTERS = 200
SEED = 42

# ── API clients ────────────────────────────────────────────────────────────────

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"


def require_env(key: str, *fallbacks: str) -> str:
    """Get an env var, trying fallbacks. Exit if none found."""
    for k in (key, *fallbacks):
        val = os.environ.get(k)
        if val:
            return val
    names = ", ".join((key, *fallbacks))
    print(f"Set one of [{names}] in .env")
    sys.exit(1)


def anthropic_client():
    """Create an Anthropic client from env."""
    import anthropic

    key = require_env("ANTHROPHIC_KEY", "ANTHROPIC_API_KEY")
    return anthropic.Anthropic(api_key=key)


def openrouter_client():
    """Create an OpenAI-compatible client pointed at OpenRouter."""
    from openai import OpenAI

    key = require_env("OPENROUTER_API_KEY")
    return OpenAI(base_url=OPENROUTER_BASE_URL, api_key=key)
