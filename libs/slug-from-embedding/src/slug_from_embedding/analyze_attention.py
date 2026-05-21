"""Extended decoder attention analysis.

Builds on analyze_attention.py by capturing finer-grained patterns beyond
mean attention to prefix:

  1. Attention entropy per source kind per layer
     (low entropy = focused on one target, high entropy = diffuse)

  2. Hyphen position-within-slug breakdown
     (first / middle / last hyphens may play different roles)

  3. Full source-to-target routing matrix
     (where does each kind of position actually look?)

  4. Per-head specialization
     (does one head do most of the prefix-routing work?)

Each section is independently toggleable via CLI flags. Outputs a single
JSON with all enabled sections, plus optional figures.

Usage:
    uv run slug-analyze-attention-extended --model seq2seq_bpe_d512_l6_t24_eos
    uv run slug-analyze-attention-extended --model ... --skip-heads
    uv run slug-analyze-attention-extended --model ... --n-samples 200
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
HYPHEN_POSITIONS = ("hyphen_first", "hyphen_middle", "hyphen_last")

PALETTE = [
    "#4e79a7",
    "#f28e2b",
    "#e15759",
    "#76b7b2",
    "#59a14f",
    "#edc948",
    "#b07aa1",
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


def attach_attention_capture(
    model: SlugDecoder, *, per_head: bool
) -> list[Tensor | None]:
    """Monkeypatch decoder blocks to capture attention weights.

    With per_head=False, returns head-averaged weights [B, N, N] per layer.
    With per_head=True, returns per-head weights [B, H, N, N] per layer.
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
                average_attn_weights=not per_head,
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

    Full sequence layout is [PREFIX, BOS, slug_token_0, ..., slug_token_N, EOS].
    """
    kinds = ["prefix", "bos"]
    for token in slug_tokens:
        kinds.append("hyphen" if token == "-" else "subword")
    kinds.append("eos")
    return kinds


def classify_hyphen_positions(slug_tokens: list[str]) -> list[str]:
    """Classify positions with fine-grained hyphen labeling.

    Hyphens are labeled hyphen_first / hyphen_middle / hyphen_last by their
    ordinal position among hyphens in the slug. Other positions unchanged.
    """
    kinds = ["prefix", "bos"]
    hyphen_indices = [i for i, t in enumerate(slug_tokens) if t == "-"]
    n_hyphens = len(hyphen_indices)

    for idx, token in enumerate(slug_tokens):
        if token == "-":
            ordinal = hyphen_indices.index(idx)
            if n_hyphens == 1:
                # Single hyphen: classify as middle (ambiguous between first/last)
                kinds.append("hyphen_middle")
            elif ordinal == 0:
                kinds.append("hyphen_first")
            elif ordinal == n_hyphens - 1:
                kinds.append("hyphen_last")
            else:
                kinds.append("hyphen_middle")
        else:
            kinds.append("subword")
    kinds.append("eos")
    return kinds


def run_sample(
    model: SlugDecoder,
    vocab: BpeVocab,
    embedding: np.ndarray,
    predicted_slug: str,
    captured: list[Tensor | None],
) -> tuple[list[str], list[str], np.ndarray]:
    """Run one teacher-forced forward pass.

    Returns:
        kinds: token kind per position (with simple hyphen labeling)
        hyphen_kinds: token kind per position (with first/middle/last hyphens)
        attention: captured attention tensor as numpy [L, ...]
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

    # Stack across layers; drop batch dim (B=1).
    attention = torch.stack([w[0] for w in captured], dim=0).numpy()

    kinds = classify_positions(slug_tokens)
    hyphen_kinds = classify_hyphen_positions(slug_tokens)

    n_positions = attention.shape[-1]
    assert n_positions == len(kinds), (
        f"position count mismatch: attention has {n_positions}, classified {len(kinds)}"
    )

    return kinds, hyphen_kinds, attention


