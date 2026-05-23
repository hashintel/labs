"""Training loop for the seq2seq slug decoder.

Prefix-conditioned transformer decoder trained with teacher forcing.
Cross-entropy loss per token position, ignoring PAD. Validates every
N steps with sub-epoch checkpointing.

Persistence per run:
  - best.pt           : weights at the lowest val loss seen so far
  - step_NNNNNN.pt    : rolling periodic snapshots (last N kept)
  - vocab.json or
    tokenizer.json    : the vocabulary used by this model
  - manifest.json     : config and final results
  - history.jsonl     : metrics per eval, for plotting and writeup

Usage:
    uv run slug-train-seq2seq --workspace url --encoder openai --compression kmeans-5000
"""

import argparse
import json
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from torch.utils.data import DataLoader

from vec2slug.config import ENCODERS, SEED, Encoder
from vec2slug.libs.workspace import Workspace

from ..config import SCHEMA_VERSION, resolve_device, seed_all
from ..trainer import Trainer as BaseTrainer
from .bpe_vocab import BpeVocab
from .config import Seq2SeqConfig
from .dataset import SeqDataset
from .model import SlugDecoder
from .vocab import SeqVocab

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
    checkpoint_every: int = 5000  # 0 disables periodic snapshots
    keep_last_checkpoints: int = 5
    f1_n_samples: int = 2000
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

        self.history_path = self.output_dir / "history.jsonl"
        if overwrite and self.history_path.exists():
            self.history_path.unlink()

    def run(self) -> Path:
        seed_all(self.hyperparams.seed)

        vocab = self._build_vocab()
        train_loader, val_loader, _, val_size = self._build_loaders(vocab)
        model, parameter_count = self._build_model(vocab)
        optimizer, scheduler = self._build_optimizer(model)
        eos_position_weights = self._compute_eos_position_weights(vocab)

        # Write manifest early so interrupted runs still have metadata
        self._save_manifest(
            vocab, parameter_count,
            best_val_loss=float("inf"), best_step=0, total_steps=0,
        )

        print(f"\nTraining {self.tag} on {self.device}...")
        print(
            f"  eval every {self.hyperparams.eval_every} steps, "
            f"patience {self.hyperparams.patience} evals, "
            f"checkpoint every {self.hyperparams.checkpoint_every} steps "
            f"(keep last {self.hyperparams.keep_last_checkpoints})"
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
                loss = self._position_aware_loss(
                    logits, target_ids, vocab, eos_position_weights,
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
                        model, val_loader, vocab, eos_position_weights, val_size,
                    )
                    tok_f1, mean_words = self._greedy_token_f1(
                        model, val_loader, vocab,
                    )
                    scheduler.step(val_loss)
                    current_lr = optimizer.param_groups[0]["lr"]

                    print(
                        f"  step {global_step:6d}  "
                        f"epoch {epoch:3d}  "
                        f"train={train_avg:.4f}  val={val_loss:.4f}  "
                        f"tok_f1={tok_f1:.3f}  "
                        f"words={mean_words:.1f}  "
                        f"lr={current_lr:.1e}"
                    )
                    self._record_history(
                        step=global_step,
                        epoch=epoch,
                        train_loss=train_avg,
                        val_loss=val_loss,
                        tok_f1=tok_f1,
                        mean_words=mean_words,
                        lr=current_lr,
                    )

                    running_loss = 0.0
                    running_count = 0

                    if val_loss < best_val_loss:
                        best_val_loss = val_loss
                        best_step = global_step
                        stale = 0
                        torch.save(model.state_dict(), self.output_dir / "best.pt")
                        self._save_manifest(
                            vocab, parameter_count,
                            best_val_loss, best_step, global_step,
                        )
                    else:
                        stale += 1
                        if stale >= self.hyperparams.patience:
                            print(
                                f"  Early stopping at step {global_step} "
                                f"(patience={self.hyperparams.patience} evals)"
                            )
                            stopped_early = True
                            model.train()
                            break

                    model.train()

                # Periodic checkpointing is orthogonal to eval cadence.
                if (
                    self.hyperparams.checkpoint_every > 0
                    and global_step % self.hyperparams.checkpoint_every == 0
                ):
                    self._save_periodic_checkpoint(model, global_step)

            elapsed = time.time() - epoch_start
            print(f"  epoch {epoch} done ({elapsed:.0f}s, step {global_step})")

            if stopped_early:
                break

        # Final eval if there's accumulated train signal we haven't yet measured.
        if running_count > 0:
            val_loss = self._val_step(
                model, val_loader, vocab, eos_position_weights, val_size,
            )
            tok_f1, mean_words = self._greedy_token_f1(
                model, val_loader, vocab,
            )
            print(
                f"  final  step {global_step:6d}  val={val_loss:.4f}  "
                f"tok_f1={tok_f1:.3f}  words={mean_words:.1f}"
            )
            self._record_history(
                step=global_step,
                epoch=epoch,
                train_loss=running_loss / running_count,
                val_loss=val_loss,
                tok_f1=tok_f1,
                mean_words=mean_words,
                lr=optimizer.param_groups[0]["lr"],
            )
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
            print(f"Training BPE tokenizer ({self.encoder})...")
            vocab = BpeVocab.train(self.workspace, self.encoder)
            vocab_path = self.output_dir / "tokenizer.json"
            vocab.save(vocab_path)
            print(f"  Saved to {vocab_path}")
        elif self.compression:
            print(
                f"Building compressed vocab from {self.compression} ({self.encoder})..."
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

    def _build_loaders(self, vocab: Vocab) -> tuple[DataLoader, DataLoader, int, int]:
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

    def _build_model(self, vocab: Vocab) -> tuple[SlugDecoder, int]:
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

    def _compute_eos_position_weights(self, vocab: Vocab) -> torch.Tensor:
        """Compute per-position EOS loss weights from training distribution.

        Positions where EOS is common (short slugs) get downweighted;
        positions where EOS is rare (long slugs) get upweighted.
        Uses sqrt(inverse frequency) to compress the weight range.
        Normalized so mean weight over active positions is 1.0.
        """
        max_length = self.model_config.max_slug_tokens
        split_data = self.workspace.load_split_data(self.encoder, "train")

        eos_counts = np.zeros(max_length)
        total = 0
        for slug in split_data.slugs:
            encoded = vocab.encode_slug(slug)
            # target_ids = encoded[1:], EOS position in target
            eos_pos = len(encoded) - 2
            if eos_pos < max_length:
                eos_counts[eos_pos] += 1
                total += 1

        rates = eos_counts / max(total, 1)
        active = rates > 0

        # Dampen positions above median frequency, leave rest at 1.0.
        # This discourages early EOS without amplifying noisy long slugs.
        weights = np.ones(max_length, dtype=np.float32)
        if active.any():
            median_rate = np.median(rates[active])
            for i in range(max_length):
                if rates[i] > median_rate:
                    weights[i] = median_rate / rates[i]

        w_min, w_max = weights[active].min(), weights[active].max()
        print(f"  EOS position weights: range [{w_min:.2f}, {w_max:.2f}]")
        # Show a few sample positions for sanity checking
        sample_positions = [5, 10, 15, 20]
        sample_str = ", ".join(
            f"pos {p}={weights[p]:.2f}"
            for p in sample_positions if p < max_length
        )
        print(f"    {sample_str}")

        return torch.from_numpy(weights).to(self.device)

    def _position_aware_loss(
        self,
        logits: torch.Tensor,
        targets: torch.Tensor,
        vocab: Vocab,
        eos_position_weights: torch.Tensor,
        label_smoothing: float = 0.1,
    ) -> torch.Tensor:
        """Cross-entropy with position-dependent EOS weighting and label smoothing."""
        per_token = F.cross_entropy(
            logits.reshape(-1, logits.size(-1)),
            targets.reshape(-1),
            reduction="none",
            label_smoothing=label_smoothing,
        ).reshape(targets.shape)  # [B, T]

        is_eos = (targets == vocab.eos_idx).float()
        position_weights = eos_position_weights[: targets.size(1)].unsqueeze(0)
        weight = is_eos * position_weights + (1.0 - is_eos)

        mask = (targets != vocab.pad_idx).float()
        return (per_token * weight * mask).sum() / mask.sum()

    def _val_step(
        self, model, loader, vocab: Vocab, eos_position_weights: torch.Tensor,
        dataset_size: int,
    ) -> float:
        model.eval()
        total_loss = 0.0
        with torch.no_grad():
            for batch in loader:
                embedding = batch["embedding"].to(self.device)
                input_ids = batch["input_ids"].to(self.device)
                target_ids = batch["target_ids"].to(self.device)

                logits = model(embedding, input_ids)
                loss = self._position_aware_loss(
                    logits, target_ids, vocab, eos_position_weights,
                )
                total_loss += loss.item() * len(embedding)

        return total_loss / dataset_size

    def _greedy_token_f1(self, model, loader, vocab: Vocab) -> tuple[float, float]:
        """Quick greedy decode on a subsample to track quality and length.

        Computes macro-averaged token F1 (per-sample F1, then mean) to
        match the evaluation pipeline's SlugTokenF1 metric.

        Returns (tok_f1, mean_word_count).
        """
        model.eval()
        f1_scores: list[float] = []
        word_counts: list[int] = []
        seen = 0
        target = self.hyperparams.f1_n_samples

        with torch.no_grad():
            for batch in loader:
                if seen >= target:
                    break
                embedding = batch["embedding"].to(self.device)
                target_ids = batch["target_ids"].cpu()
                batch_size = len(embedding)

                # Greedy decode.
                generated = torch.full(
                    (batch_size, 1),
                    vocab.bos_idx,
                    dtype=torch.long,
                    device=self.device,
                )
                for _ in range(self.model_config.max_slug_tokens):
                    logits = model(embedding, generated)
                    next_token = logits[:, -1, :].argmax(dim=-1)
                    generated = torch.cat([generated, next_token.unsqueeze(1)], dim=1)

                # Decode to strings, compare slug token sets.
                for i in range(min(batch_size, target - seen)):
                    pred_slug = vocab.decode_indices(generated[i, 1:].cpu().tolist())
                    ref_slug = vocab.decode_indices(target_ids[i].tolist())

                    pred_set = set(w for w in pred_slug.split("-") if w)
                    ref_set = set(ref_slug.split("-")) if ref_slug else set()

                    if not pred_set and not ref_set:
                        f1_scores.append(1.0)
                    elif not pred_set or not ref_set:
                        f1_scores.append(0.0)
                    else:
                        common = len(pred_set & ref_set)
                        p = common / len(pred_set)
                        r = common / len(ref_set)
                        f1_scores.append(2 * p * r / (p + r) if (p + r) > 0 else 0.0)

                    word_counts.append(len(pred_set))

                seen += batch_size

        tok_f1 = sum(f1_scores) / max(len(f1_scores), 1)
        mean_words = sum(word_counts) / max(len(word_counts), 1)
        return tok_f1, mean_words

    def _record_history(
        self,
        *,
        step: int,
        epoch: int,
        train_loss: float,
        val_loss: float,
        tok_f1: float,
        mean_words: float,
        lr: float,
    ):
        entry = {
            "step": step,
            "epoch": epoch,
            "train_loss": train_loss,
            "val_loss": val_loss,
            "tok_f1": tok_f1,
            "mean_words": mean_words,
            "lr": lr,
            "wall_time": time.time(),
        }

        with open(self.history_path, "a") as file:
            file.write(json.dumps(entry) + "\n")

    def _save_periodic_checkpoint(self, model: SlugDecoder, step: int):
        ckpt_path = self.output_dir / f"step_{step:06d}.pt"
        torch.save(model.state_dict(), ckpt_path)
        keep = self.hyperparams.keep_last_checkpoints
        if keep > 0:
            existing = sorted(self.output_dir.glob("step_*.pt"))
            for old in existing[:-keep]:
                old.unlink()

    def _save_manifest(
        self,
        vocab: Vocab,
        parameter_count: int,
        best_val_loss: float,
        best_step: int,
        total_steps: int,
    ):
        periodic_artifacts = sorted(p.name for p in self.output_dir.glob("step_*.pt"))
        vocab_artifact = "tokenizer.json" if self.tokenizer == "bpe" else "vocab.json"

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
                "checkpoint_every": self.hyperparams.checkpoint_every,
                "keep_last_checkpoints": self.hyperparams.keep_last_checkpoints,
                "f1_n_samples": self.hyperparams.f1_n_samples,
            },
            "results": {
                "best_val_loss": best_val_loss,
                "best_step": best_step,
                "total_steps": total_steps,
                "n_params": parameter_count,
            },
            "artifacts": [
                "best.pt",
                vocab_artifact,
                "history.jsonl",
                *periodic_artifacts,
            ],
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
    parser.add_argument("--max-slug-tokens", type=int, default=24)
    parser.add_argument("--lr", type=float, default=3e-4)
    parser.add_argument("--epochs", type=int, default=15)
    parser.add_argument("--batch-size", type=int, default=1024)
    parser.add_argument("--patience", type=int, default=10)
    parser.add_argument("--eval-every", type=int, default=2000)
    parser.add_argument("--val-max-samples", type=int, default=5000)
    parser.add_argument(
        "--checkpoint-every",
        type=int,
        default=5000,
        help="Save a periodic snapshot every N steps. 0 disables.",
    )
    parser.add_argument(
        "--keep-last-checkpoints",
        type=int,
        default=5,
        help="Number of periodic snapshots to retain.",
    )
    parser.add_argument(
        "--f1-n-samples",
        type=int,
        default=2000,
        help="Number of val samples for the in-loop tok_f1 estimate.",
    )
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
            checkpoint_every=args.checkpoint_every,
            keep_last_checkpoints=args.keep_last_checkpoints,
            f1_n_samples=args.f1_n_samples,
            seed=args.seed,
        ),
        device=resolve_device(args.device),
        overwrite=args.overwrite,
        compression=args.compression,
        tokenizer=args.tokenizer,
        tag=args.tag,
    )
    trainer.run()
