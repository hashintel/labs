"""Visualize vocab compression clustering results.

Projects token embeddings to 2D via UMAP, then generates:
1. Interactive HTML scatter plots (one per strategy) with hover to see tokens
2. Static cluster size distribution plots (matplotlib)

Usage:
    uv run slug-visualize-vocab --workspace url --encoder openai
    uv run slug-visualize-vocab --workspace url --encoder openai --sample 20000
"""

import argparse
import json
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import seaborn as sns

from .config import ENCODERS
from .libs.workspace import EMBEDDING_SCHEMA, Workspace


def load_vocab_embeddings(
    workspace: Workspace, encoder: str
) -> tuple[list[str], np.ndarray]:
    """Load vocab embeddings from the workspace."""
    import pyarrow.parquet as pq

    path = workspace.encoder_dir(encoder) / "vocab_embeddings.parquet"
    table = pq.read_table(path, schema=EMBEDDING_SCHEMA)

    tokens = table.column("id").to_pylist()

    column = table.column("embedding")
    chunk_arrays = []
    for chunk in column.chunks:
        offsets = chunk.offsets.to_numpy()
        values = chunk.values.to_numpy()
        dimension = offsets[1] - offsets[0]
        chunk_arrays.append(values.reshape(-1, dimension))
    embeddings = np.concatenate(chunk_arrays, axis=0)

    return tokens, embeddings


def load_mappings(workspace: Workspace, encoder: str) -> dict[str, dict[str, str]]:
    """Load all saved grouping mappings."""
    compression_directory = workspace.encoder_dir(encoder) / "vocab_compression"
    mappings = {}
    for path in sorted(compression_directory.glob("*.json")):
        if path.name == "token_counts.json":
            continue
        name = path.stem
        with open(path) as f:
            mappings[name] = json.load(f)
    return mappings


def load_token_counts(workspace: Workspace, encoder: str) -> dict[str, int]:
    """Load token frequency counts."""
    path = workspace.encoder_dir(encoder) / "vocab_compression" / "token_counts.json"
    with open(path) as f:
        return json.load(f)


def project_umap(embeddings: np.ndarray) -> np.ndarray:
    """Project embeddings to 2D via UMAP."""
    from umap import UMAP

    print(f"  UMAP projection: {embeddings.shape} -> 2D...")
    reducer = UMAP(n_components=2, random_state=42, n_neighbors=30, min_dist=0.1)
    return reducer.fit_transform(embeddings)


def assign_cluster_labels(
    tokens: list[str], mapping: dict[str, str]
) -> tuple[np.ndarray, dict[int, str]]:
    """Convert a token->representative mapping to integer cluster labels.

    Returns (labels, label_to_representative).
    Tokens that are singletons (map to themselves and aren't a representative
    for anyone else) get label -1.
    """
    representative_members: dict[str, list[int]] = {}
    for index, token in enumerate(tokens):
        representative = mapping.get(token, token)
        representative_members.setdefault(representative, []).append(index)

    labels = np.full(len(tokens), -1, dtype=np.int32)
    label_to_representative: dict[int, str] = {}
    label_counter = 0

    for representative, member_indices in representative_members.items():
        if len(member_indices) == 1 and tokens[member_indices[0]] == representative:
            continue
        label_to_representative[label_counter] = representative
        for index in member_indices:
            labels[index] = label_counter
        label_counter += 1

    return labels, label_to_representative


def generate_interactive_html(
    projection: np.ndarray,
    tokens: list[str],
    labels: np.ndarray,
    label_to_representative: dict[int, str],
    token_counts: dict[str, int],
    strategy_name: str,
    output_path: Path,
):
    """Generate an interactive HTML scatter plot with hover tooltips."""
    n_clusters = len(label_to_representative)
    n_noise = int((labels == -1).sum())

    points_json = json.dumps([
        {
            "x": float(projection[i, 0]),
            "y": float(projection[i, 1]),
            "token": tokens[i],
            "freq": token_counts.get(tokens[i], 0),
            "cluster": int(labels[i]),
            "representative": label_to_representative.get(int(labels[i]), tokens[i]),
        }
        for i in range(len(tokens))
    ])

    html = f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Vocab Clusters: {strategy_name}</title>
<style>
  body {{ margin: 0; font-family: system-ui, sans-serif; background: #1a1a2e; color: #eee; }}
  #header {{ padding: 12px 20px; background: #16213e; border-bottom: 1px solid #333; }}
  #header h1 {{ margin: 0; font-size: 18px; font-weight: 500; }}
  #header .stats {{ font-size: 13px; color: #999; margin-top: 4px; }}
  #canvas-container {{ position: relative; width: 100vw; height: calc(100vh - 60px); }}
  canvas {{ display: block; width: 100%; height: 100%; }}
  #tooltip {{
    display: none; position: absolute; pointer-events: none;
    background: #16213e; border: 1px solid #555; border-radius: 6px;
    padding: 8px 12px; font-size: 13px; max-width: 300px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
  }}
  #tooltip .token {{ font-size: 16px; font-weight: 600; color: #e94560; }}
  #tooltip .detail {{ color: #aaa; margin-top: 4px; }}
  #search {{
    position: absolute; top: 10px; right: 10px;
    background: #16213e; border: 1px solid #555; border-radius: 4px;
    color: #eee; padding: 6px 10px; font-size: 13px; width: 200px;
  }}
  #search::placeholder {{ color: #666; }}
