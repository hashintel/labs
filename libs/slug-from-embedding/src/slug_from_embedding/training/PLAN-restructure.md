# Training Package Restructure

## Problem

The training package has structural issues that make adding new variants
(seq2seq, projector) require non-local edits and create correctness risks:

- Device resolution duplicated in predict_cli.py and TrainConfig
- Path constants (MODELS_DIR, PREDICTIONS_DIR) scattered across files
- Three nearly-identical MLP Predictor classes
- Prediction parquet writing duplicated in predict_cli, baselines, io
- vocab.py in shared training/ but it's MLP-specific (no special tokens, silent OOV)
- Pairwise table recomputed from ambient corpus state instead of saved as artifact
- No encoder validation at prediction time (can evaluate wrong embedding space)
- No seed in training (not reproducible)
- Silent zip truncation bug in predict_cli (wrong batch size eaten silently)
- Misleading docstrings claiming pairwise is a learned head
- `from __future__ import annotations` still present in evaluation/__init__.py, io.py
- No variant discrimination in saved artifacts
- Training artifacts not uniquely identified, can be silently overwritten
- Stringly typed throughout (splits, variants, orderings all raw strings)
- SQL queries lack ORDER BY (non-deterministic row order)
- Data access patterns duplicated across training, evaluation, baselines
- MLP target encoding silently inconsistent for OOV tokens (length counts them, targets don't)
- `io.batched()` duplicates `itertools.batched` (Python 3.13)

## Target Structure

```
config.py                 # Project-wide: paths, encoders, env, API clients (exists)

training/
  config.py               # NEW: types, runtime, paths, artifact helpers
  data.py                 # EXPAND: canonical data access layer
  predictor.py            # KEEP: Predictor ABC
  predict_cli.py          # SIMPLIFY: thin CLI using shared infra
  registry.py             # NEW: variant registry (name -> trainer, predictor loader)
  mlp/
    __init__.py
    config.py             # NEW: MLPConfig dataclass
    vocab.py              # MOVE from training/ (MLP-specific)
    model.py              # KEEP (fix docstrings)
    dataset.py            # KEEP (imports vocab locally, validate OOV invariant)
    train.py              # SIMPLIFY: use shared config, save full manifest
    predict.py            # REWRITE: one MLPPredictor + ordering functions

evaluation/
  __init__.py             # FIX: remove __future__
  data.py                 # SIMPLIFY: use shared data access where possible

io.py                     # CLEAN: remove __future__, remove batched(), audit write_id_column
baselines.py              # SIMPLIFY: use shared write_predictions
```

## Design Decisions

### 1. training/config.py: shared types, runtime, paths, artifacts

```python
from pathlib import Path
from typing import Literal

import torch
import numpy as np

from slug_from_embedding.config import DATA_DIR

type Split = Literal["train", "val", "test"]

MODELS_DIR = DATA_DIR / "models"
PREDICTIONS_DIR = DATA_DIR / "predictions"

SCHEMA_VERSION = 1


def resolve_device(device: str | None = None) -> str:
    if device:
        return device
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def seed_all(seed: int):
    torch.manual_seed(seed)
    np.random.seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def write_predictions(ids: list[str], slugs: list[str], out_path: Path):
    """Write (id, predicted_slug) parquet. Used by all prediction paths."""
    assert len(ids) == len(slugs), f"ID/slug count mismatch: {len(ids)} vs {len(slugs)}"
    import duckdb
    out_path.parent.mkdir(parents=True, exist_ok=True)
    conn = duckdb.connect()
    conn.execute("CREATE TABLE preds (id VARCHAR, predicted_slug VARCHAR)")
    conn.executemany("INSERT INTO preds VALUES (?, ?)", list(zip(ids, slugs)))
    conn.execute(f"COPY preds TO '{out_path}' (FORMAT PARQUET, COMPRESSION ZSTD)")
    conn.close()
```

### 2. training/data.py: canonical data access layer

Expand to cover the repeated query patterns across training, evaluation,
baselines. All DuckDB queries that touch corpus/splits/embeddings go here.

```python
type Split = ...  # imported from config

def load_split(encoder, split) -> RawSplit:          # exists
def load_embeddings(encoder, split) -> (ids, embs):  # from predict_cli
def load_training_slugs(encoder) -> list[str]:        # from baselines
def load_texts(encoder, split) -> list[(id, text)]:   # from baselines
```

All queries include ORDER BY id for deterministic results.

### 3. training/registry.py: variant registry

Avoids scattered match statements. Each variant registers itself.

```python
_TRAINERS: dict[str, type] = {}
_PREDICTOR_LOADERS: dict[str, Callable] = {}

def register_trainer(name: str, cls: type): ...
def register_predictor_loader(name: str, fn: Callable): ...
def get_trainer(name: str) -> type: ...
def get_predictor_loader(name: str) -> Callable: ...
```

MLP registers in mlp/__init__.py. When seq2seq arrives, it registers in
seq2seq/__init__.py. The CLI never needs to know about specific variants.

### 4. mlp/config.py: variant-specific config

```python
@dataclass(frozen=True)
class MLPConfig:
    hidden_dim: int = 768
    dropout: float = 0.2
    position_head: bool = False
```

Separate from training hyperparams (lr, epochs, patience, batch_size) which
are shared concerns. The manifest combines both.

### 5. Model manifest (replaces ad-hoc config.json)

Every saved model gets a manifest that is:
- Self-describing (includes variant, schema version)
- Complete (full training config, not just architecture)
- Sufficient to reproduce (seed, optimizer, scheduler)
- Validates on load (encoder, variant, schema version)

```json
{
  "schema_version": 1,
  "variant": "mlp",
  "encoder": "openai",
  "seed": 42,

  "model": {
    "input_dim": 1536,
    "vocab_size": 12571,
    "hidden_dim": 768,
    "dropout": 0.2,
    "position_head": false
  },

  "training": {
    "lr": 0.001,
    "weight_decay": 0.0001,
    "batch_size": 256,
    "patience": 10,
    "epochs": 100
  },

  "results": {
    "best_val_loss": 0.1234,
    "best_epoch": 42,
    "epochs_trained": 52,
    "n_params": 12345678
  },

  "artifacts": ["best.pt", "vocab.json", "pairwise.json"]
}
```

On load, validate:
- schema_version matches
- encoder matches CLI encoder
- variant matches expected variant
- all listed artifacts exist

### 6. Single MLPPredictor with ordering parameter

Instead of three classes with duplicated predict() bodies:

```python
type OrderingFn = Callable[[list[int], MLPOutput], list[int]]

class MLPPredictor(Predictor):
    def __init__(self, model_dir: Path, ordering_fn: OrderingFn, device: str):
        ...load model, validate manifest...

    def predict(self, embeddings: np.ndarray) -> list[str]:
        out = self._forward(embeddings)
        slugs = []
        for j in range(len(embeddings)):
            top_k = self._select_top_k(out, j)
            ordered = self.ordering_fn(top_k, out[j])
            slugs.append(self.vocab.decode_indices(ordered))
        return slugs
```

Ordering functions:
- `order_by_score`: sorts by sigmoid score (free)
- `order_by_position`: sorts by position head argmax (requires position_head=True)
- `make_pairwise_ordering(table)`: returns a closure over the saved pairwise table

### 7. Pairwise table as saved artifact

Build during training (or a dedicated build step) and save to model dir as
`pairwise.json`. Load from model dir at prediction time. The artifact is
closed: prediction depends only on the model directory + input embeddings.

### 8. vocab.py moves to mlp/

It has no special tokens (BOS/EOS/PAD/UNK), silently skips OOV, and joins
with `-`. That's bag-of-words specific. When seq2seq needs a vocab it'll
need different tokenization, special tokens, and OOV policy.

### 9. Artifact naming and overwrite protection

Model directories include enough to be unique:

```
data/models/mlp_openai/          # base
data/models/mlp_openai_pos/      # with position head
```

On training start:
- If dir exists and contains best.pt, refuse unless --overwrite is passed
- Print warning with existing manifest summary

### 10. OOV invariant validation

In SlugDataset.__init__, validate that every training slug is fully
representable in the vocabulary. If any token is OOV, that's a bug
(vocab was built from the same data). For val/test, log OOV rate but
don't fail.

### 11. Remove Python 3.12 compat cruft

- Remove all `from __future__ import annotations`
- Replace `io.batched()` with `itertools.batched`

## Checklist

### Shared infrastructure
- [ ] Create training/config.py (Split, paths, resolve_device, seed_all, write_predictions)
- [ ] Expand training/data.py (load_embeddings, load_training_slugs, load_texts, ORDER BY)
- [ ] Create training/registry.py (variant registry)
- [ ] Simplify predict_cli.py (thin CLI, uses registry + shared infra)
- [ ] Update baselines.py to use shared write_predictions and data access

### MLP variant
- [ ] Create mlp/config.py (MLPConfig dataclass)
- [ ] Move vocab.py to mlp/vocab.py, update imports
- [ ] Rewrite mlp/predict.py: one MLPPredictor + ordering functions
- [ ] Save pairwise table to model dir during training
- [ ] Expand saved manifest (schema version, full config, artifacts list)
- [ ] Add encoder/variant validation on model load
- [ ] Add seed to training loop
- [ ] Add OOV invariant validation in dataset
- [ ] Add overwrite protection for model dirs
- [ ] Fix misleading pairwise docstrings in model.py
- [ ] Register MLP trainer and predictor loader in registry

### Cleanup
- [ ] Remove `from __future__ import annotations` from evaluation/__init__.py, io.py
- [ ] Replace io.batched() with itertools.batched
- [ ] Audit io.write_id_column usage, remove if dead
- [ ] Add ORDER BY id to all training/evaluation SQL queries
- [ ] Verify all imports resolve
- [ ] Run slug-eval on existing haiku baseline to confirm nothing broke
