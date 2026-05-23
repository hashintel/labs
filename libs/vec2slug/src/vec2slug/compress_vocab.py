"""Compress the slug vocabulary by embedding tokens and grouping.

Extracts all unique slug tokens from the training split, embeds them
through the same encoder, then runs three grouping strategies:

  1. KMeans (MiniBatch): fixed k, every token assigned
  2. HDBSCAN: density-based, discovers natural clusters, labels outliers
  3. Similarity graph: cosine threshold + connected components

The output is a comparison of the three approaches and saved mappings.

Usage:
    uv run slug-compress-vocab --workspace url --encoder openai
"""

import argparse
import json
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass

import numpy as np

from .config import ENCODERS, SEED, Encoder
from .libs.embed import CheckpointedRunner, openrouter_embedder
from .libs.workspace import CorpusText, Id, Workspace


@dataclass
class GroupingResult:
    """Output of a grouping strategy."""

    name: str
    labels: np.ndarray  # cluster label per token (-1 = noise)
    mapping: dict[str, str]  # token -> representative
    n_clusters: int  # number of actual clusters (excluding noise)
    n_noise: int  # tokens labeled as noise


class GroupingStrategy(ABC):
    """Base class for token grouping strategies."""

    @property
    @abstractmethod
    def name(self) -> str: ...

    @abstractmethod
    def fit(
        self,
        tokens: list[str],
        embeddings: np.ndarray,
        token_counts: dict[str, int],
        reduced_embeddings: np.ndarray | None = None,
    ) -> GroupingResult: ...

    def _pick_representatives(
        self,
        tokens: list[str],
        labels: np.ndarray,
        token_counts: dict[str, int],
        embeddings: np.ndarray,
    ) -> dict[str, str]:
        """For each cluster, pick the most frequent token as representative.

        Ties in frequency are broken by proximity to the cluster centroid.
        """
        # Compute cluster centroids
        unique_labels = set(labels)
        unique_labels.discard(-1)
        centroids: dict[int, np.ndarray] = {}
        for label in unique_labels:
            mask = labels == label
            centroids[label] = embeddings[mask].mean(axis=0)

        # Pick best per cluster: highest frequency, then closest to centroid
        cluster_best: dict[int, tuple[str, int, float]] = {}
        for token, label, embedding in zip(tokens, labels, embeddings):
            if label == -1:
                continue
            frequency = token_counts.get(token, 0)
            distance = float(np.linalg.norm(embedding - centroids[label]))
            current = cluster_best.get(label)
            if current is None:
                cluster_best[label] = (token, frequency, distance)
            elif frequency > current[1]:
                cluster_best[label] = (token, frequency, distance)
            elif frequency == current[1] and distance < current[2]:
                cluster_best[label] = (token, frequency, distance)

        representatives = {label: best[0] for label, best in cluster_best.items()}
        mapping: dict[str, str] = {}
        for token, label in zip(tokens, labels):
            if label == -1:
                mapping[token] = token
            else:
                mapping[token] = representatives[label]
        return mapping


class KMeansGrouping(GroupingStrategy):
    """Fixed-k MiniBatch KMeans."""

    def __init__(self, n_clusters: int = 5000):
        self.n_clusters = n_clusters

    @property
    def name(self) -> str:
        return f"kmeans-{self.n_clusters}"

    def fit(self, tokens, embeddings, token_counts, reduced_embeddings=None):
        from sklearn.cluster import MiniBatchKMeans

        kmeans = MiniBatchKMeans(
            n_clusters=self.n_clusters,
            random_state=SEED,
            n_init="auto",
            batch_size=min(15_000, len(tokens)),
        )
        labels = kmeans.fit_predict(embeddings)
        mapping = self._pick_representatives(tokens, labels, token_counts, embeddings)

        return GroupingResult(
            name=self.name,
            labels=labels,
            mapping=mapping,
            n_clusters=self.n_clusters,
            n_noise=0,
        )


