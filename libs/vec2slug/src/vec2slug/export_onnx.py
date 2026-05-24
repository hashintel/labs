"""Export a trained seq2seq model to ONNX for browser inference.

Exports the forward pass (embedding, token_ids) → logits. Beam search
runs in JavaScript; this module only exports the neural network.

A JSON sidecar is written alongside the ONNX file containing everything
the JS runtime needs for decoding: tokenizer vocabulary, special token
indices, beam search defaults, and stopwords.

Usage:
    uv run python -m vec2slug.export_onnx \
        data/url/openai/models/seq2seq_bpe_d384_l4_t24_eos \
        --output data/url/openai/models/seq2seq_bpe_d384_l4_t24_eos/model.onnx
"""

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import torch

from vec2slug.config import STOPWORDS
from vec2slug.libs.workspace import Workspace
from vec2slug.training.seq2seq.bpe_vocab import BpeVocab
from vec2slug.training.seq2seq.model import SlugDecoder
from vec2slug.training.seq2seq.predict import (
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
    assert onnx_program is not None

    onnx_program.save(str(output_path))
    print(
        f"  ONNX model: {output_path} ({output_path.stat().st_size / 1024 / 1024:.1f} MiB)"
    )


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
        "--output",
        type=Path,
        default=None,
        help="Output ONNX path (default: model_dir/model.onnx)",
    )
    parser.add_argument("--workspace", default="url", help="Workspace name")
    parser.add_argument(
        "--encoder", default=None, help="Encoder (default: from manifest)"
    )
    args = parser.parse_args()

    model_dir: Path = args.model_dir
    output_path: Path = args.output or (model_dir / "model.onnx")
    sidecar_path = output_path.with_suffix(".json")

    print(f"Loading model from {model_dir}...")
    model, manifest = load_model(model_dir)

    print("Exporting ONNX...")
    export_onnx(model, manifest, output_path)

    print("Writing sidecar...")
    sidecar = build_sidecar(model_dir, manifest)
    sidecar_path.write_text(json.dumps(sidecar, indent=2))
    print(f"  Sidecar: {sidecar_path} ({sidecar_path.stat().st_size / 1024:.1f} KiB)")

    # Verify ONNX output matches PyTorch and write provenance manifest
    print("Verifying...")
    encoder = args.encoder or manifest["encoder"]
    workspace = Workspace(args.workspace)
    verification = verify_export(
        model,
        manifest,
        output_path,
        model_dir,
        workspace,
        encoder,
    )

    # Write ONNX export manifest for provenance
    onnx_manifest = {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "torch_version": torch.__version__,
        "artifacts": [output_path.name],
        "sidecar": sidecar_path.name,
        "onnx_size_bytes": output_path.stat().st_size,
        "sidecar_size_bytes": sidecar_path.stat().st_size,
        "verification": verification,
    }
    # Include external data file if present
    data_path = output_path.with_suffix(".onnx.data")
    if data_path.exists():
        onnx_manifest["artifacts"].append(data_path.name)

    manifest_path = model_dir / "onnx_manifest.json"
    manifest_path.write_text(json.dumps(onnx_manifest, indent=2))
    print(f"  Manifest: {manifest_path}")

    print("Done.")


def verify_export(
    model: SlugDecoder,
    manifest: dict,
    onnx_path: Path,
    model_dir: Path,
    workspace: "Workspace",
    encoder: str,
) -> dict:
    """Compare ONNX output against PyTorch on random and real inputs.

    Random inputs are a quick sanity check. Real embeddings from the
    prediction set (if available) quantify numerical agreement on the
    actual data distribution. Reports per-sample logit statistics and
    argmax agreement with a 95% Wilson confidence interval.

    Returns a verification report dict for the ONNX manifest.
    """
    try:
        import onnxruntime as ort
    except ImportError:
        print("  onnxruntime not installed, skipping verification")
        return {"skipped": "onnxruntime not installed"}

    cfg = manifest["model"]
    session = ort.InferenceSession(str(onnx_path))

    # Quick sanity check with random inputs
    random_results = {}
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

        max_diff = float(abs(pt_logits - ort_logits).max())
        random_results[f"batch_{batch_size}_max_diff"] = max_diff
        print(f"  batch={batch_size}: max logit diff {max_diff:.6f}", end="")
        if max_diff > 0.001:
            print(" WARNING: exceeds tolerance")
        else:
            print(" OK")

    report: dict = {
        "onnxruntime_version": ort.__version__,
        "random_inputs": random_results,
    }

    # Real-embedding comparison using the prediction set
    real_results = _verify_real_embeddings(
        model,
        cfg,
        session,
        model_dir,
        workspace,
        encoder,
    )
    if real_results is not None:
        report["real_embeddings"] = real_results

    return report


