"""Generate evaluation report with publication-quality figures.

Auto-discovers result JSONs and detail parquets in data/results/,
groups by encoder, and produces:
- Comparison tables (printed to console)
- Violin plots of per-sample score distributions
- Per-source violin plots for all key metrics
- Per-length-bucket violin plots
- Source vs length bucket correlation heatmap
- Scatter: Token F1 vs Distinctiveness
- CDFs for key metrics

All figures saved as PNGs to data/results/figures/.

Usage:
    uv run slug-report
    uv run slug-report --encoder openai
"""

import argparse
import json
import sys
from pathlib import Path

import duckdb
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns

from .config import ENCODERS
from .libs.workspace import Workspace

OVERVIEW_METRICS = [
    ("validity_rate", "Validity", True),
    ("exact_match", "Exact Match", True),
    ("mean_f1", "Token F1", False),
    ("mean_rouge1", "ROUGE-1", False),
    ("mean_rouge_l", "ROUGE-L", False),
    ("mean_bertscore_f1", "BERTScore F1", False),
    ("mean_distinctiveness", "Distinctiveness", False),
    ("vocab_diversity", "Vocab Diversity", True),
]

DETAIL_METRICS = [
    ("f1", "Token F1"),
    ("rouge1", "ROUGE-1"),
    ("rouge_l", "ROUGE-L"),
    ("bertscore_f1", "BERTScore F1"),
    ("distinctiveness", "Distinctiveness"),
]

PALETTE = ["#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f", "#edc948"]


def discover_results(
    workspace: Workspace, encoder_filter: str | None = None
) -> dict[str, dict[str, dict]]:
    """Find result JSONs + detail parquets, grouped by encoder."""
    grouped: dict[str, dict[str, dict]] = {}

    for encoder in ENCODERS:
        if encoder_filter and encoder != encoder_filter:
            continue
        results_directory = workspace.results_dir(encoder)
        if not results_directory.exists():
            continue
        for path in sorted(results_directory.glob("*.json")):
            stem = path.stem
            name = stem
            summary = json.loads(path.read_text())

            detail_path = results_directory / f"{stem}_detail.parquet"
            detail_df = None
            if detail_path.exists():
                detail_df = duckdb.sql(f"SELECT * FROM '{detail_path}'").df()

            grouped.setdefault(encoder, {})[name] = {
                "summary": summary,
                "detail": detail_df,
            }

    return grouped


def _setup_style():
    sns.set_theme(style="whitegrid", font_scale=0.95)
    plt.rcParams.update(
        {
            "figure.dpi": 150,
            "savefig.dpi": 150,
            "savefig.bbox": "tight",
            "savefig.pad_inches": 0.15,
        }
    )


def _build_long_df(runs: dict[str, dict], run_names: list[str]) -> pd.DataFrame | None:
    """Stack all detail DataFrames with a 'run' column."""
    frames = []
    for name in run_names:
        df = runs[name].get("detail")
        if df is not None:
            df = df.copy()
            df["run"] = name
            frames.append(df)
    if not frames:
        return None
    return pd.concat(frames, ignore_index=True)


def print_comparison_table(encoder: str, runs: dict[str, dict]):
    run_names = sorted(runs.keys())
    header = f"{'Metric':<20s}" + "".join(f"{n:>14s}" for n in run_names)
    print(f"\n  {encoder}")
    print(f"  {'=' * len(header)}")
    print(f"  {header}")
    print(f"  {'-' * len(header)}")
    for key, label, is_pct in OVERVIEW_METRICS:
        row = f"{label:<20s}"
        for name in run_names:
            val = runs[name]["summary"].get(key, 0)
            row += f"{val:>13.1%} " if is_pct else f"{val:>13.4f} "
        print(f"  {row}")
    print()


def plot_violins(
    encoder: str, long_df: pd.DataFrame, run_names: list[str], out_dir: Path
):
    """Violin plots for each metric across runs."""
    metrics = [(k, l) for k, l in DETAIL_METRICS if k in long_df.columns]
    if not metrics:
        return

    n = len(metrics)
    fig, axes = plt.subplots(1, n, figsize=(4 * n, 5))
    if n == 1:
        axes = [axes]

    for ax, (key, label) in zip(axes, metrics):
        sns.violinplot(
            data=long_df,
            x="run",
            y=key,
            ax=ax,
            hue="run",
            legend=False,
            palette=PALETTE[: len(run_names)],
            inner="box",
            cut=0,
            density_norm="width",
            order=run_names,
        )
        ax.set_title(label)
        ax.set_ylim(-0.05, 1.05)
        ax.set_xlabel("")
        ax.set_ylabel("")

    fig.suptitle(f"{encoder}: Score Distributions", fontweight="bold", y=1.02)
    fig.tight_layout()
    fig.savefig(out_dir / f"{encoder}_violins.png")
    plt.close(fig)
    print(f"  {encoder}_violins.png")