class HDBSCANGrouping(GroupingStrategy):
    """Density-based clustering with automatic cluster discovery."""

    def __init__(self, min_cluster_size: int = 5, min_samples: int = 3):
        self.min_cluster_size = min_cluster_size
        self.min_samples = min_samples

    @property
    def name(self) -> str:
        return f"hdbscan-{self.min_cluster_size}"

    def fit(self, tokens, embeddings, token_counts, reduced_embeddings=None):
        from sklearn.cluster import HDBSCAN

        working = reduced_embeddings if reduced_embeddings is not None else embeddings

        clusterer = HDBSCAN(
            min_cluster_size=self.min_cluster_size,
            min_samples=self.min_samples,
            metric="cosine",
            n_jobs=-1,
        )
        labels = clusterer.fit_predict(working)
        mapping = self._pick_representatives(tokens, labels, token_counts, embeddings)

        n_noise = int(np.sum(labels == -1))
        n_clusters = len(set(labels)) - (1 if n_noise > 0 else 0)

        return GroupingResult(
            name=self.name,
            labels=labels,
            mapping=mapping,
            n_clusters=n_clusters,
            n_noise=n_noise,
        )


class SimilarityGraphGrouping(GroupingStrategy):
    """Cosine similarity threshold with connected components.

    Uses ball tree radius search on reduced/normalized embeddings to
    avoid materializing the full pairwise matrix.
    """

    def __init__(self, threshold: float = 0.85):
        self.threshold = threshold

    @property
    def name(self) -> str:
        return f"simgraph-{self.threshold}"

    def fit(self, tokens, embeddings, token_counts, reduced_embeddings=None):
        from scipy.sparse.csgraph import connected_components
        from sklearn.neighbors import NearestNeighbors
        from sklearn.preprocessing import normalize

        working = reduced_embeddings if reduced_embeddings is not None else embeddings
        # Re-normalize so euclidean distance approximates cosine distance
        working = normalize(working)

        # Euclidean distance on L2-normalized vectors:
        # ||a - b||^2 = 2 - 2*cos(a,b), so cos >= t  <=>  ||a-b|| <= sqrt(2 - 2t)
        euclidean_radius = np.sqrt(2.0 - 2.0 * self.threshold)
        print(
            f"  Finding neighbors within euclidean distance {euclidean_radius:.4f} (cosine >= {self.threshold})..."
        )

        nn = NearestNeighbors(
            radius=euclidean_radius,
            metric="euclidean",
            algorithm="ball_tree",
            n_jobs=-1,
        )
        nn.fit(working)
        adjacency = nn.radius_neighbors_graph(working, mode="connectivity")

        n_components, labels = connected_components(adjacency, directed=False)
        # Use original full-dimensional embeddings for representative selection
        mapping = self._pick_representatives(tokens, labels, token_counts, embeddings)

        component_sizes = np.bincount(labels)
        n_singletons = int(np.sum(component_sizes == 1))

        return GroupingResult(
            name=self.name,
            labels=labels,
            mapping=mapping,
            n_clusters=n_components,
            n_noise=n_singletons,
        )


class LouvainGrouping(GroupingStrategy):
    """Cosine similarity graph with Louvain community detection.

    Builds the same radius neighbor graph as SimilarityGraphGrouping,
    but uses Louvain instead of connected components. Louvain finds
    dense subgroups without the transitivity explosion.
    """

    def __init__(self, threshold: float = 0.85):
        self.threshold = threshold

    @property
    def name(self) -> str:
        return f"louvain-{self.threshold}"

    def fit(self, tokens, embeddings, token_counts, reduced_embeddings=None):
        import networkx as nx
        from sklearn.neighbors import NearestNeighbors
        from sklearn.preprocessing import normalize

        working = reduced_embeddings if reduced_embeddings is not None else embeddings
        working = normalize(working)

        euclidean_radius = np.sqrt(2.0 - 2.0 * self.threshold)
        print(
            f"  Building neighbor graph (cosine >= {self.threshold})..."
        )

        nn = NearestNeighbors(
            radius=euclidean_radius,
            metric="euclidean",
            algorithm="ball_tree",
            n_jobs=-1,
        )
        nn.fit(working)
        adjacency = nn.radius_neighbors_graph(working, mode="connectivity")

        print(f"  Graph: {adjacency.shape[0]:,} nodes, {adjacency.nnz:,} edges")
        print("  Running Louvain community detection...")

        graph = nx.from_scipy_sparse_array(adjacency)
        communities = nx.community.louvain_communities(graph, seed=42)

        # Convert communities to label array
        labels = np.full(len(tokens), -1, dtype=np.int32)
        for label, community in enumerate(communities):
            for node_index in community:
                labels[node_index] = label

        mapping = self._pick_representatives(tokens, labels, token_counts, embeddings)

        community_sizes = [len(c) for c in communities]
        n_singletons = sum(1 for s in community_sizes if s == 1)

        return GroupingResult(
            name=self.name,
            labels=labels,
            mapping=mapping,
            n_clusters=len(communities),
            n_noise=n_singletons,
        )


