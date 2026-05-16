"""Training loop for SlugMLP.

Trains the shared backbone + token head + length head, and optionally
the position head (variant 1b). Saves checkpoints, vocab, manifest,
and optionally the pairwise ordering table to the model directory.

Usage:
    uv run slug-train-mlp --encoder openai
    uv run slug-train-mlp --encoder openai --position-head
"""

import argparse
import json
import time
from dataclasses import dataclass
from pathlib import Path

import torch
from torch import nn
from torch.utils.data import DataLoader

from slug_from_embedding.config import ENCODERS, Encoder, SEED

from ..config import MODELS_DIR, SCHEMA_VERSION, resolve_device, seed_all, Split
from ..trainer import Trainer as BaseTrainer
from .config import MLPConfig
from .dataset import SlugDataset
from .model import MIN_SLUG_LENGTH, NUM_LENGTH_CLASSES, SlugMLP
from .predict import build_pairwise_table
from .vocab import SlugVocab


@dataclass
class TrainHyperparams:
    """Training loop hyperparameters (shared across variants)."""

    lr: float = 1e-3
    weight_decay: float = 1e-4
    epochs: int = 100
    batch_size: int = 256
    patience: int = 10
    seed: int = SEED


class Trainer(BaseTrainer):
    """Manages the full MLP training lifecycle: data, model, loop, checkpointing."""

    def __init__(
        self,
        encoder: Encoder,
        device: str,
        overwrite: bool = False,
        *,
        model_config: MLPConfig = MLPConfig(),
        hyperparams: TrainHyperparams = TrainHyperparams(),
    ):
        self.encoder = encoder
        self.model_config = model_config
        self.hyperparams = hyperparams
        self.device = device
        self.encoder_cfg = ENCODERS[encoder]

        tag = f"mlp_{encoder}"
        if model_config.position_head:
            tag += "_pos"
        self.tag = tag
        self.out_dir = MODELS_DIR / tag

        if self.out_dir.exists() and (self.out_dir / "best.pt").exists() and not overwrite:
            raise FileExistsError(
                f"Model directory {self.out_dir} already contains a checkpoint. "
                f"Pass --overwrite to replace it."
            )
        self.out_dir.mkdir(parents=True, exist_ok=True)

    def run(self) -> Path:
        seed_all(self.hyperparams.seed)

        vocab = self._build_vocab()
        train_loader, val_loader, train_size, val_size = self._build_loaders(vocab)
        model, n_params = self._build_model(vocab)
        optimizer, scheduler = self._build_optimizer(model)
        loss_fns = self._build_loss_fns()

        print(f"\nTraining {self.tag} on {self.device}...")
        best_val_loss = float("inf")
        best_epoch = 0
        stale = 0
        final_epoch = 0

        for epoch in range(1, self.hyperparams.epochs + 1):
            final_epoch = epoch
            t0 = time.time()

            train_loss = self._train_epoch(model, train_loader, optimizer, loss_fns, train_size)
            val_loss = self._val_epoch(model, val_loader, loss_fns, val_size)
            scheduler.step(val_loss)

            lr_now = optimizer.param_groups[0]["lr"]
            dt = time.time() - t0
            print(
                f"  epoch {epoch:3d}  "
                f"train={train_loss:.4f}  val={val_loss:.4f}  "
                f"lr={lr_now:.1e}  {dt:.1f}s"
            )

            if val_loss < best_val_loss:
                best_val_loss = val_loss
                best_epoch = epoch
                stale = 0
                torch.save(model.state_dict(), self.out_dir / "best.pt")
            else:
                stale += 1
                if stale >= self.hyperparams.patience:
                    print(f"  Early stopping at epoch {epoch} (patience={self.hyperparams.patience})")
                    break

        # Save pairwise table as artifact (useful for variant 1c at predict time)
        print("Building pairwise ordering table...")
        pairwise_table = build_pairwise_table(vocab, self.encoder)
        (self.out_dir / "pairwise.json").write_text(json.dumps(
            {f"{a},{b}": v for (a, b), v in pairwise_table.items()}
        ))
        print(f"  {len(pairwise_table)} pairs")

        self._save_manifest(vocab, n_params, best_val_loss, best_epoch, final_epoch)
        print(f"\nSaved to {self.out_dir}/")
        print(f"  best val loss: {best_val_loss:.4f} (epoch {best_epoch})")
        return self.out_dir

    # ── Setup ──────────────────────────────────────────────────────────────

    def _build_vocab(self) -> SlugVocab:
        print(f"Building vocab from {self.encoder} training split...")
        vocab = SlugVocab.from_training(self.encoder)
        vocab.save(self.out_dir / "vocab.json")
        print(f"  {len(vocab)} tokens")
        return vocab

    def _build_loaders(self, vocab: SlugVocab) -> tuple[DataLoader, DataLoader, int, int]:
        print("Loading data...")
        train_ds = SlugDataset(self.encoder, "train", vocab)
        val_ds = SlugDataset(self.encoder, "val", vocab)
        print(f"  train: {len(train_ds)}, val: {len(val_ds)}")

        g = torch.Generator()
        g.manual_seed(self.hyperparams.seed)

        train_loader = DataLoader(
            train_ds, batch_size=self.hyperparams.batch_size, shuffle=True, generator=g,
        )
        val_loader = DataLoader(
            val_ds, batch_size=self.hyperparams.batch_size, shuffle=False,
        )
        return train_loader, val_loader, len(train_ds), len(val_ds)

    def _build_model(self, vocab: SlugVocab) -> tuple[SlugMLP, int]:
        model = SlugMLP(
            input_dim=self.encoder_cfg.dim,
            vocab_size=len(vocab),
            hidden_dim=self.model_config.hidden_dim,
            dropout=self.model_config.dropout,
            position_head=self.model_config.position_head,
        ).to(self.device)

        n_params = sum(p.numel() for p in model.parameters())
        print(f"  {n_params:,} parameters (position_head={self.model_config.position_head})")
        return model, n_params

    def _build_optimizer(self, model: SlugMLP):
        optimizer = torch.optim.AdamW(
            model.parameters(),
            lr=self.hyperparams.lr,
            weight_decay=self.hyperparams.weight_decay,
        )
        scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
            optimizer, mode="min", factor=0.5, patience=self.hyperparams.patience // 2,
        )
        return optimizer, scheduler

    def _build_loss_fns(self) -> dict[str, nn.Module]:
        fns: dict[str, nn.Module] = {
            "token": nn.BCEWithLogitsLoss(),
            "length": nn.CrossEntropyLoss(),
        }
        if self.model_config.position_head:
            fns["position"] = nn.CrossEntropyLoss(ignore_index=-1)
        return fns

    # ── Epoch loops ────────────────────────────────────────────────────────

    def _compute_loss(self, out: dict, batch: dict, loss_fns: dict) -> torch.Tensor:
        token_tgt = batch["token_targets"].to(self.device)
        length_tgt = (batch["length"] - MIN_SLUG_LENGTH).clamp(0, NUM_LENGTH_CLASSES - 1).to(self.device)

        loss = loss_fns["token"](out["token_logits"], token_tgt)
        loss = loss + loss_fns["length"](out["length_logits"], length_tgt)

        if self.model_config.position_head:
            pos_logits = out["position_logits"]
            pos_tgt = batch["token_positions"].to(self.device)
            b, v, m = pos_logits.shape
            loss = loss + loss_fns["position"](
                pos_logits.reshape(b * v, m),
                pos_tgt.reshape(b * v),
            )

        return loss

    def _train_epoch(self, model, loader, optimizer, loss_fns, dataset_size) -> float:
        model.train()
        total_loss = 0.0
        for batch in loader:
            emb = batch["embedding"].to(self.device)
            out = model(emb)
            loss = self._compute_loss(out, batch, loss_fns)

            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
            total_loss += loss.item() * len(emb)

        return total_loss / dataset_size

    def _val_epoch(self, model, loader, loss_fns, dataset_size) -> float:
        model.eval()
        total_loss = 0.0
        with torch.no_grad():
            for batch in loader:
                emb = batch["embedding"].to(self.device)
                out = model(emb)
                loss = self._compute_loss(out, batch, loss_fns)
                total_loss += loss.item() * len(emb)

        return total_loss / dataset_size

    # ── Persistence ────────────────────────────────────────────────────────

    def _save_manifest(self, vocab: SlugVocab, n_params: int, best_val_loss: float, best_epoch: int, epochs_trained: int):
        manifest = {
            "schema_version": SCHEMA_VERSION,
            "variant": "mlp",
            "encoder": self.encoder,
            "seed": self.hyperparams.seed,
            "model": {
                "input_dim": self.encoder_cfg.dim,
                "vocab_size": len(vocab),
                "hidden_dim": self.model_config.hidden_dim,
                "dropout": self.model_config.dropout,
                "position_head": self.model_config.position_head,
            },
            "training": {
                "lr": self.hyperparams.lr,
                "weight_decay": self.hyperparams.weight_decay,
                "batch_size": self.hyperparams.batch_size,
                "patience": self.hyperparams.patience,
                "epochs": self.hyperparams.epochs,
            },
            "results": {
                "best_val_loss": best_val_loss,
                "best_epoch": best_epoch,
                "epochs_trained": epochs_trained,
                "n_params": n_params,
            },
            "artifacts": ["best.pt", "vocab.json", "pairwise.json"],
        }
        (self.out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))


def main():
    parser = argparse.ArgumentParser(description="Train SlugMLP")
    parser.add_argument("--encoder", choices=list(ENCODERS), required=True)
    parser.add_argument("--hidden-dim", type=int, default=768)
    parser.add_argument("--dropout", type=float, default=0.2)
    parser.add_argument("--position-head", action="store_true", help="Enable position head (variant 1b)")
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--epochs", type=int, default=100)
    parser.add_argument("--batch-size", type=int, default=256)
    parser.add_argument("--patience", type=int, default=10)
    parser.add_argument("--seed", type=int, default=SEED)
    parser.add_argument("--device", type=str, default=None)
    parser.add_argument("--overwrite", action="store_true", help="Overwrite existing checkpoint")
    args = parser.parse_args()

    trainer = Trainer(
        encoder=args.encoder,
        model_config=MLPConfig(
            hidden_dim=args.hidden_dim,
            dropout=args.dropout,
            position_head=args.position_head,
        ),
        hyperparams=TrainHyperparams(
            lr=args.lr,
            epochs=args.epochs,
            batch_size=args.batch_size,
            patience=args.patience,
            seed=args.seed,
        ),
        device=resolve_device(args.device),
        overwrite=args.overwrite,
    )
    trainer.run()