def plot_per_source(
    encoder: str, long_df: pd.DataFrame, run_names: list[str], out_dir: Path
):
    """Per-source violin plots for each key metric."""
    metrics = [
        ("f1", "Token F1"),
        ("rouge_l", "ROUGE-L"),
        ("bertscore_f1", "BERTScore F1"),
        ("distinctiveness", "Distinctiveness"),
    ]
    metrics = [(k, l) for k, l in metrics if k in long_df.columns]
    if not metrics or "source" not in long_df.columns:
        return

    sources = sorted(long_df["source"].unique())
    n = len(metrics)
    fig, axes = plt.subplots(n, 1, figsize=(max(8, 3 * len(sources)), 4 * n))
    if n == 1:
        axes = [axes]

    for ax, (key, label) in zip(axes, metrics):
        sns.violinplot(
            data=long_df,
            x="source",
            y=key,
            hue="run",
            ax=ax,
            palette=PALETTE[: len(run_names)],
            inner="box",
            cut=0,
            density_norm="width",
            order=sources,
            hue_order=run_names,
        )
        ax.set_title(f"{label} by Source")
        ax.set_ylim(-0.05, 1.05)
        ax.set_xlabel("")
        ax.set_ylabel(label)
        ax.legend(title="Run", loc="lower left", framealpha=0.9, fontsize=8)

    fig.suptitle(f"{encoder}: Per-Source Distributions", fontweight="bold", y=1.01)
    fig.tight_layout()
    fig.savefig(out_dir / f"{encoder}_per_source.png")
    plt.close(fig)
    print(f"  {encoder}_per_source.png")


def plot_per_length_bucket(
    encoder: str, long_df: pd.DataFrame, run_names: list[str], out_dir: Path
):
    """Per-length-bucket violin plots for key metrics."""
    if "length_bucket" not in long_df.columns:
        return

    metrics = [
        ("f1", "Token F1"),
        ("rouge_l", "ROUGE-L"),
        ("distinctiveness", "Distinctiveness"),
    ]
    metrics = [(k, l) for k, l in metrics if k in long_df.columns]
    if not metrics:
        return

    bucket_order = ["short", "medium", "long"]
    buckets = [b for b in bucket_order if b in long_df["length_bucket"].unique()]

    n = len(metrics)
    fig, axes = plt.subplots(1, n, figsize=(5 * n, 5))
    if n == 1:
        axes = [axes]

    for ax, (key, label) in zip(axes, metrics):
        sns.violinplot(
            data=long_df,
            x="length_bucket",
            y=key,
            hue="run",
            ax=ax,
            palette=PALETTE[: len(run_names)],
            inner="box",
            cut=0,
            density_norm="width",
            order=buckets,
            hue_order=run_names,
        )
        ax.set_title(f"{label} by Length")
        ax.set_ylim(-0.05, 1.05)
        ax.set_xlabel("Source Text Length")
        ax.set_ylabel(label)
        ax.legend(title="Run", loc="lower left", framealpha=0.9, fontsize=8)

    fig.suptitle(
        f"{encoder}: Per-Length-Bucket Distributions", fontweight="bold", y=1.02
    )
    fig.tight_layout()
    fig.savefig(out_dir / f"{encoder}_per_length.png")
    plt.close(fig)
    print(f"  {encoder}_per_length.png")


def plot_source_length_heatmap(encoder: str, long_df: pd.DataFrame, out_dir: Path):
    """Heatmap showing sample counts at the intersection of source and length bucket."""
    if "length_bucket" not in long_df.columns or "source" not in long_df.columns:
        return

    # Use only one run (they have the same underlying samples)
    first_run = long_df["run"].iloc[0]
    subset = long_df[long_df["run"] == first_run]

    bucket_order = ["short", "medium", "long"]
    ct = pd.crosstab(subset["source"], subset["length_bucket"])
    ct = ct.reindex(columns=[b for b in bucket_order if b in ct.columns])

    fig, ax = plt.subplots(figsize=(6, 4))
    sns.heatmap(ct, annot=True, fmt="d", cmap="YlOrRd", ax=ax)
    ax.set_title(f"{encoder}: Samples by Source x Length")
    ax.set_xlabel("Length Bucket")
    ax.set_ylabel("Source")

    fig.tight_layout()
    fig.savefig(out_dir / f"{encoder}_source_length_heatmap.png")
    plt.close(fig)
    print(f"  {encoder}_source_length_heatmap.png")


