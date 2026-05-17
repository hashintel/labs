"""Training loop for SlugMLP.

Trains the shared backbone + token head + length head, and optionally
the position head (variant 1b). Validates every N steps (not per-epoch)
for fast feedback on large datasets. Saves checkpoints, vocab, manifest,
and optionally the pairwise ordering table to the model directory.

Usage:
    uv run slug-train-mlp --workspace url --encoder openai --compression kmeans-5000
    uv run slug-train-mlp --workspace url --encoder openai --compression kmeans-5000 --position-head
"""

import argparse
import json
import time
from dataclasses import dataclass
from pathlib import Path

import torch
from torch import nn
from torch.utils.data import DataLoader

from slug_from_embedding.config import ENCODERS, SEED, Encoder
from slug_from_embedding.libs.workspace import Workspace

from ..config import SCHEMA_VERSION, resolve_device, seed_all
from ..trainer import Trainer as BaseTrainer
from .config import MLPConfig
from .dataset import SlugDataset
from .model import MIN_SLUG_LENGTH, NUM_LENGTH_CLASSES, BinaryFocalLoss, SlugMLP
from .predict import build_pairwise_table
from .vocab import SlugVocab


@dataclass
class TrainHyperparams:
    """Training loop hyperparameters (shared across variants)."""

    lr: float = 1e-3
    weight_decay: float = 1e-4
    epochs: int = 5
    batch_size: int = 1024
    patience: int = 10
    eval_every: int = 2000
    val_max_samples: int = 5000
    seed: int = SEED