def accumulate_routing(
    kinds: list[str],
    attention: np.ndarray,
    records: dict[tuple[str, str, int], list[float]],
) -> None:
    """Accumulate total attention by (source_kind, target_kind) per layer.

    Same as the original analyze_attention.py accumulator. Included here so
    the routing matrix can be reported alongside the new stats.
    """
    n_layers = attention.shape[0]

    for layer_idx in range(n_layers):
        layer_attn = attention[layer_idx]
        for src_pos, src_kind in enumerate(kinds):
            kind_totals: dict[str, float] = defaultdict(float)
            for tgt_pos in range(src_pos + 1):
                kind_totals[kinds[tgt_pos]] += float(layer_attn[src_pos, tgt_pos])
            for tgt_kind, total in kind_totals.items():
                records[(src_kind, tgt_kind, layer_idx)].append(total)


def accumulate_entropy(
    kinds: list[str],
    attention: np.ndarray,
    records: dict[tuple[str, int], list[float]],
) -> None:
    """Accumulate attention entropy per source kind per layer.

    For each source position, computes the entropy of its attention
    distribution over its causal window. Low entropy = focused on a few
    targets; high entropy = spread across many.

    Reported in nats. Maximum possible value for n attended positions is
    log(n), so we also record the *normalized* entropy: actual / max.
    """
    eps = 1e-12
    n_layers, n_pos, _ = attention.shape

    for layer_idx in range(n_layers):
        layer_attn = attention[layer_idx]
        for src_pos, src_kind in enumerate(kinds):
            window = layer_attn[src_pos, : src_pos + 1]
            window_sum = window.sum()
            if window_sum < eps:
                continue
            probs = window / window_sum  # renormalize defensively
            ent = -float((probs * np.log(probs + eps)).sum())
            max_ent = float(np.log(max(src_pos + 1, 2)))
            normalized = ent / max_ent if max_ent > 0 else 0.0
            records[(src_kind, layer_idx)].append(normalized)


def accumulate_hyphen_routing(
    hyphen_kinds: list[str],
    attention: np.ndarray,
    records: dict[tuple[str, str, int], list[float]],
) -> None:
    """Same as accumulate_routing, but using hyphen_first/middle/last labels."""
    accumulate_routing(hyphen_kinds, attention, records)


def accumulate_head_routing(
    kinds: list[str],
    attention: np.ndarray,
    records: dict[tuple[str, str, int, int], list[float]],
) -> None:
    """Per-head version of routing. Attention shape: [L, H, N, N].

    Records one observation per (source_kind, target_kind, layer, head).
    Used to detect head specialization (e.g. one specific head doing the
    embedding-routing work).
    """
    n_layers, n_heads, _, _ = attention.shape

    for layer_idx in range(n_layers):
        for head_idx in range(n_heads):
            head_attn = attention[layer_idx, head_idx]
            for src_pos, src_kind in enumerate(kinds):
                kind_totals: dict[str, float] = defaultdict(float)
                for tgt_pos in range(src_pos + 1):
                    kind_totals[kinds[tgt_pos]] += float(head_attn[src_pos, tgt_pos])
                for tgt_kind, total in kind_totals.items():
                    records[(src_kind, tgt_kind, layer_idx, head_idx)].append(total)


def summarize(values: list[float]) -> dict:
    arr = np.array(values, dtype=np.float64)
    return {
        "mean": round(float(arr.mean()), 5),
        "std": round(float(arr.std()), 5),
        "median": round(float(np.median(arr)), 5),
        "q25": round(float(np.percentile(arr, 25)), 5),
        "q75": round(float(np.percentile(arr, 75)), 5),
        "count": len(values),
    }


def compute_routing_stats(
    records: dict[tuple[str, str, int], list[float]],
) -> list[dict]:
    out = []
    for (src, tgt, layer), values in sorted(records.items()):
        row = {"source_kind": src, "target_kind": tgt, "layer": layer}
        row.update(summarize(values))
        out.append(row)
    return out