def plot_scatter_f1_vs_distinct(
    encoder: str, long_df: pd.DataFrame, run_names: list[str], out_dir: Path
):
    """Scatter: Token F1 vs Distinctiveness, colored by run."""
    if "f1" not in long_df.columns or "distinctiveness" not in long_df.columns:
        return

    fig, ax = plt.subplots(figsize=(7, 6))
    for i, name in enumerate(run_names):
        sub = long_df[long_df["run"] == name]
        ax.scatter(
            sub["f1"],
            sub["distinctiveness"],
            s=10,
            alpha=0.4,
            color=PALETTE[i % len(PALETTE)],
            label=name,
        )

    ax.set_xlabel("Token F1")
    ax.set_ylabel("Distinctiveness")
    ax.set_xlim(-0.05, 1.05)
    ax.set_ylim(-0.05, 1.05)
    ax.legend(loc="lower left", framealpha=0.9)
    ax.set_title(f"{encoder}: Token F1 vs Distinctiveness")

    fig.tight_layout()
    fig.savefig(out_dir / f"{encoder}_scatter_f1_distinct.png")
    plt.close(fig)
    print(f"  {encoder}_scatter_f1_distinct.png")


def plot_cdfs(encoder: str, long_df: pd.DataFrame, run_names: list[str], out_dir: Path):
    """CDF plots for key metrics."""
    cdf_metrics = [
        ("f1", "Token F1"),
        ("rouge_l", "ROUGE-L"),
        ("distinctiveness", "Distinctiveness"),
    ]
    cdf_metrics = [(k, l) for k, l in cdf_metrics if k in long_df.columns]
    if not cdf_metrics:
        return

    n = len(cdf_metrics)
    fig, axes = plt.subplots(1, n, figsize=(5 * n, 5))
    if n == 1:
        axes = [axes]

    for ax, (key, label) in zip(axes, cdf_metrics):
        for i, name in enumerate(run_names):
            values = sorted(long_df[long_df["run"] == name][key].dropna())
            if not len(values):
                continue
            ys = np.arange(1, len(values) + 1) / len(values)
            ax.plot(
                values, ys, label=name, color=PALETTE[i % len(PALETTE)], linewidth=2
            )

        ax.set_xlabel(label)
        ax.set_ylabel("Cumulative Fraction")
        ax.set_xlim(-0.05, 1.05)
        ax.set_ylim(0, 1.05)
        ax.legend(loc="lower right", framealpha=0.9)
        ax.set_title(f"{label} CDF")

    fig.suptitle(f"{encoder}: Cumulative Distributions", fontweight="bold", y=1.02)
    fig.tight_layout()
    fig.savefig(out_dir / f"{encoder}_cdfs.png")
    plt.close(fig)
    print(f"  {encoder}_cdfs.png")


def plot_token_count_vs_f1(
    encoder: str, long_df: pd.DataFrame, run_names: list[str], out_dir: Path
):
    """Scatter: source token count vs Token F1, showing length-quality correlation."""
    if "token_count" not in long_df.columns or "f1" not in long_df.columns:
        return

    fig, ax = plt.subplots(figsize=(8, 5))
    for i, name in enumerate(run_names):
        sub = long_df[long_df["run"] == name]
        ax.scatter(
            sub["token_count"],
            sub["f1"],
            s=8,
            alpha=0.3,
            color=PALETTE[i % len(PALETTE)],
            label=name,
        )

    ax.set_xlabel("Source Token Count")
    ax.set_ylabel("Token F1")
    ax.set_ylim(-0.05, 1.05)
    ax.legend(loc="lower left", framealpha=0.9)
    ax.set_title(f"{encoder}: Source Length vs Token F1")

    fig.tight_layout()
    fig.savefig(out_dir / f"{encoder}_length_vs_f1.png")
    plt.close(fig)
    print(f"  {encoder}_length_vs_f1.png")


def main():
    parser = argparse.ArgumentParser(description="Generate evaluation report figures")
    parser.add_argument(
        "--encoder", choices=list(ENCODERS), help="Only report on this encoder"
    )
    parser.add_argument("--workspace", default="original")
    args = parser.parse_args()

    workspace = Workspace(args.workspace)

    _setup_style()

    grouped = discover_results(workspace, encoder_filter=args.encoder)
    if not grouped:
        print(f"No results found in workspace '{workspace.name}'")
        sys.exit(1)

    for encoder, runs in sorted(grouped.items()):
        figures_directory = workspace.figures_dir(encoder)
        figures_directory.mkdir(parents=True, exist_ok=True)

        run_names = sorted(runs.keys())
        print_comparison_table(encoder, runs)

        long_df = _build_long_df(runs, run_names)
        if long_df is not None:
            plot_violins(encoder, long_df, run_names, figures_directory)
            plot_per_source(encoder, long_df, run_names, figures_directory)
            plot_per_length_bucket(encoder, long_df, run_names, figures_directory)
            plot_source_length_heatmap(encoder, long_df, figures_directory)
            plot_scatter_f1_vs_distinct(encoder, long_df, run_names, figures_directory)
            plot_cdfs(encoder, long_df, run_names, figures_directory)
            plot_token_count_vs_f1(encoder, long_df, run_names, figures_directory)

    print(f"\nFigures saved to workspace '{workspace.name}'")


if __name__ == "__main__":
    main()