class Trainer(BaseTrainer):
    """Manages the full MLP training lifecycle: data, model, loop, checkpointing."""

    def __init__(
        self,
        workspace: Workspace,
        encoder: Encoder,
        device: str,
        overwrite: bool = False,
        *,
        model_config: MLPConfig = MLPConfig(),
        hyperparams: TrainHyperparams = TrainHyperparams(),
        compression: str | None = None,
    ):
        self.workspace = workspace
        self.encoder = encoder
        self.model_config = model_config
        self.hyperparams = hyperparams
        self.device = device
        self.encoder_config = ENCODERS[encoder]
        self.compression = compression

        tag = f"mlp_{encoder}"
        if model_config.position_head:
            tag += "_pos"
        self.tag = tag

        variant_name = "mlp_pos" if model_config.position_head else "mlp"
        self.output_dir = workspace.models_dir(encoder, variant_name)

        if (
            self.output_dir.exists()
            and (self.output_dir / "best.pt").exists()
            and not overwrite
        ):
            raise FileExistsError(
                f"Model directory {self.output_dir} already contains a checkpoint. "
                f"Pass --overwrite to replace it."
            )
        self.output_dir.mkdir(parents=True, exist_ok=True)

    def run(self) -> Path:
        seed_all(self.hyperparams.seed)

        vocab = self._build_vocab()
        train_loader, val_loader, train_size, val_size = self._build_loaders(vocab)
        model, parameter_count = self._build_model(vocab)
        optimizer, scheduler = self._build_optimizer(model)
        loss_functions = self._build_loss_functions()

        print(f"\nTraining {self.tag} on {self.device}...")
        print(
            f"  eval every {self.hyperparams.eval_every} steps, "
            f"patience {self.hyperparams.patience} evals"
        )

        best_val_loss = float("inf")
        best_step = 0
        global_step = 0
        stale = 0
        stopped_early = False

        running_loss = 0.0
        running_count = 0

        for epoch in range(1, self.hyperparams.epochs + 1):
            model.train()
            epoch_start = time.time()

            for batch in train_loader:
                embedding = batch["embedding"].to(self.device)
                output = model(embedding)
                loss = self._compute_loss(output, batch, loss_functions)

                optimizer.zero_grad()
                loss.backward()
                optimizer.step()

                running_loss += loss.item() * len(embedding)
                running_count += len(embedding)
                global_step += 1

                if global_step % self.hyperparams.eval_every == 0:
                    train_avg = running_loss / running_count
                    val_loss = self._val_epoch(
                        model, val_loader, loss_functions, val_size
                    )
                    scheduler.step(val_loss)

                    current_lr = optimizer.param_groups[0]["lr"]
                    print(
                        f"  step {global_step:6d}  "
                        f"train={train_avg:.4f}  val={val_loss:.4f}  "
                        f"lr={current_lr:.1e}"
                    )

                    running_loss = 0.0
                    running_count = 0

                    if val_loss < best_val_loss:
                        best_val_loss = val_loss
                        best_step = global_step
                        stale = 0
                        torch.save(model.state_dict(), self.output_dir / "best.pt")
                    else:
                        stale += 1
                        if stale >= self.hyperparams.patience:
                            print(
                                f"  Early stopping at step {global_step} "
                                f"(patience={self.hyperparams.patience} evals)"
                            )
                            stopped_early = True
                            break

                    model.train()

            elapsed = time.time() - epoch_start
            print(f"  epoch {epoch} done ({elapsed:.0f}s, step {global_step})")

            if stopped_early:
                break

        # Final eval if we haven't just done one
        if running_count > 0:
            val_loss = self._val_epoch(model, val_loader, loss_functions, val_size)
            print(f"  final  step {global_step:6d}  val={val_loss:.4f}")
            if val_loss < best_val_loss:
                best_val_loss = val_loss
                best_step = global_step
                torch.save(model.state_dict(), self.output_dir / "best.pt")

        print("\nBuilding pairwise ordering table...")
        pairwise_table = build_pairwise_table(self.workspace, vocab, self.encoder)
        (self.output_dir / "pairwise.json").write_text(
            json.dumps({f"{a},{b}": v for (a, b), v in pairwise_table.items()})
        )
        print(f"  {len(pairwise_table)} pairs")

        self._save_manifest(
            vocab, parameter_count, best_val_loss, best_step, global_step
        )
        print(f"\nSaved to {self.output_dir}/")
        print(f"  best val loss: {best_val_loss:.4f} (step {best_step})")
        return self.output_dir

    def _build_vocab(self) -> SlugVocab:
        if self.compression:
            print(
                f"Building compressed vocab from {self.compression} ({self.encoder})..."
            )
            vocab = SlugVocab.from_compressed(
                self.workspace, self.encoder, self.compression
            )
        else:
            print(f"Building vocab from {self.encoder} training split...")
            vocab = SlugVocab.from_training(self.workspace, self.encoder)

        vocab.save(self.output_dir / "vocab.json")
        print(f"  {len(vocab)} tokens")
        return vocab

    def _build_loaders(
        self, vocab: SlugVocab
    ) -> tuple[DataLoader, DataLoader, int, int]:
        print("Materializing splits...")
        self.workspace.materialize_split(self.encoder, "train")
        self.workspace.materialize_split(self.encoder, "val")

        print("Loading data...")
        train_dataset = SlugDataset(self.workspace, self.encoder, "train", vocab)
        val_dataset = SlugDataset(
            self.workspace,
            self.encoder,
            "val",
            vocab,
            max_samples=self.hyperparams.val_max_samples,
            seed=self.hyperparams.seed,
        )
        print(f"  train: {len(train_dataset)}, val: {len(val_dataset)}")

        generator = torch.Generator()
        generator.manual_seed(self.hyperparams.seed)

        train_loader = DataLoader(
            train_dataset,
            batch_size=self.hyperparams.batch_size,
            shuffle=True,
            generator=generator,
        )
        val_loader = DataLoader(
            val_dataset,
            batch_size=self.hyperparams.batch_size,
            shuffle=False,
        )
        return train_loader, val_loader, len(train_dataset), len(val_dataset)

    def _build_model(self, vocab: SlugVocab) -> tuple[SlugMLP, int]:
        model = SlugMLP(
            input_dim=self.encoder_config.dim,
            vocab_size=len(vocab),
            hidden_dim=self.model_config.hidden_dim,
            num_layers=self.model_config.num_layers,
            dropout=self.model_config.dropout,
            position_head=self.model_config.position_head,
        ).to(self.device)

        parameter_count = sum(p.numel() for p in model.parameters())
        print(
            f"  {parameter_count:,} parameters "
            f"(position_head={self.model_config.position_head})"
        )
        return model, parameter_count

    def _build_optimizer(self, model: SlugMLP):
        optimizer = torch.optim.AdamW(
            model.parameters(),
            lr=self.hyperparams.lr,
            weight_decay=self.hyperparams.weight_decay,
        )
        scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
            optimizer,
            mode="min",
            factor=0.5,
            patience=self.hyperparams.patience // 2,
        )
        return optimizer, scheduler

    def _build_loss_functions(self) -> dict[str, nn.Module]:
        if self.model_config.token_loss == "focal":
            token_loss = BinaryFocalLoss(gamma=self.model_config.focal_gamma)
        else:
            token_loss = nn.BCEWithLogitsLoss()

        functions: dict[str, nn.Module] = {
            "token": token_loss,
            "length": nn.CrossEntropyLoss(),
        }
        if self.model_config.position_head:
            functions["position"] = nn.CrossEntropyLoss(ignore_index=-1)
        return functions

    def _compute_loss(
        self, output: dict, batch: dict, loss_functions: dict
    ) -> torch.Tensor:
        token_target = batch["token_targets"].to(self.device)
        length_target = (
            (batch["length"] - MIN_SLUG_LENGTH)
            .clamp(0, NUM_LENGTH_CLASSES - 1)
            .to(self.device)
        )

        loss = loss_functions["token"](output["token_logits"], token_target)
        loss = loss + loss_functions["length"](output["length_logits"], length_target)

        if self.model_config.position_head:
            position_logits = output["position_logits"]
            position_target = batch["token_positions"].to(self.device)
            batch_size, vocab_size, max_length = position_logits.shape
            loss = loss + loss_functions["position"](
                position_logits.reshape(batch_size * vocab_size, max_length),
                position_target.reshape(batch_size * vocab_size),
            )

        return loss

    def _val_epoch(self, model, loader, loss_functions, dataset_size) -> float:
        model.eval()
        total_loss = 0.0
        with torch.no_grad():
            for batch in loader:
                embedding = batch["embedding"].to(self.device)
                output = model(embedding)
                loss = self._compute_loss(output, batch, loss_functions)
                total_loss += loss.item() * len(embedding)

        return total_loss / dataset_size

    def _save_manifest(
        self,
        vocab: SlugVocab,
        parameter_count: int,
        best_val_loss: float,
        best_step: int,
        total_steps: int,
    ):
        manifest = {
            "schema_version": SCHEMA_VERSION,
            "variant": "mlp",
            "encoder": self.encoder,
            "seed": self.hyperparams.seed,
            "compression": self.compression,
            "model": {
                "input_dim": self.encoder_config.dim,
                "vocab_size": len(vocab),
                "hidden_dim": self.model_config.hidden_dim,
                "num_layers": self.model_config.num_layers,
                "dropout": self.model_config.dropout,
                "position_head": self.model_config.position_head,
                "token_loss": self.model_config.token_loss,
                "focal_gamma": self.model_config.focal_gamma,
            },
            "training": {
                "lr": self.hyperparams.lr,
                "weight_decay": self.hyperparams.weight_decay,
                "batch_size": self.hyperparams.batch_size,
                "patience": self.hyperparams.patience,
                "epochs": self.hyperparams.epochs,
                "eval_every": self.hyperparams.eval_every,
                "val_max_samples": self.hyperparams.val_max_samples,
            },
            "results": {
                "best_val_loss": best_val_loss,
                "best_step": best_step,
                "total_steps": total_steps,
                "n_params": parameter_count,
            },
            "artifacts": ["best.pt", "vocab.json", "pairwise.json"],
        }
        (self.output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))


