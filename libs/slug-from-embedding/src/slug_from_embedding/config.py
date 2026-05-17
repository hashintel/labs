"""Shared configuration: constants, encoder registry, env loading, API clients."""

import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).parent.parent.parent
load_dotenv(PROJECT_ROOT / ".env")

DATA_DIR = PROJECT_ROOT / "data"

type Encoder = Literal["openai", "harrier"]
type EncoderBackend = Literal["openrouter", "local"]


@dataclass(frozen=True)
class EncoderConfig:
    name: Encoder
    model: str
    dim: int
    batch_size: int
    backend: EncoderBackend


ENCODERS: dict[Encoder, EncoderConfig] = {
    "openai": EncoderConfig(
        name="openai",
        model="openai/text-embedding-3-small",
        dim=1536,
        batch_size=500,
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

DISTILL_MODEL = "claude-haiku-4-5-20251001"
DISTILL_MAX_TOKENS = 64
DISTILL_TEMPERATURE = 0
POLL_INTERVAL = 30
POLL_MAX_WAIT = 24 * 60 * 60
SUCCESS_RATE_WARN = 0.95

TRAIN_RATIO = 0.80
VAL_RATIO = 0.10
TEST_RATIO = 0.10
SEED = 42

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"


def require_env(key: str, *fallbacks: str) -> str:
    """Get an env var, trying fallbacks. Exit if none found."""
    for name in (key, *fallbacks):
        value = os.environ.get(name)
        if value:
            return value
    all_names = ", ".join((key, *fallbacks))
    print(f"Set one of [{all_names}] in .env")
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