</style>
</head>
<body>
<div id="header">
  <h1>Vocab Clusters: {strategy_name}</h1>
  <div class="stats">{len(tokens):,} tokens, {n_clusters:,} clusters, {n_noise:,} noise/singletons</div>
</div>
<div id="canvas-container">
  <canvas id="canvas"></canvas>
  <div id="tooltip"></div>
  <input id="search" type="text" placeholder="Search tokens...">
</div>
<script>
const points = {points_json};

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const tooltip = document.getElementById('tooltip');
const searchInput = document.getElementById('search');
const container = document.getElementById('canvas-container');

let width, height, dpr;
let viewX = 0, viewY = 0, viewScale = 1;
let isDragging = false, dragStartX, dragStartY, dragViewX, dragViewY;
let searchTerm = '';

function resize() {{
  dpr = window.devicePixelRatio || 1;
  width = container.clientWidth;
  height = container.clientHeight;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}}

function initView() {{
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of points) {{
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }}
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const padding = 0.05;
  viewScale = Math.min(width / (rangeX * (1 + 2 * padding)), height / (rangeY * (1 + 2 * padding)));
  viewX = width / 2 - (minX + rangeX / 2) * viewScale;
  viewY = height / 2 - (minY + rangeY / 2) * viewScale;
}}

function toScreen(x, y) {{
  return [x * viewScale + viewX, y * viewScale + viewY];
}}

function toWorld(sx, sy) {{
  return [(sx - viewX) / viewScale, (sy - viewY) / viewScale];
}}

const clusterColors = new Map();
function getColor(cluster) {{
  if (cluster === -1) return 'rgba(100,100,100,0.3)';
  if (!clusterColors.has(cluster)) {{
    const hue = (cluster * 137.508) % 360;
    clusterColors.set(cluster, `hsla(${{hue}}, 70%, 55%, 0.7)`);
  }}
  return clusterColors.get(cluster);
}}

function draw() {{
  ctx.clearRect(0, 0, width, height);
  const r = Math.max(1.5, 2.5 / Math.sqrt(viewScale / 10));
  const searchLower = searchTerm.toLowerCase();
  const hasSearch = searchLower.length > 0;

  for (const p of points) {{
    const [sx, sy] = toScreen(p.x, p.y);
    if (sx < -10 || sx > width + 10 || sy < -10 || sy > height + 10) continue;

    let isMatch = false;
    if (hasSearch) {{
      isMatch = p.token.toLowerCase().includes(searchLower) ||
                p.representative.toLowerCase().includes(searchLower);
    }}

    ctx.beginPath();
    ctx.arc(sx, sy, hasSearch && isMatch ? r * 2 : r, 0, Math.PI * 2);

    if (hasSearch && !isMatch) {{
      ctx.fillStyle = 'rgba(50,50,50,0.2)';
    }} else {{
      ctx.fillStyle = getColor(p.cluster);
    }}
    ctx.fill();

    if (hasSearch && isMatch) {{
      ctx.strokeStyle = '#e94560';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }}
  }}
}}

function findNearest(mx, my) {{
  const [wx, wy] = toWorld(mx, my);
  let best = null, bestDist = Infinity;
  const threshold = 10 / viewScale;
  for (const p of points) {{
    const dx = p.x - wx, dy = p.y - wy;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist && dist < threshold * threshold) {{
      bestDist = dist;
      best = p;
    }}
  }}
  return best;
}}

canvas.addEventListener('mousemove', (e) => {{
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  if (isDragging) {{
    viewX = dragViewX + (e.clientX - dragStartX);
    viewY = dragViewY + (e.clientY - dragStartY);
    draw();
    tooltip.style.display = 'none';
    return;
  }}

  const nearest = findNearest(mx, my);
  if (nearest) {{
    tooltip.style.display = 'block';
    tooltip.style.left = (mx + 15) + 'px';
    tooltip.style.top = (my - 10) + 'px';
    tooltip.innerHTML = `
      <div class="token">${{nearest.token}}</div>
      <div class="detail">
        freq: ${{nearest.freq.toLocaleString()}}<br>
        cluster: ${{nearest.cluster === -1 ? 'noise' : nearest.cluster}}<br>
        representative: ${{nearest.representative}}
      </div>`;
  }} else {{
    tooltip.style.display = 'none';
  }}
}});

canvas.addEventListener('mousedown', (e) => {{
  isDragging = true;
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  dragViewX = viewX;
  dragViewY = viewY;
  canvas.style.cursor = 'grabbing';
}});