def extract_vocab(workspace: Workspace, encoder: Encoder) -> dict[str, int]:
    """Extract all unique slug tokens with frequencies from the training split."""
    slugs = workspace.load_split_slugs(encoder, "train")
    token_counts: dict[str, int] = {}
    for slug in slugs:
        for token in slug.split("-"):
            token_counts[token] = token_counts.get(token, 0) + 1
    return token_counts


def embed_vocab(
    workspace: Workspace, encoder: Encoder, tokens: list[str]
) -> tuple[list[str], np.ndarray]:
    """Embed vocab tokens using the same encoder as documents."""
    encoder_config = ENCODERS[encoder]
    output_path = workspace.encoder_dir(encoder) / "vocab_embeddings.parquet"

    embedder = openrouter_embedder(model=encoder_config.model)
    runner = CheckpointedRunner(output_path=output_path, embedder=embedder)

    documents = (CorpusText(id=Id(token), text=token) for token in tokens)
    runner.run(documents, total=len(tokens))

    # Load and reorder to match input token order
    import pyarrow.parquet as pq

    from .libs.workspace import EMBEDDING_SCHEMA

    table = pq.read_table(output_path, schema=EMBEDDING_SCHEMA)
    loaded_ids = table.column("id").to_pylist()

    column = table.column("embedding")
    chunk_arrays = []
    for chunk in column.chunks:
        offsets = chunk.offsets.to_numpy()
        values = chunk.values.to_numpy()
        dimension = offsets[1] - offsets[0]
        chunk_arrays.append(values.reshape(-1, dimension))
    embeddings = np.concatenate(chunk_arrays, axis=0)

    # Reorder to match sorted token order
    token_to_index = {token: index for index, token in enumerate(loaded_ids)}
    ordered_indices = [token_to_index[token] for token in tokens]
    embeddings = embeddings[ordered_indices]

    return tokens, embeddings


def print_comparison(results: list[GroupingResult], token_counts: dict[str, int]):
    """Print a comparison of grouping strategies."""
    total_frequency = sum(token_counts.values())

    print(
        f"\n{'Strategy':<25s} {'Clusters':>10s} {'Noise':>10s} {'Unique Reps':>12s} {'Coverage':>10s}"
    )
    print("-" * 70)

    for result in results:
        representatives = set(result.mapping.values())
        representative_frequency = sum(
            token_counts.get(token, 0) for token in representatives
        )
        coverage = representative_frequency / total_frequency
        print(
            f"{result.name:<25s} "
            f"{result.n_clusters:>10,d} "
            f"{result.n_noise:>10,d} "
            f"{len(representatives):>12,d} "
            f"{coverage:>9.1%}"
        )


def print_sample_clusters(
    result: GroupingResult,
    tokens: list[str],
    token_counts: dict[str, int],
    n_samples: int = 10,
):
    """Print sample clusters from a grouping result."""
    # Group tokens by cluster
    clusters: dict[int, list[str]] = {}
    for token, label in zip(tokens, result.labels):
        if label == -1:
            continue
        clusters.setdefault(int(label), []).append(token)

    # Sort clusters by total frequency, show top N
    cluster_frequencies = {
        label: sum(token_counts.get(token, 0) for token in members)
        for label, members in clusters.items()
    }
    top_clusters = sorted(
        cluster_frequencies, key=cluster_frequencies.get, reverse=True
    )[:n_samples]

    print(f"\n  Top {n_samples} clusters by frequency ({result.name}):")
    for label in top_clusters:
        members = clusters[label]
        representative = None
        for token in members:
            if result.mapping.get(token) == token:
                representative = token
                break

        # Sort members by frequency
        sorted_members = sorted(
            members, key=lambda t: token_counts.get(t, 0), reverse=True
        )
        preview = sorted_members[:8]
        suffix = f" ... +{len(sorted_members) - 8}" if len(sorted_members) > 8 else ""
        freq = cluster_frequencies[label]
        print(
            f"    [{representative or '?'}] (freq={freq:,}, size={len(members)}): {', '.join(preview)}{suffix}"
        )


