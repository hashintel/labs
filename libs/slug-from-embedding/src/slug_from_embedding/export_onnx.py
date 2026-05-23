"""Export a trained seq2seq model to ONNX for browser inference.

Exports the forward pass (embedding, token_ids) → logits. Beam search
runs in JavaScript; this module only exports the neural network.

A JSON sidecar is written alongside the ONNX file containing everything
the JS runtime needs for decoding: tokenizer vocabulary, special token
indices, beam search defaults, and stopwords.

Usage:
    uv run python -m slug_from_embedding.export_onnx \
        data/url/openai/models/seq2seq_bpe_d384_l4_t24_eos \
        --output data/url/openai/models/seq2seq_bpe_d384_l4_t24_eos/model.onnx
"""

import argparse
import json
from pathlib import Path

import torch

from slug_from_embedding.config import STOPWORDS
from slug_from_embedding.training.seq2seq.bpe_vocab import BpeVocab
from slug_from_embedding.training.seq2seq.model import SlugDecoder
from slug_from_embedding.training.seq2seq.predict import (
    DEFAULT_LENGTH_REWARD,
    DEFAULT_REWARD_CAP,
    MIN_DECODE_TOKENS,
    MIN_SLUG_WORDS,
)


def load_model(model_dir: Path) -> tuple[SlugDecoder, dict]:
    """Load a trained model and its manifest."""
    manifest = json.loads((model_dir / "manifest.json").read_text())
    if manifest.get("variant") != "seq2seq":
        raise ValueError(f"Expected seq2seq variant, got {manifest.get('variant')!r}")

    cfg = manifest["model"]
    model = SlugDecoder(
        vocab_size=cfg["vocab_size"],
        embed_dim=cfg["embed_dim"],
        num_heads=cfg["num_heads"],
        num_layers=cfg["num_layers"],
        input_dim=cfg["input_dim"],
        max_length=cfg["max_slug_tokens"],
        dropout=cfg["dropout"],
    )
    model.load_state_dict(
        torch.load(model_dir / "best.pt", map_location="cpu", weights_only=True)
    )
    model.eval()
    return model, manifest


def export_onnx(model: SlugDecoder, manifest: dict, output_path: Path):
    """Export the forward pass to ONNX with dynamic sequence length.

    Uses the dynamo-based exporter (torch 2.12+). Input names use
    "src_embedding" to avoid collision with the model's internal
    embedding layers.
    """
    cfg = manifest["model"]
    input_dim = cfg["input_dim"]

    # Example inputs for tracing. Both dimensions that are marked
    # dynamic must be >1 here: the dynamo exporter constant-folds
    # size-1 dimensions into reshape literals, breaking dynamic
    # batch (multi-head attention) and dynamic seq_len (output shape).
    input_embedding = torch.randn(2, input_dim)
    input_token_ids = torch.zeros(2, 5, dtype=torch.long)

    onnx_program = torch.onnx.export(
        model,
        (input_embedding, input_token_ids),
        input_names=["src_embedding", "token_ids"],
        output_names=["logits"],
        dynamic_shapes=(
            {0: "batch"},
            {0: "batch", 1: "seq_len"},
        ),
        dynamo=True,
    )
    onnx_program.save(str(output_path))
    print(f"  ONNX model: {output_path} ({output_path.stat().st_size / 1024 / 1024:.1f} MiB)")


def build_sidecar(model_dir: Path, manifest: dict) -> dict:
    """Build the JSON sidecar for the JS beam search runtime.

    Contains the tokenizer vocabulary (id → token mapping), special
    token indices, beam search defaults, and the stopword set. This
    is everything the JS side needs to run beam search without any
    Python dependencies.
    """
    cfg = manifest["model"]

    tokenizer_path = model_dir / "tokenizer.json"
    if not tokenizer_path.exists():
        raise ValueError("Only BPE models are supported for ONNX export")

    vocab = BpeVocab.load(tokenizer_path)

    # Build id → token map for the JS decoder
    id_to_token: dict[int, str] = {}
    for token, idx in vocab.tokenizer.get_vocab().items():
        id_to_token[idx] = token

    return {
        "model": {
            "input_dim": cfg["input_dim"],
            "embed_dim": cfg["embed_dim"],
            "num_heads": cfg["num_heads"],
            "num_layers": cfg["num_layers"],
            "max_slug_tokens": cfg["max_slug_tokens"],
            "vocab_size": cfg["vocab_size"],
        },
        "tokens": {
            "pad": vocab.pad_idx,
            "bos": vocab.bos_idx,
            "eos": vocab.eos_idx,
            "unk": vocab.unk_idx,
            "hyphen": vocab.hyphen_idx,
        },
        "vocab": id_to_token,
        "beam_search": {
            "beam_width": 4,
            "length_reward": DEFAULT_LENGTH_REWARD,
            "reward_cap": DEFAULT_REWARD_CAP,
            "min_decode_tokens": MIN_DECODE_TOKENS,
            "min_slug_words": MIN_SLUG_WORDS,
        },
        "stopwords": sorted(STOPWORDS),
    }


def main():
    parser = argparse.ArgumentParser(description="Export seq2seq model to ONNX")
    parser.add_argument("model_dir", type=Path, help="Path to trained model directory")
    parser.add_argument(
        "--output", type=Path, default=None,
        help="Output ONNX path (default: model_dir/model.onnx)",
    )
    args = parser.parse_args()

    model_dir: Path = args.model_dir
    output_path: Path = args.output or (model_dir / "model.onnx")
    sidecar_path = output_path.with_suffix(".json")

    print(f"Loading model from {model_dir}...")
    model, manifest = load_model(model_dir)

    print(f"Exporting ONNX...")
    export_onnx(model, manifest, output_path)

    print(f"Writing sidecar...")
    sidecar = build_sidecar(model_dir, manifest)
    sidecar_path.write_text(json.dumps(sidecar, indent=2))
    print(f"  Sidecar: {sidecar_path} ({sidecar_path.stat().st_size / 1024:.1f} KiB)")

    # Quick sanity check: verify ONNX output matches PyTorch
    print(f"Verifying...")
    verify_export(model, manifest, output_path)

    print("Done.")


def verify_export(model: SlugDecoder, manifest: dict, onnx_path: Path):
    """Compare ONNX output against PyTorch for a random input."""
    try:
        import onnxruntime as ort
    except ImportError:
        print("  onnxruntime not installed, skipping verification")
        return

    cfg = manifest["model"]
    session = ort.InferenceSession(str(onnx_path))

    # Verify with batch=1 (inference) and batch=4 (beam search)
    for batch_size in (1, 4):
        embedding = torch.randn(batch_size, cfg["input_dim"])
        token_ids = torch.zeros(batch_size, 5, dtype=torch.long)
        token_ids[:, 0] = 1  # BOS

        with torch.no_grad():
            pt_logits = model(embedding, token_ids).numpy()

        ort_logits = session.run(
            None,
            {
                "src_embedding": embedding.numpy(),
                "token_ids": token_ids.numpy(),
            },
        )[0]

        max_diff = abs(pt_logits - ort_logits).max()
        print(f"  batch={batch_size}: max logit diff {max_diff:.6f}", end="")
        if max_diff > 0.001:
            print(" WARNING: exceeds tolerance")
        else:
            print(" OK")


if __name__ == "__main__":
    main()