canvas.addEventListener('mouseup', () => {{
  isDragging = false;
  canvas.style.cursor = 'default';
}});

canvas.addEventListener('mouseleave', () => {{
  isDragging = false;
  tooltip.style.display = 'none';
  canvas.style.cursor = 'default';
}});

canvas.addEventListener('wheel', (e) => {{
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const factor = e.deltaY > 0 ? 0.9 : 1.1;

  viewX = mx - (mx - viewX) * factor;
  viewY = my - (my - viewY) * factor;
  viewScale *= factor;
  draw();
}}, {{ passive: false }});

searchInput.addEventListener('input', (e) => {{
  searchTerm = e.target.value;
  draw();
}});

window.addEventListener('resize', () => {{ resize(); draw(); }});

resize();
initView();
draw();
</script>
</body>
</html>"""

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(html)
    print(f"Saved {output_path}")


def plot_cluster_sizes(
    strategy_labels: dict[str, np.ndarray],
    output_path: Path,
):
    """Plot cluster size distributions for each strategy."""
    strategies = list(strategy_labels.keys())
    n_strategies = len(strategies)

    fig, axes = plt.subplots(1, n_strategies, figsize=(6 * n_strategies, 5))
    if n_strategies == 1:
        axes = [axes]

    for ax, strategy_name in zip(axes, strategies):
        labels = strategy_labels[strategy_name]
        valid_labels = labels[labels >= 0]
        if len(valid_labels) == 0:
            continue

        sizes = np.bincount(valid_labels)
        sizes = sizes[sizes > 0]

        ax.hist(sizes, bins=100, color="#4e79a7", edgecolor="none", alpha=0.8)
        ax.set_xlabel("Cluster size")
        ax.set_ylabel("Count")
        ax.set_title(
            f"{strategy_name}\nmedian={int(np.median(sizes))}, max={sizes.max()}"
        )
        ax.set_yscale("log")

    fig.suptitle("Cluster Size Distributions", fontsize=14)
    fig.tight_layout()
    fig.savefig(output_path, dpi=150, bbox_inches="tight")
    plt.close(fig)
    print(f"Saved {output_path}")


def main():
    parser = argparse.ArgumentParser(description="Visualize vocab compression results")
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--encoder", required=True, choices=list(ENCODERS))
    parser.add_argument(
        "--sample",
        type=int,
        default=20_000,
        help="Number of tokens to sample for UMAP projection (0 for all)",
    )
    args = parser.parse_args()

    workspace = Workspace(args.workspace)
    encoder = args.encoder

    sns.set_theme(style="whitegrid", font_scale=0.95)
    plt.rcParams.update({"figure.dpi": 150, "savefig.dpi": 150})

    print("Loading vocab embeddings...")
    tokens, embeddings = load_vocab_embeddings(workspace, encoder)
    print(f"  {len(tokens):,} tokens, {embeddings.shape}")

    print("Loading grouping results...")
    mappings = load_mappings(workspace, encoder)
    print(f"  Strategies: {list(mappings.keys())}")

    token_counts = load_token_counts(workspace, encoder)

    # Sample for UMAP if needed
    sample_indices = None
    if args.sample and args.sample < len(tokens):
        rng = np.random.RandomState(42)
        sample_indices = rng.choice(len(tokens), size=args.sample, replace=False)
        sample_indices.sort()
        working_embeddings = embeddings[sample_indices]
        working_tokens = [tokens[i] for i in sample_indices]
        print(f"  Sampled {args.sample:,} tokens for UMAP")
    else:
        working_embeddings = embeddings
        working_tokens = tokens

    # UMAP projection (shared across strategies)
    projection = project_umap(working_embeddings)

    output_directory = workspace.encoder_dir(encoder) / "vocab_compression" / "figures"
    output_directory.mkdir(parents=True, exist_ok=True)

    # Interactive HTML per strategy
    strategy_labels_full: dict[str, np.ndarray] = {}
    for name, mapping in mappings.items():
        print(f"\nGenerating visualization for {name}...")
        all_labels, label_to_representative = assign_cluster_labels(tokens, mapping)
        strategy_labels_full[name] = all_labels

        if sample_indices is not None:
            sampled_labels = all_labels[sample_indices]
            sampled_label_to_rep = {
                label: rep
                for label, rep in label_to_representative.items()
                if label in sampled_labels
            }
        else:
            sampled_labels = all_labels
            sampled_label_to_rep = label_to_representative

        generate_interactive_html(
            projection,
            working_tokens,
            sampled_labels,
            sampled_label_to_rep,
            token_counts,
            name,
            output_directory / f"{name}.html",
        )

    # Cluster size distributions (matplotlib, full data)
    print("\nPlotting cluster size distributions...")
    plot_cluster_sizes(strategy_labels_full, output_directory / "cluster_sizes.png")

    print(f"\nAll figures saved to {output_directory}")


if __name__ == "__main__":
    main()
