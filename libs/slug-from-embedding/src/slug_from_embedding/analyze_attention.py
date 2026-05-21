"""Corpus-level decoder attention analysis.

Validates whether attention patterns observed in single-sample
visualizations hold across the test set. Runs teacher-forced forward
passes with attention capture over sampled test predictions, classifies
each sequence position by token kind (prefix, bos, subword, hyphen,
eos), and records per-source-position attention distributions.

Each recorded observation is the total attention a single source
position allocates to all targets of a given kind. Because attention
weights sum to 1 across targets for each source position, these totals
are directly interpretable as proportions: "on average, hyphen
positions allocate X% of their attention to prefix in layer 0."

Aggregates by (source_kind, target_kind, layer) across all samples.

Usage:
    uv run slug-analyze-attention
    uv run slug-analyze-attention --n-samples 200 --seed 123
    uv run slug-analyze-attention --output custom_path.json
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns
import torch
from torch import Tensor, nn

from .config import Encoder
from .libs.workspace import Workspace
from .training.seq2seq.bpe_vocab import BpeVocab
from .training.seq2seq.model import SlugDecoder

TOKEN_KINDS = ("prefix", "bos", "subword", "hyphen", "eos")

PALETTE = [
    "#4e79a7",
    "#f28e2b",
    "#e15759",
    "#76b7b2",
    "#59a14f",
]

DEFAULT_WORKSPACE = "url"
DEFAULT_ENCODER: Encoder = "openai"
DEFAULT_N_SAMPLES = 500
DEFAULT_SEED = 42


def load_model(
    model_dir: Path,
    *,
    device: str = "cpu",
) -> tuple[SlugDecoder, BpeVocab, dict]:
    """Load a seq2seq model, BPE vocab, and training manifest."""
    manifest = json.loads((model_dir / "manifest.json").read_text())
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
    state = torch.load(
        model_dir / "best.pt",
        map_location=device,
        weights_only=True,
    )
    model.load_state_dict(state)
    model.to(device)
    model.eval()

    vocab = BpeVocab.load(model_dir / "tokenizer.json")
    return model, vocab, manifest


def attach_attention_capture(model: SlugDecoder) -> list[Tensor | None]:
    """Monkeypatch decoder blocks to capture head-averaged attention weights.

    Returns a mutable list (one slot per layer) populated on each forward
    pass. Each entry becomes a [B, N, N] tensor of head-averaged weights.

    The standard DecoderBlock.forward uses is_causal=True (SDPA fast path),
    which never returns attention weights. The replacement calls attention
    with is_causal=False and need_weights=True, relying on the explicit
    attn_mask for causal correctness.
    """
    captured: list[Tensor | None] = [None] * len(model.blocks)

    def _make_forward(layer_idx: int, block: nn.Module):
        def forward(x: Tensor, attn_mask: Tensor) -> Tensor:
            normed = block.ln1(x)
            attn_out, attn_w = block.attn(
                normed,
                normed,
                normed,
                attn_mask=attn_mask,
                is_causal=False,
                need_weights=True,
                average_attn_weights=True,
            )
            captured[layer_idx] = attn_w.detach()
            x = x + attn_out
            x = x + block.ffn(block.ln2(x))
            return x

        return forward

    for idx, block in enumerate(model.blocks):
        block.forward = _make_forward(idx, block)  # type: ignore[assignment]

    return captured


def classify_positions(slug_tokens: list[str]) -> list[str]:
    """Classify each sequence position by token kind.

    The full sequence is [PREFIX, BOS, slug_token_0, ..., slug_token_N, EOS].
    Slug tokens that are literal "-" become "hyphen"; all others are "subword".
    """
    kinds = ["prefix", "bos"]
    for token in slug_tokens:
        kinds.append("hyphen" if token == "-" else "subword")
    kinds.append("eos")
    return kinds


def run_sample(
    model: SlugDecoder,
    vocab: BpeVocab,
    embedding: np.ndarray,
    predicted_slug: str,
    captured: list[Tensor | None],
) -> tuple[list[str], np.ndarray]:
    """Run one teacher-forced forward pass and return position kinds + attention.

    Returns:
        kinds: token kind per position, length N
        attention: [L, N, N] head-averaged attention weights
    """
    encoded = vocab.tokenizer.encode(predicted_slug)
    slug_ids = encoded.ids
    slug_tokens = encoded.tokens

    target_ids = [vocab.bos_idx] + slug_ids + [vocab.eos_idx]
    target_tensor = torch.tensor([target_ids], dtype=torch.long)
    emb_tensor = torch.from_numpy(embedding).unsqueeze(0)

    with torch.no_grad():
        model(emb_tensor, target_tensor)

    assert all(w is not None for w in captured), "attention capture incomplete"

    # Each captured weight is [B=1, N, N]. Stack to [L, N, N].
    attention = torch.stack([w[0] for w in captured], dim=0).numpy()
    kinds = classify_positions(slug_tokens)

    n_positions = attention.shape[-1]
    assert n_positions == len(kinds), (
        f"position count mismatch: attention has {n_positions}, "
        f"classified {len(kinds)} (slug had {len(slug_tokens)} subword tokens)"
    )

    return kinds, attention


def accumulate_attention(
    kinds: list[str],
    attention: np.ndarray,
    records: dict[tuple[str, str, int], list[float]],
) -> None:
    """Accumulate per-position attention totals by target kind.

    For each source position and each layer, sums attention weights by
    target kind and records one observation per (source_kind, target_kind,
    layer). Because attention weights sum to 1 across targets for each
    source position, the recorded values are proportions.
    """
    n_layers = attention.shape[0]

    for layer_idx in range(n_layers):
        layer_attn = attention[layer_idx]

        for src_pos, src_kind in enumerate(kinds):
            # Sum attention to each target kind within the causal window.
            kind_totals: dict[str, float] = defaultdict(float)
            for tgt_pos in range(src_pos + 1):
                kind_totals[kinds[tgt_pos]] += float(layer_attn[src_pos, tgt_pos])

            for tgt_kind, total in kind_totals.items():
                records[(src_kind, tgt_kind, layer_idx)].append(total)


def compute_stats(
    records: dict[tuple[str, str, int], list[float]],
) -> list[dict]:
    """Compute summary statistics per (source_kind, target_kind, layer) bucket."""
    stats = []
    for (source_kind, target_kind, layer), values in sorted(records.items()):
        arr = np.array(values, dtype=np.float64)
        stats.append(
            {
                "source_kind": source_kind,
                "target_kind": target_kind,
                "layer": layer,
                "mean": round(float(arr.mean()), 5),
                "std": round(float(arr.std()), 5),
                "median": round(float(np.median(arr)), 5),
                "q25": round(float(np.percentile(arr, 25)), 5),
                "q75": round(float(np.percentile(arr, 75)), 5),
                "count": len(values),
            }
        )
    return stats


# ── Figures ─────────────────────────────────────────────────────────────────────


def _setup_style() -> None:
    sns.set_theme(style="whitegrid", font_scale=0.95)
    plt.rcParams.update(
        {
            "figure.dpi": 150,
            "savefig.dpi": 150,
            "savefig.bbox": "tight",
            "savefig.pad_inches": 0.15,
        }
    )


def plot_attention_heatmaps(
    stats: list[dict], n_layers: int, output_path: Path
) -> None:
    """Faceted heatmap: mean attention by (source, target) kind per layer.

    One panel per layer in a 2x3 grid. Cells show the mean proportion of
    attention a source kind allocates to a target kind. Impossible
    combinations (due to the causal mask) are masked grey.
    """
    kinds = list(TOKEN_KINDS)
    n_kinds = len(kinds)
    kind_idx = {k: i for i, k in enumerate(kinds)}

    matrices = np.full((n_layers, n_kinds, n_kinds), np.nan)
    for entry in stats:
        si = kind_idx[entry["source_kind"]]
        ti = kind_idx[entry["target_kind"]]
        matrices[entry["layer"], si, ti] = entry["mean"]

    n_cols = min(n_layers, 3)
    n_rows = (n_layers + n_cols - 1) // n_cols
    fig, axes = plt.subplots(n_rows, n_cols, figsize=(5 * n_cols, 4.5 * n_rows))
    if n_layers == 1:
        axes = np.array([[axes]])
    axes = np.atleast_2d(axes)

    for layer in range(n_layers):
        ax = axes[layer // n_cols][layer % n_cols]
        mask = np.isnan(matrices[layer])
        sns.heatmap(
            matrices[layer],
            ax=ax,
            mask=mask,
            annot=True,
            fmt=".2f",
            cmap="YlOrRd",
            xticklabels=kinds,
            yticklabels=kinds,
            vmin=0,
            vmax=1,
            cbar=layer % n_cols == n_cols - 1,
            square=True,
            linewidths=0.5,
            linecolor="white",
        )
        ax.set_title(f"Layer {layer}")
        ax.set_xlabel("Target Kind" if layer // n_cols == n_rows - 1 else "")
        ax.set_ylabel("Source Kind" if layer % n_cols == 0 else "")

    # Hide unused subplots.
    for idx in range(n_layers, n_rows * n_cols):
        axes[idx // n_cols][idx % n_cols].set_visible(False)

    fig.suptitle(
        "Mean Attention Allocation by Token Kind Pair",
        fontweight="bold",
        y=1.02,
    )
    fig.tight_layout()
    fig.savefig(output_path)
    plt.close(fig)
    print(f"  Wrote {output_path}")


def plot_prefix_attention_by_layer(
    stats: list[dict], n_layers: int, output_path: Path
) -> None:
    """Line plot: attention to prefix across layers by source kind.

    One line per source kind (excluding 'prefix' itself, which is trivially
    1.0). Shaded bands show the interquartile range (Q25 to Q75).
    """
    source_kinds = ["bos", "subword", "hyphen", "eos"]
    kind_colors = dict(zip(source_kinds, PALETTE))

    fig, ax = plt.subplots(figsize=(8, 5))

    for kind in source_kinds:
        entries = [
            e
            for e in stats
            if e["source_kind"] == kind and e["target_kind"] == "prefix"
        ]
        if not entries:
            continue

        entries.sort(key=lambda e: e["layer"])
        layers = [e["layer"] for e in entries]
        means = [e["mean"] for e in entries]
        q25s = [e["q25"] for e in entries]
        q75s = [e["q75"] for e in entries]

        color = kind_colors[kind]
        ax.plot(layers, means, "o-", color=color, label=kind, linewidth=2)
        ax.fill_between(layers, q25s, q75s, alpha=0.15, color=color)

    ax.set_xlabel("Layer")
    ax.set_ylabel("Attention to Prefix (proportion)")
    ax.set_xticks(range(n_layers))
    ax.legend(title="Source Kind")
    ax.set_title("Attention to Prefix Embedding Across Layers")

    fig.tight_layout()
    fig.savefig(output_path)
    plt.close(fig)
    print(f"  Wrote {output_path}")


# ── Console output ─────────────────────────────────────────────────────────────


def print_summary(stats: list[dict], n_layers: int) -> None:
    """Print prefix-attention summary for hypothesis validation."""
    print("\nPrefix attention by source kind (layer 0):")
    for entry in stats:
        if entry["target_kind"] == "prefix" and entry["layer"] == 0:
            print(
                f"  {entry['source_kind']:<10s}  "
                f"mean={entry['mean']:.3f}  "
                f"std={entry['std']:.3f}  "
                f"median={entry['median']:.3f}  "
                f"n={entry['count']}"
            )

    last_layer = n_layers - 1
    print(f"\nPrefix attention by source kind (layer {last_layer}):")
    for entry in stats:
        if entry["target_kind"] == "prefix" and entry["layer"] == last_layer:
            print(
                f"  {entry['source_kind']:<10s}  "
                f"mean={entry['mean']:.3f}  "
                f"std={entry['std']:.3f}  "
                f"median={entry['median']:.3f}  "
                f"n={entry['count']}"
            )


def main():
    parser = argparse.ArgumentParser(
        description=(
            "Corpus-level decoder attention analysis: validates whether "
            "per-position attention patterns hold across the test set."
        ),
    )
    parser.add_argument(
        "--workspace",
        default=DEFAULT_WORKSPACE,
        help=f"Workspace name (default: {DEFAULT_WORKSPACE})",
    )
    parser.add_argument(
        "--encoder",
        default=DEFAULT_ENCODER,
        choices=["openai", "harrier"],
        help=f"Encoder (default: {DEFAULT_ENCODER})",
    )
    parser.add_argument(
        "--model",
        required=True,
        help="Model directory name under workspace/encoder/models/",
    )
    parser.add_argument(
        "--predictions",
        type=Path,
        default=None,
        help=(
            "Predictions parquet path (must have 'id' and 'predicted_slug' "
            "columns). Default: the model's test predictions in the workspace."
        ),
    )
    parser.add_argument(
        "--n-samples",
        type=int,
        default=DEFAULT_N_SAMPLES,
        help=f"Number of test samples to analyze (default: {DEFAULT_N_SAMPLES})",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=DEFAULT_SEED,
        help=f"Random seed for sampling (default: {DEFAULT_SEED})",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Output JSON path (default: workspace results directory)",
    )
    args = parser.parse_args()

    workspace = Workspace(args.workspace)
    encoder: Encoder = args.encoder

    # Resolve model directory.
    model_dir = workspace.models_dir(encoder, args.model)
    if not model_dir.is_dir():
        sys.exit(f"Model directory not found: {model_dir}")

    # Resolve predictions path.
    if args.predictions is not None:
        preds_path = args.predictions
    else:
        preds_path = workspace.prediction_path(
            encoder,
            f"{args.model}_seq2seq",
            "test",
        )
    if not preds_path.is_file():
        sys.exit(f"Predictions not found: {preds_path}")

    # Resolve output path.
    if args.output is not None:
        output_path = args.output
    else:
        results_dir = workspace.results_dir(encoder)
        results_dir.mkdir(parents=True, exist_ok=True)
        output_path = results_dir / "attention_corpus_stats.json"

    # Load model.
    print(f"Loading model from {model_dir}...")
    model, vocab, manifest = load_model(model_dir)
    n_layers = int(manifest["model"]["num_layers"])
    captured = attach_attention_capture(model)

    # Load and sample predictions.
    print(f"Loading predictions from {preds_path}...")
    preds_df = pd.read_parquet(preds_path, columns=["id", "predicted_slug"])
    n_available = len(preds_df)
    preds_df = preds_df.sample(
        n=min(args.n_samples, n_available),
        random_state=args.seed,
    )
    print(f"  Sampled {len(preds_df)} of {n_available} predictions")

    # Load embeddings.
    print("Loading embeddings...")
    emb_ids, emb_matrix = workspace.load_embeddings(encoder)
    emb_index: dict[str, int] = {id_: idx for idx, id_ in enumerate(emb_ids)}
    print(f"  {len(emb_ids)} embeddings loaded")

    # Run analysis.
    records: dict[tuple[str, str, int], list[float]] = defaultdict(list)
    n_processed = 0
    n_skipped = 0

    for _, row in preds_df.iterrows():
        article_id: str = row["id"]
        predicted_slug: str = row["predicted_slug"]

        if not predicted_slug or not isinstance(predicted_slug, str):
            n_skipped += 1
            continue

        emb_idx = emb_index.get(article_id)
        if emb_idx is None:
            n_skipped += 1
            continue

        embedding = emb_matrix[emb_idx]
        kinds, attention = run_sample(
            model,
            vocab,
            embedding,
            predicted_slug,
            captured,
        )
        accumulate_attention(kinds, attention, records)

        n_processed += 1
        if n_processed % 50 == 0:
            print(
                f"  {n_processed}/{len(preds_df)} samples processed",
                flush=True,
            )

    print(f"Done: {n_processed} processed, {n_skipped} skipped")

    if n_processed == 0:
        sys.exit("No samples were successfully processed")

    # Aggregate and write output.
    stats = compute_stats(records)

    payload = {
        "metadata": {
            "n_samples": n_processed,
            "n_skipped": n_skipped,
            "seed": args.seed,
            "model": args.model,
            "n_layers": n_layers,
            "token_kinds": list(TOKEN_KINDS),
        },
        "stats": stats,
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"\nWrote {output_path}")

    # Generate figures.
    figures_dir = workspace.figures_dir(encoder)
    figures_dir.mkdir(parents=True, exist_ok=True)

    _setup_style()
    print("\nGenerating figures...")
    plot_attention_heatmaps(stats, n_layers, figures_dir / "attention_heatmaps.png")
    plot_prefix_attention_by_layer(
        stats, n_layers, figures_dir / "attention_prefix_by_layer.png"
    )

    print_summary(stats, n_layers)


if __name__ == "__main__":
    main()