def main():
    parser = argparse.ArgumentParser(
        description="Compress slug vocabulary via embedding + grouping"
    )
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--encoder", required=True, choices=list(ENCODERS))
    parser.add_argument(
        "--n-clusters", type=int, default=5000, help="Target clusters for KMeans"
    )
    parser.add_argument(
        "--hdbscan",
        action="store_true",
        help="Include HDBSCAN (O(n²) memory, may OOM on large vocabs)",
    )
    parser.add_argument(
        "--hdbscan-min-size", type=int, default=5, help="Min cluster size for HDBSCAN"
    )
    parser.add_argument(
        "--reduce-dims",
        type=int,
        default=50,
        help="PCA dimensions for HDBSCAN and similarity graph (0 to disable)",
    )
    parser.add_argument(
        "--sim-threshold",
        type=float,
        default=0.85,
        help="Cosine threshold for similarity graph",
    )
    args = parser.parse_args()

    workspace = Workspace(args.workspace)
    encoder = args.encoder

    # Step 1: Extract vocab
    print("Extracting vocabulary from training split...")
    token_counts = extract_vocab(workspace, encoder)
    tokens = sorted(token_counts.keys())
    print(f"  {len(tokens):,} unique tokens")

    hapax = sum(1 for count in token_counts.values() if count == 1)
    print(f"  {hapax:,} hapax ({hapax / len(tokens):.1%})")

    # Step 2: Embed tokens
    print("\nEmbedding vocabulary tokens...")
    _, embeddings = embed_vocab(workspace, encoder, tokens)
    print(f"  {embeddings.shape}")

    # Step 3: Reduce dimensions (shared across strategies that need it)
    reduced_embeddings = None
    if args.reduce_dims and args.reduce_dims < embeddings.shape[1]:
        reduced_path = (
            workspace.encoder_dir(encoder)
            / f"vocab_embeddings_pca{args.reduce_dims}.npy"
        )
        if reduced_path.exists():
            print(f"\nLoading cached PCA reduction from {reduced_path.name}...")
            reduced_embeddings = np.load(reduced_path)
        else:
            from sklearn.decomposition import PCA

            print(
                f"\nReducing {embeddings.shape[1]}d -> {args.reduce_dims}d via PCA..."
            )
            reduced_embeddings = PCA(
                n_components=args.reduce_dims, random_state=SEED
            ).fit_transform(embeddings)
            np.save(reduced_path, reduced_embeddings)
            print(f"  Saved to {reduced_path.name}")
        print(f"  {reduced_embeddings.shape}")

    # Step 4: Run grouping strategies
    strategies: list[GroupingStrategy] = [
        SimilarityGraphGrouping(threshold=args.sim_threshold),
        LouvainGrouping(threshold=args.sim_threshold),
        KMeansGrouping(n_clusters=args.n_clusters),
    ]

    if args.hdbscan:
        strategies.insert(0, HDBSCANGrouping(min_cluster_size=args.hdbscan_min_size))

    results: list[GroupingResult] = []
    for strategy in strategies:
        print(f"\nRunning {strategy.name}...")
        start = time.time()
        result = strategy.fit(tokens, embeddings, token_counts, reduced_embeddings)
        elapsed = time.time() - start
        print(
            f"  {result.n_clusters:,} clusters, {result.n_noise:,} noise, {elapsed:.1f}s"
        )
        results.append(result)

    # Step 4: Compare
    print_comparison(results, token_counts)

    for result in results:
        print_sample_clusters(result, tokens, token_counts)

    # Step 5: Save all mappings
    output_directory = workspace.encoder_dir(encoder) / "vocab_compression"
    output_directory.mkdir(parents=True, exist_ok=True)

    for result in results:
        mapping_path = output_directory / f"{result.name}.json"
        with open(mapping_path, "w") as f:
            json.dump(result.mapping, f)
        print(f"\nSaved {result.name} mapping to {mapping_path}")

    # Save token counts for downstream use
    counts_path = output_directory / "token_counts.json"
    with open(counts_path, "w") as f:
        json.dump(token_counts, f)
    print(f"Saved token counts to {counts_path}")


if __name__ == "__main__":
    main()