# Tolerance for ONNX export verification. HuggingFace Optimum uses
# atol=1e-4 as the default for all transformer architectures (BERT,
# GPT-2, Bart, T5, etc). torch.testing.assert_close's float32 defaults
# (atol=1e-5) are too tight for multi-layer transformers where rounding
# differences accumulate through attention, layernorm, and GELU.
# See: https://github.com/huggingface/optimum/blob/main/optimum/exporters/onnx/config.py
VERIFY_ATOL = 1e-4
VERIFY_RTOL = 1e-5


def _verify_real_embeddings(
    model: SlugDecoder,
    cfg: dict,
    session,
    model_dir: Path,
    workspace: "Workspace",
    encoder: str,
    batch_size: int = 256,
) -> dict | None:
    """Compare logits on real embeddings from the prediction set.

    Finds a prediction parquet matching the model name, joins with
    embeddings via DuckDB, and runs a single greedy step (BOS → first
    token logits) through both backends. Asserts numerical closeness
    using torch.testing.assert_close.

    Returns a results dict, or None if no prediction set is available.
    """
    import duckdb
    import numpy as np

    embeddings_path = workspace.embeddings_path(encoder)
    predictions_dir = workspace.predictions_dir(encoder)

    if not embeddings_path.exists() or not predictions_dir.exists():
        print("  No embeddings/predictions found, skipping real-input verification")
        return None

    # Find a prediction file matching this model
    pred_files = sorted(predictions_dir.glob(f"{model_dir.name}_*_test.parquet"))
    if not pred_files:
        print("  No prediction set found, skipping real-input verification")
        return None

    pred_path = pred_files[0]

    # Load embeddings for the prediction set via DuckDB (never materialize the full table)
    rows = duckdb.sql(f"""
        SELECT e.embedding
        FROM '{pred_path}' p
        JOIN '{embeddings_path}' e ON p.id = e.id
        ORDER BY p.id
    """).fetchall()

    embeddings = np.array([r[0] for r in rows], dtype=np.float32)
    n = len(embeddings)
    print(f"  Real-input verification: {n} embeddings from {pred_path.name}")

    # Single greedy step: BOS token (idx=1)
    token_ids = np.ones((n, 1), dtype=np.int64)

    all_max_diffs = []
    all_mean_diffs = []
    argmax_agree = 0

    for start in range(0, n, batch_size):
        end = min(start + batch_size, n)
        batch_emb = embeddings[start:end]
        batch_tok = token_ids[start:end]

        with torch.no_grad():
            pt_logits = model(torch.from_numpy(batch_emb), torch.from_numpy(batch_tok))

        ort_logits = torch.tensor(
            session.run(
                None,
                {"src_embedding": batch_emb, "token_ids": batch_tok},
            )[0]
        )

        torch.testing.assert_close(
            pt_logits,
            ort_logits,
            atol=VERIFY_ATOL,
            rtol=VERIFY_RTOL,
        )

        diff = (pt_logits - ort_logits).abs().numpy()
        all_max_diffs.append(diff.max(axis=(1, 2)))
        all_mean_diffs.append(diff.mean(axis=(1, 2)))

        pt_argmax = pt_logits.numpy().argmax(axis=-1)
        ort_argmax = ort_logits.numpy().argmax(axis=-1)
        argmax_agree += (pt_argmax == ort_argmax).all(axis=-1).sum()

    max_diffs = np.concatenate(all_max_diffs)
    mean_diffs = np.concatenate(all_mean_diffs)

    print(f"  Max absolute diff:  {max_diffs.max():.2e}")
    print(f"  Mean absolute diff: {mean_diffs.mean():.2e}")
    print(f"  P95 absolute diff:  {np.percentile(max_diffs, 95):.2e}")
    print(f"  P99 absolute diff:  {np.percentile(max_diffs, 99):.2e}")

    # Argmax agreement with 95% Wilson confidence interval
    p = float(argmax_agree / n)
    z = 1.96
    denom = 1 + z**2 / n
    center = (p + z**2 / (2 * n)) / denom
    margin = z * np.sqrt(p * (1 - p) / n + z**2 / (4 * n**2)) / denom
    ci_lo = float(center - margin)
    ci_hi = float(min(center + margin, 1.0))
    print(f"  Argmax agreement:   {argmax_agree}/{n} ({p * 100:.2f}%)")
    print(f"  95% Wilson CI:      [{ci_lo:.4f}, {ci_hi:.4f}]")

    return {
        "prediction_set": pred_path.name,
        "n_samples": n,
        "tolerance": {"atol": VERIFY_ATOL, "rtol": VERIFY_RTOL},
        "max_absolute_diff": float(max_diffs.max()),
        "mean_absolute_diff": float(mean_diffs.mean()),
        "p95_absolute_diff": float(np.percentile(max_diffs, 95)),
        "p99_absolute_diff": float(np.percentile(max_diffs, 99)),
        "argmax_agreement": int(argmax_agree),
        "argmax_agreement_rate": p,
        "wilson_ci_95": [ci_lo, ci_hi],
    }


if __name__ == "__main__":
    main()
