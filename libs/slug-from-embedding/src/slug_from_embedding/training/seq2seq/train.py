"""Training loop for the seq2seq slug decoder.

Prefix-conditioned transformer decoder trained with teacher forcing.
Cross-entropy loss per token position, ignoring PAD. Validates every
N steps with sub-epoch checkpointing.

Usage:
    uv run slug-train-seq2seq --workspace url --encoder openai --compression kmeans-5000
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
from .config import Seq2SeqConfig
from .dataset import SeqDataset
from .bpe_vocab import BpeVocab
from .model import SlugDecoder
from .vocab import SeqVocab

# Union type for both vocab kinds
type Vocab = SeqVocab | BpeVocab


@dataclass
class TrainHyperparams:
    lr: float = 3e-4
    weight_decay: float = 1e-4
    epochs: int = 15
    batch_size: int = 1024
    patience: int = 10
    eval_every: int = 2000
    val_max_samples: int = 5000
    seed: int = SEED


class Trainer(BaseTrainer):
    """Manages the seq2seq training lifecycle."""

    def __init__(
        self,
        workspace: Workspace,
        encoder: Encoder,
        device: str,
        overwrite: bool = False,
        *,
        model_config: Seq2SeqConfig = Seq2SeqConfig(),
        hyperparams: TrainHyperparams = TrainHyperparams(),
        compression: str | None = None,
        tokenizer: str | None = None,
        tag: str | None = None,
    ):
        self.workspace = workspace
        self.encoder = encoder
        self.model_config = model_config
        self.hyperparams = hyperparams
        self.device = device
        self.encoder_config = ENCODERS[encoder]
        self.compression = compression
        self.tokenizer = tokenizer

        variant_name = f"seq2seq_{tag}" if tag else "seq2seq"
        self.tag = f"{variant_name}_{encoder}"
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
        self._vocab = vocab
        loss_fn = nn.CrossEntropyLoss(ignore_index=vocab.pad_idx)

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
                input_ids = batch["input_ids"].to(self.device)
                target_ids = batch["target_ids"].to(self.device)

                logits = model(embedding, input_ids)
                # logits: [B, T, V], target_ids: [B, T]
                loss = loss_fn(
                    logits.reshape(-1, logits.size(-1)),
                    target_ids.reshape(-1),
                )

                optimizer.zero_grad()
                loss.backward()
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                optimizer.step()

                running_loss += loss.item() * len(embedding)
                running_count += len(embedding)
                global_step += 1

                if global_step % self.hyperparams.eval_every == 0:
                    train_avg = running_loss / running_count
                    val_loss = self._val_step(
                        model, val_loader, loss_fn, val_size
                    )
                    tok_f1 = self._greedy_token_f1(
                        model, val_loader, vocab
                    )
                    scheduler.step(val_loss)

                    current_lr = optimizer.param_groups[0]["lr"]
                    print(
                        f"  step {global_step:6d}  "
                        f"train={train_avg:.4f}  val={val_loss:.4f}  "
                        f"tok_f1={tok_f1:.3f}  lr={current_lr:.1e}"
                    )

                    running_loss = 0.0
                    running_count = 0

                    if val_loss < best_val_loss:
                        best_val_loss = val_loss
                        best_step = global_step
                        stale = 0
                        torch.save(
                            model.state_dict(), self.output_dir / "best.pt"
                        )
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
            val_loss = self._val_step(model, val_loader, loss_fn, val_size)
            print(f"  final  step {global_step:6d}  val={val_loss:.4f}")
            if val_loss < best_val_loss:
                best_val_loss = val_loss
                best_step = global_step
                torch.save(model.state_dict(), self.output_dir / "best.pt")

        self._save_manifest(
            vocab, parameter_count, best_val_loss, best_step, global_step
        )
        print(f"\nSaved to {self.output_dir}/")
        print(f"  best val loss: {best_val_loss:.4f} (step {best_step})")
        return self.output_dir

    def _build_vocab(self) -> Vocab:
        if self.tokenizer == "bpe":
            vocab_path = self.output_dir / "tokenizer.json"
            print(f"Training BPE tokenizer ({self.encoder})...")
            vocab = BpeVocab.train(self.workspace, self.encoder)
            vocab.save(vocab_path)
            print(f"  Saved to {vocab_path}")
        elif self.compression:
            print(
                f"Building compressed vocab from {self.compression} "
                f"({self.encoder})..."
            )
            vocab = SeqVocab.from_compressed(
                self.workspace, self.encoder, self.compression
            )
            vocab.save(self.output_dir / "vocab.json")
        else:
            print(f"Building vocab from {self.encoder} training split...")
            vocab = SeqVocab.from_training(self.workspace, self.encoder)
            vocab.save(self.output_dir / "vocab.json")

        print(f"  {len(vocab)} tokens")
        return vocab

    def _build_loaders(
        self, vocab: SeqVocab
    ) -> tuple[DataLoader, DataLoader, int, int]:
        print("Materializing splits...")
        self.workspace.materialize_split(self.encoder, "train")
        self.workspace.materialize_split(self.encoder, "val")

        print("Loading data...")
        train_dataset = SeqDataset(
            self.workspace,
            self.encoder,
            "train",
            vocab,
            max_length=self.model_config.max_slug_tokens,
        )
        val_dataset = SeqDataset(
            self.workspace,
            self.encoder,
            "val",
            vocab,
            max_length=self.model_config.max_slug_tokens,
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

    def _build_model(self, vocab: SeqVocab) -> tuple[SlugDecoder, int]:
        model = SlugDecoder(
            vocab_size=len(vocab),
            embed_dim=self.model_config.embed_dim,
            num_heads=self.model_config.num_heads,
            num_layers=self.model_config.num_layers,
            input_dim=self.encoder_config.dim,
            max_length=self.model_config.max_slug_tokens,
            dropout=self.model_config.dropout,
        ).to(self.device)

        parameter_count = sum(p.numel() for p in model.parameters())
        print(f"  {parameter_count:,} parameters")
        return model, parameter_count

    def _build_optimizer(self, model: SlugDecoder):
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

    def _val_step(self, model, loader, loss_fn, dataset_size) -> float:
        model.eval()
        total_loss = 0.0
        with torch.no_grad():
            for batch in loader:
                embedding = batch["embedding"].to(self.device)
                input_ids = batch["input_ids"].to(self.device)
                target_ids = batch["target_ids"].to(self.device)

                logits = model(embedding, input_ids)
                loss = loss_fn(
                    logits.reshape(-1, logits.size(-1)),
                    target_ids.reshape(-1),
                )
                total_loss += loss.item() * len(embedding)

        return total_loss / dataset_size

    def _greedy_token_f1(self, model, loader, vocab: Vocab, n_samples: int = 2000) -> float:
        """Quick greedy decode on a subsample to track actual quality.

        Decodes to strings via vocab.decode_indices, then compares slug
        token sets. Works with both SeqVocab and BpeVocab.
        """
        model.eval()
        matches = 0
        total_pred = 0
        total_ref = 0
        seen = 0

        bos = vocab.bos_idx

        with torch.no_grad():
            for batch in loader:
                if seen >= n_samples:
                    break
                embedding = batch["embedding"].to(self.device)
                target_ids = batch["target_ids"].cpu()
                batch_size = len(embedding)

                # Greedy decode
                generated = torch.full(
                    (batch_size, 1), bos, dtype=torch.long, device=self.device
                )
                for _ in range(self.model_config.max_slug_tokens):
                    logits = model(embedding, generated)
                    next_token = logits[:, -1, :].argmax(dim=-1)
                    generated = torch.cat(
                        [generated, next_token.unsqueeze(1)], dim=1
                    )

                # Decode to strings, compare slug token sets
                for i in range(min(batch_size, n_samples - seen)):
                    pred_slug = vocab.decode_indices(generated[i, 1:].cpu().tolist())
                    ref_slug = vocab.decode_indices(target_ids[i].tolist())

                    pred_set = set(pred_slug.split("-")) if pred_slug else set()
                    ref_set = set(ref_slug.split("-")) if ref_slug else set()

                    matches += len(pred_set & ref_set)
                    total_pred += len(pred_set)
                    total_ref += len(ref_set)

                seen += batch_size

        precision = matches / max(total_pred, 1)
        recall = matches / max(total_ref, 1)
        if precision + recall == 0:
            return 0.0
        return 2 * precision * recall / (precision + recall)

    def _save_manifest(
        self,
        vocab: SeqVocab,
        parameter_count: int,
        best_val_loss: float,
        best_step: int,
        total_steps: int,
    ):
        manifest = {
            "schema_version": SCHEMA_VERSION,
            "variant": "seq2seq",
            "encoder": self.encoder,
            "seed": self.hyperparams.seed,
            "compression": self.compression,
            "tokenizer": self.tokenizer,
            "model": {
                "input_dim": self.encoder_config.dim,
                "vocab_size": len(vocab),
                "embed_dim": self.model_config.embed_dim,
                "num_heads": self.model_config.num_heads,
                "num_layers": self.model_config.num_layers,
                "dropout": self.model_config.dropout,
                "max_slug_tokens": self.model_config.max_slug_tokens,
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
            "artifacts": ["best.pt", "vocab.json"],
        }
        (self.output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))


def main():
    parser = argparse.ArgumentParser(description="Train seq2seq slug decoder")
    parser.add_argument("--workspace", default="original")
    parser.add_argument("--encoder", choices=list(ENCODERS), required=True)
    vocab_group = parser.add_mutually_exclusive_group()
    vocab_group.add_argument(
        "--compression",
        type=str,
        default=None,
        help="Compression mapping name (e.g. kmeans-5000)",
    )
    vocab_group.add_argument(
        "--tokenizer",
        type=str,
        choices=["bpe"],
        default=None,
        help="Tokenizer type (trains on slug corpus)",
    )
    parser.add_argument("--embed-dim", type=int, default=256)
    parser.add_argument("--num-heads", type=int, default=8)
    parser.add_argument("--num-layers", type=int, default=4)
    parser.add_argument("--dropout", type=float, default=0.1)
    parser.add_argument("--max-slug-tokens", type=int, default=10)
    parser.add_argument("--lr", type=float, default=3e-4)
    parser.add_argument("--epochs", type=int, default=15)
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
    parser.add_argument(
        "--tag",
        type=str,
        default=None,
        help="Tag appended to model directory name (e.g. 'd384' -> seq2seq_d384)",
    )
    args = parser.parse_args()

    workspace = Workspace(args.workspace)

    trainer = Trainer(
        workspace=workspace,
        encoder=args.encoder,
        model_config=Seq2SeqConfig(
            embed_dim=args.embed_dim,
            num_heads=args.num_heads,
            num_layers=args.num_layers,
            dropout=args.dropout,
            max_slug_tokens=args.max_slug_tokens,
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
        tokenizer=args.tokenizer,
        tag=args.tag,
    )
    trainer.run()
