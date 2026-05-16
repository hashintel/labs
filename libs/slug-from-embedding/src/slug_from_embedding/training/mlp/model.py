"""MLP model for slug token prediction from embeddings.

Architecture:
    embedding → backbone (2 hidden layers) → two heads:
        - token_head: sigmoid over vocab (which tokens are present)
        - length_head: 6-class softmax (slug lengths 3-8)

Variant 1b adds a position head that predicts the position of each token
in the output slug. Variant 1c adds a pairwise ordering head. Both share
the same backbone and token/length heads.
"""

from torch import Tensor, nn

# Slug lengths in training data range from 3 to 8.
MIN_SLUG_LENGTH = 3
MAX_SLUG_LENGTH = 8
NUM_LENGTH_CLASSES = MAX_SLUG_LENGTH - MIN_SLUG_LENGTH + 1


class SlugMLP(nn.Module):
    """Bag-of-tokens slug predictor with length and optional position heads."""

    def __init__(
        self,
        input_dim: int,
        vocab_size: int,
        hidden_dim: int = 768,
        dropout: float = 0.2,
        position_head: bool = False,
    ):
        super().__init__()

        self.backbone = nn.Sequential(
            nn.Linear(input_dim, hidden_dim),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(hidden_dim, hidden_dim),
            nn.ReLU(),
            nn.Dropout(dropout),
        )

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