def compute_entropy_stats(
    records: dict[tuple[str, int], list[float]],
) -> list[dict]:
    out = []
    for (src, layer), values in sorted(records.items()):
        row = {"source_kind": src, "layer": layer}
        row.update(summarize(values))
        out.append(row)
    return out


def compute_head_stats(
    records: dict[tuple[str, str, int, int], list[float]],
) -> list[dict]:
    out = []
    for (src, tgt, layer, head), values in sorted(records.items()):
        row = {
            "source_kind": src,
            "target_kind": tgt,
            "layer": layer,
            "head": head,
        }
        row.update(summarize(values))
        out.append(row)
    return out


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


def plot_entropy_by_layer(stats: list[dict], n_layers: int, output_path: Path) -> None:
    """Line plot: normalized attention entropy across layers by source kind.

    Lower values = more focused; higher = more diffuse. 1.0 = uniform.
    """
    source_kinds = ["bos", "subword", "hyphen", "eos"]
    kind_colors = dict(zip(source_kinds, PALETTE))

    fig, ax = plt.subplots(figsize=(8, 5))
    for kind in source_kinds:
        entries = sorted(
            [e for e in stats if e["source_kind"] == kind],
            key=lambda e: e["layer"],
        )
        if not entries:
            continue
        layers = [e["layer"] for e in entries]
        means = [e["mean"] for e in entries]
        q25s = [e["q25"] for e in entries]
        q75s = [e["q75"] for e in entries]
        color = kind_colors[kind]
        ax.plot(layers, means, "o-", color=color, label=kind, linewidth=2)
        ax.fill_between(layers, q25s, q75s, alpha=0.15, color=color)

    ax.set_xlabel("Layer")
    ax.set_ylabel("Normalized Attention Entropy")
    ax.set_xticks(range(n_layers))
    ax.set_ylim(0, 1.05)
    ax.legend(title="Source Kind")
    ax.set_title("Attention Concentration Across Layers (low = focused)")
    fig.tight_layout()
    fig.savefig(output_path)
    plt.close(fig)
    print(f"  Wrote {output_path}")


def plot_hyphen_position_prefix(
    stats: list[dict], n_layers: int, output_path: Path
) -> None:
    """Line plot: attention to prefix from first/middle/last hyphens."""
    kinds = ["hyphen_first", "hyphen_middle", "hyphen_last"]
    kind_colors = dict(zip(kinds, ["#4e79a7", "#f28e2b", "#e15759"]))

    fig, ax = plt.subplots(figsize=(8, 5))
    for kind in kinds:
        entries = sorted(
            [
                e
                for e in stats
                if e["source_kind"] == kind and e["target_kind"] == "prefix"
            ],
            key=lambda e: e["layer"],
        )
        if not entries:
            continue
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
    ax.legend(title="Hyphen Position")
    ax.set_title("Prefix Attention by Hyphen Position Within Slug")
    fig.tight_layout()
    fig.savefig(output_path)
    plt.close(fig)
    print(f"  Wrote {output_path}")


def plot_head_specialization(
    head_stats: list[dict], n_layers: int, n_heads: int, output_path: Path
) -> None:
    """Heatmap: attention to prefix from hyphens, per head, per layer.

    Reveals whether one head specializes in routing, or whether the
    routing is distributed across heads.
    """
    matrix = np.zeros((n_layers, n_heads))
    for entry in head_stats:
        if entry["source_kind"] == "hyphen" and entry["target_kind"] == "prefix":
            matrix[entry["layer"], entry["head"]] = entry["mean"]

    fig, ax = plt.subplots(figsize=(1.0 + 0.6 * n_heads, 0.6 * n_layers + 1.0))
    sns.heatmap(
        matrix,
        ax=ax,
        cmap="viridis",
        annot=True,
        fmt=".2f",
        cbar_kws={"label": "Mean attention"},
        xticklabels=[f"H{h}" for h in range(n_heads)],
        yticklabels=[f"L{l}" for l in range(n_layers)],
    )
    ax.set_xlabel("Head")
    ax.set_ylabel("Layer")
    ax.set_title("Hyphen→Prefix Attention by Head")
    fig.tight_layout()
    fig.savefig(output_path)
    plt.close(fig)
    print(f"  Wrote {output_path}")


