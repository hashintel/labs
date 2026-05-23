"""MLP model for slug token prediction from embeddings.

Architecture:
    embedding → backbone (2 hidden layers) → two heads:
        - token_head: sigmoid over vocab (which tokens are present)
        - length_head: 6-class softmax (slug lengths 3-8)

Optionally adds a position head (variant 1b) that predicts the ordinal
position of each token in the output slug. Variant 1c (pairwise ordering)
uses the same model; ordering is a post-hoc decode step, not a learned head.
"""

import torch
from torch import Tensor, nn

# Slug lengths in training data range from 3 to 8.
MIN_SLUG_LENGTH = 3
MAX_SLUG_LENGTH = 8
NUM_LENGTH_CLASSES = MAX_SLUG_LENGTH - MIN_SLUG_LENGTH + 1


class BinaryFocalLoss(nn.Module):
    """Focal loss for multi-label binary classification.

    Down-weights easy negatives so the model focuses on hard positives.
    With ~5 active tokens out of 5000 per sample, BCE gives equal weight
    to all 4995 easy negatives. Focal loss with γ=2 reduces their
    contribution, concentrating gradient on uncertain predictions.

    focal_loss = -α_t * (1 - p_t)^γ * log(p_t)
    where p_t = p if y=1, else 1-p.
    """

    def __init__(self, gamma: float = 2.0):
        super().__init__()
        self.gamma = gamma

    def forward(self, logits: Tensor, targets: Tensor) -> Tensor:
        probs = torch.sigmoid(logits)
        p_t = probs * targets + (1 - probs) * (1 - targets)
        focal_weight = (1 - p_t) ** self.gamma
        bce = nn.functional.binary_cross_entropy_with_logits(
            logits, targets, reduction="none"
        )
        return (focal_weight * bce).mean()


class SlugMLP(nn.Module):
    """Bag-of-tokens slug predictor with length and optional position heads."""

    def __init__(
        self,
        input_dim: int,
        vocab_size: int,
        hidden_dim: int = 768,
        num_layers: int = 2,
        dropout: float = 0.2,
        position_head: bool = False,
    ):
        super().__init__()

        layers: list[nn.Module] = []
        in_dim = input_dim
        for _ in range(num_layers):
            layers.extend([
                nn.Linear(in_dim, hidden_dim),
                nn.ReLU(),
                nn.Dropout(dropout),
            ])
            in_dim = hidden_dim
        self.backbone = nn.Sequential(*layers)

        # Which tokens are present (multi-label)
        self.token_head = nn.Linear(hidden_dim, vocab_size)

        # How many tokens (lengths 3-8 → 6 classes)
        self.length_head = nn.Linear(hidden_dim, NUM_LENGTH_CLASSES)

        # Optional: predicted position for each token (variant 1b)
        self.has_position_head = position_head
        if position_head:
            self.position_head = nn.Linear(hidden_dim, vocab_size * MAX_SLUG_LENGTH)
            self._vocab_size = vocab_size

    def forward(self, x: Tensor) -> dict[str, Tensor]:
        h = self.backbone(x)

        out = {
            "token_logits": self.token_head(h),
            "length_logits": self.length_head(h),
        }

        if self.has_position_head:
            # [batch, vocab_size * max_length] → [batch, vocab_size, max_length]
            pos_logits = self.position_head(h)
            out["position_logits"] = pos_logits.view(
                -1, self._vocab_size, MAX_SLUG_LENGTH
            )

        return out
