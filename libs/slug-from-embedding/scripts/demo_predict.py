"""Quick demo: embed arbitrary text and generate a slug.

Usage:
    uv run python demo_predict.py "Your text here"
    uv run python demo_predict.py --file path/to/file.txt
    uv run python demo_predict.py --file path/to/file.mdx --strip-frontmatter
"""

import argparse
import sys
from pathlib import Path

import numpy as np

from slug_from_embedding.config import openrouter_client
from slug_from_embedding.training.seq2seq.predict import Seq2SeqPredictor

MODEL_DIR = Path("data/url/openai/models/seq2seq_bpe_d512_l6_t24_eos")
EMBEDDING_MODEL = "openai/text-embedding-3-small"


def embed_text(text: str) -> np.ndarray:
    """Embed a single text via OpenRouter."""
    client = openrouter_client()
    response = client.embeddings.create(model=EMBEDDING_MODEL, input=[text])
    return np.array([response.data[0].embedding], dtype=np.float32)


def strip_mdx_frontmatter(text: str) -> str:
    """Remove YAML frontmatter and MDX comments from an MDX file."""
    lines = text.split("\n")
    # Strip YAML frontmatter
    if lines and lines[0].strip() == "---":
        for i, line in enumerate(lines[1:], 1):
            if line.strip() == "---":
                lines = lines[i + 1 :]
                break
    # Strip MDX comments {/* ... */}
    result = []
    in_comment = False
    for line in lines:
        if "{/*" in line and "*/}" in line:
            continue
        if "{/*" in line:
            in_comment = True
            continue
        if "*/}" in line:
            in_comment = False
            continue
        if not in_comment:
            result.append(line)
    return "\n".join(result).strip()


def main():
    parser = argparse.ArgumentParser(description="Generate a slug from arbitrary text")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("text", nargs="?", help="Text to generate a slug for")
    group.add_argument("--file", type=Path, help="File to read text from")
    parser.add_argument(
        "--strip-frontmatter",
        action="store_true",
        help="Strip MDX/YAML frontmatter before embedding",
    )
    parser.add_argument(
        "-k", "--top-k",
        type=int,
        default=5,
        help="Number of candidate slugs to return (default: 5)",
    )
    args = parser.parse_args()

    if args.file:
        text = args.file.read_text()
        if args.strip_frontmatter:
            text = strip_mdx_frontmatter(text)
        print(f"Read {len(text):,} chars from {args.file}")
    else:
        text = args.text

    print(f"Text length: {len(text):,} chars")
    print(f"Embedding via {EMBEDDING_MODEL}...")
    embedding = embed_text(text)
    print(f"Embedding shape: {embedding.shape}")

    print(f"Loading model from {MODEL_DIR}...")
    predictor = Seq2SeqPredictor(
        model_dir=MODEL_DIR, encoder="openai", device="cpu"
    )

    candidates = predictor.predict_topk(embedding, k=args.top_k)[0]
    print(f"\nTop {len(candidates)} candidates:")
    for i, (slug, score) in enumerate(candidates, 1):
        marker = " ←" if i == 1 else ""
        print(f"  {i}. {slug}  (score: {score:.3f}){marker}")
    print(f"\nText preview: {text[:200]}...")



if __name__ == "__main__":
    main()