def print_entropy_summary(stats: list[dict]) -> None:
    print("\nNormalized attention entropy (layer 0):")
    for entry in stats:
        if entry["layer"] == 0:
            print(
                f"  {entry['source_kind']:<12s}  "
                f"mean={entry['mean']:.3f}  median={entry['median']:.3f}  "
                f"n={entry['count']}"
            )


def print_hyphen_position_summary(stats: list[dict]) -> None:
    print("\nHyphen position attention to prefix (layer 0):")
    for entry in stats:
        if (
            entry["source_kind"].startswith("hyphen_")
            and entry["target_kind"] == "prefix"
            and entry["layer"] == 0
        ):
            print(
                f"  {entry['source_kind']:<14s}  "
                f"mean={entry['mean']:.3f}  n={entry['count']}"
            )


def print_head_summary(head_stats: list[dict], n_layers: int, n_heads: int) -> None:
    print("\nHyphen→Prefix attention per head, layer 0:")
    for entry in head_stats:
        if (
            entry["source_kind"] == "hyphen"
            and entry["target_kind"] == "prefix"
            and entry["layer"] == 0
        ):
            print(f"  head {entry['head']}: mean={entry['mean']:.3f}")


def main():
    parser = argparse.ArgumentParser(
        description="Extended decoder attention analysis: entropy, hyphen "
        "position, full routing matrix, and per-head specialization."
    )
    parser.add_argument("--workspace", default=DEFAULT_WORKSPACE)
    parser.add_argument(
        "--encoder", default=DEFAULT_ENCODER, choices=["openai", "harrier"]
    )
    parser.add_argument(
        "--model",
        required=True,
        help="Model directory name under workspace/encoder/models/",
    )
    parser.add_argument("--predictions", type=Path, default=None)
    parser.add_argument("--n-samples", type=int, default=DEFAULT_N_SAMPLES)
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument(
        "--skip-entropy",
        action="store_true",
        help="Skip entropy computation",
    )
    parser.add_argument(
        "--skip-hyphen-positions",
        action="store_true",
        help="Skip first/middle/last hyphen breakdown",
    )
    parser.add_argument(
        "--skip-heads",
        action="store_true",
        help="Skip per-head specialization (saves time; per-head capture "
        "doubles per-sample cost)",
    )
    args = parser.parse_args()

    workspace = Workspace(args.workspace)
    encoder: Encoder = args.encoder

    # Resolve paths.
    model_dir = workspace.models_dir(encoder, args.model)
    if not model_dir.is_dir():
        sys.exit(f"Model directory not found: {model_dir}")

    if args.predictions is not None:
        preds_path = args.predictions
    else:
        preds_path = workspace.prediction_path(encoder, f"{args.model}_seq2seq", "test")
    if not preds_path.is_file():
        sys.exit(f"Predictions not found: {preds_path}")

    if args.output is not None:
        output_path = args.output
    else:
        results_dir = workspace.results_dir(encoder)
        results_dir.mkdir(parents=True, exist_ok=True)
        output_path = results_dir / "attention_extended_stats.json"

    print(f"Loading model from {model_dir}...")
    # Always load with per-head capture if heads are enabled. We can derive
    # head-averaged values from per-head, but not the other way around.
    capture_per_head = not args.skip_heads
    model, vocab, manifest = load_model(model_dir)
    n_layers = int(manifest["model"]["num_layers"])
    n_heads = int(manifest["model"]["num_heads"])
    captured = attach_attention_capture(model, per_head=capture_per_head)

    print(f"Loading predictions from {preds_path}...")
    preds_df = pd.read_parquet(preds_path, columns=["id", "predicted_slug"])
    n_available = len(preds_df)
    preds_df = preds_df.sample(
        n=min(args.n_samples, n_available),
        random_state=args.seed,
    )
    print(f"  Sampled {len(preds_df)} of {n_available} predictions")

    print("Loading embeddings...")
    emb_ids, emb_matrix = workspace.load_embeddings(encoder)
    emb_index = {id_: idx for idx, id_ in enumerate(emb_ids)}
    print(f"  {len(emb_ids)} embeddings loaded")

    # Accumulators (allocated as needed).
    routing_records: dict[tuple[str, str, int], list[float]] = defaultdict(list)
    entropy_records: dict[tuple[str, int], list[float]] = defaultdict(list)
    hyphen_records: dict[tuple[str, str, int], list[float]] = defaultdict(list)
    head_records: dict[tuple[str, str, int, int], list[float]] = defaultdict(list)

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
        kinds, hyphen_kinds, attention = run_sample(
            model, vocab, embedding, predicted_slug, captured
        )

        # Routing and entropy operate on head-averaged attention.
        # If per-head was captured, average across heads here.
        if capture_per_head:
            head_avg = attention.mean(axis=1)  # [L, N, N]
        else:
            head_avg = attention  # already [L, N, N]

        accumulate_routing(kinds, head_avg, routing_records)

        if not args.skip_entropy:
            accumulate_entropy(kinds, head_avg, entropy_records)

        if not args.skip_hyphen_positions:
            accumulate_hyphen_routing(hyphen_kinds, head_avg, hyphen_records)

        if not args.skip_heads:
            accumulate_head_routing(kinds, attention, head_records)

        n_processed += 1
        if n_processed % 50 == 0:
            print(
                f"  {n_processed}/{len(preds_df)} samples processed",
                flush=True,
            )

    print(f"Done: {n_processed} processed, {n_skipped} skipped")
    if n_processed == 0:
        sys.exit("No samples were successfully processed")

    # Aggregate.
    payload: dict = {
        "metadata": {
            "n_samples": n_processed,
            "n_skipped": n_skipped,
            "seed": args.seed,
            "model": args.model,
            "n_layers": n_layers,
            "n_heads": n_heads,
            "token_kinds": list(TOKEN_KINDS),
        },
        "routing": compute_routing_stats(routing_records),
    }

    if not args.skip_entropy:
        payload["entropy"] = compute_entropy_stats(entropy_records)
    if not args.skip_hyphen_positions:
        payload["hyphen_positions"] = compute_routing_stats(hyphen_records)
    if not args.skip_heads:
        payload["heads"] = compute_head_stats(head_records)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"\nWrote {output_path}")

    # Figures.
    figures_dir = workspace.figures_dir(encoder)
    figures_dir.mkdir(parents=True, exist_ok=True)
    _setup_style()

    print("\nGenerating figures...")
    if not args.skip_entropy:
        plot_entropy_by_layer(
            payload["entropy"], n_layers, figures_dir / "attention_entropy.png"
        )
    if not args.skip_hyphen_positions:
        plot_hyphen_position_prefix(
            payload["hyphen_positions"],
            n_layers,
            figures_dir / "attention_hyphen_position_prefix.png",
        )
    if not args.skip_heads:
        plot_head_specialization(
            payload["heads"],
            n_layers,
            n_heads,
            figures_dir / "attention_head_specialization.png",
        )

    # Console summaries.
    if not args.skip_entropy:
        print_entropy_summary(payload["entropy"])
    if not args.skip_hyphen_positions:
        print_hyphen_position_summary(payload["hyphen_positions"])
    if not args.skip_heads:
        print_head_summary(payload["heads"], n_layers, n_heads)


if __name__ == "__main__":
    main()