def main():
    parser = argparse.ArgumentParser(description="Train SlugMLP")
    parser.add_argument("--workspace", default="original")
    parser.add_argument("--encoder", choices=list(ENCODERS), required=True)
    parser.add_argument(
        "--compression",
        type=str,
        default=None,
        help="Compression mapping name (e.g. kmeans-5000)",
    )
    parser.add_argument("--hidden-dim", type=int, default=768)
    parser.add_argument("--num-layers", type=int, default=2)
    parser.add_argument("--dropout", type=float, default=0.2)
    parser.add_argument(
        "--position-head",
        action="store_true",
        help="Enable position head (variant 1b)",
    )
    parser.add_argument(
        "--token-loss",
        choices=["bce", "focal"],
        default="bce",
        help="Loss function for token head",
    )
    parser.add_argument(
        "--focal-gamma",
        type=float,
        default=2.0,
        help="Focal loss gamma (only used with --token-loss focal)",
    )
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--epochs", type=int, default=5)
    parser.add_argument("--batch-size", type=int, default=1024)
    parser.add_argument("--patience", type=int, default=10)
    parser.add_argument("--eval-every", type=int, default=2000)
    parser.add_argument("--val-max-samples", type=int, default=5000)
    parser.add_argument("--seed", type=int, default=SEED)
    parser.add_argument("--device", type=str, default=None)
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Overwrite existing checkpoint",
    )
    args = parser.parse_args()

    workspace = Workspace(args.workspace)

    trainer = Trainer(
        workspace=workspace,
        encoder=args.encoder,
        model_config=MLPConfig(
            hidden_dim=args.hidden_dim,
            num_layers=args.num_layers,
            dropout=args.dropout,
            position_head=args.position_head,
            token_loss=args.token_loss,
            focal_gamma=args.focal_gamma,
        ),
        hyperparams=TrainHyperparams(
            lr=args.lr,
            epochs=args.epochs,
            batch_size=args.batch_size,
            patience=args.patience,
            eval_every=args.eval_every,
            val_max_samples=args.val_max_samples,
            seed=args.seed,
        ),
        device=resolve_device(args.device),
        overwrite=args.overwrite,
        compression=args.compression,
    )
    trainer.run()
