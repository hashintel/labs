"""Prefix-conditioned transformer decoder for slug generation.

Architecture:
    embedding → linear projection → prefix token (position 0)
    [prefix, BOS, tok1, tok2, ...] → causal self-attention → next token logits

The source embedding is projected into the decoder's hidden space and
prepended as a prefix token. Standard causal attention lets every
generated token attend to the prefix and all previous tokens.
"""

import torch
from torch import Tensor, nn


class DecoderBlock(nn.Module):
    """Pre-norm transformer block with causal self-attention."""

    def __init__(self, embed_dim: int, num_heads: int, dropout: float):
        super().__init__()
        self.ln1 = nn.LayerNorm(embed_dim)
        self.attn = nn.MultiheadAttention(
            embed_dim, num_heads, dropout=dropout, batch_first=True
        )
        self.ln2 = nn.LayerNorm(embed_dim)
        self.ffn = nn.Sequential(
            nn.Linear(embed_dim, embed_dim * 4),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(embed_dim * 4, embed_dim),
            nn.Dropout(dropout),
        )

    def forward(self, x: Tensor, attn_mask: Tensor) -> Tensor:
        normed = self.ln1(x)
        x = x + self.attn(
            normed, normed, normed, attn_mask=attn_mask, is_causal=True
        )[0]
        x = x + self.ffn(self.ln2(x))
        return x


class SlugDecoder(nn.Module):
    """Autoregressive slug generator conditioned on an embedding prefix.

    The source embedding is projected and placed at position 0. Token
    embeddings for BOS and slug tokens follow. The model predicts the
    next token at each position after the prefix.
    """

    def __init__(
        self,
        vocab_size: int,
        embed_dim: int,
        num_heads: int,
        num_layers: int,
        input_dim: int,
        max_length: int,
        dropout: float = 0.1,
    ):
        super().__init__()
        self.embed_dim = embed_dim
        self.max_length = max_length

        # Project source embedding to decoder space
        self.embedding_projection = nn.Linear(input_dim, embed_dim)

        # Token and position embeddings
        self.token_embedding = nn.Embedding(vocab_size, embed_dim, padding_idx=0)
        # +1 for the prefix position
        self.position_embedding = nn.Embedding(max_length + 1, embed_dim)

        self.dropout = nn.Dropout(dropout)

        # Transformer blocks
        self.blocks = nn.ModuleList(
            [DecoderBlock(embed_dim, num_heads, dropout) for _ in range(num_layers)]
        )
        self.ln_final = nn.LayerNorm(embed_dim)

        # Output projection to vocab
        self.output_projection = nn.Linear(embed_dim, vocab_size)

    def forward(
        self, embeddings: Tensor, target_ids: Tensor
    ) -> Tensor:
        """Forward pass with teacher forcing.

        Args:
            embeddings: [batch, input_dim] source embeddings
            target_ids: [batch, seq_len] token ids (BOS + slug tokens, no EOS)

        Returns:
            logits: [batch, seq_len, vocab_size] next-token predictions
                    logits[:, 0, :] predicts the first slug token (given prefix + BOS)
                    logits[:, -1, :] predicts EOS (given all slug tokens)
        """
        # Prefix: project embedding to decoder space
        prefix = self.embedding_projection(embeddings).unsqueeze(1)  # [B, 1, D]

        # Token embeddings for target sequence
        token_emb = self.token_embedding(target_ids)  # [B, T, D]

        # Concatenate prefix + token embeddings
        seq = torch.cat([prefix, token_emb], dim=1)  # [B, 1+T, D]

        # Add positional embeddings
        positions = torch.arange(seq.size(1), device=seq.device)
        seq = seq + self.position_embedding(positions)
        seq = self.dropout(seq)

        # Causal mask (provides shape; is_causal=True enables fast path)
        attn_mask = nn.Transformer.generate_square_subsequent_mask(
            seq.size(1), device=seq.device
        )

        # Apply transformer blocks
        for block in self.blocks:
            seq = block(seq, attn_mask)

        seq = self.ln_final(seq)

        # Output logits for positions after the prefix
        # seq[:, 0, :] is the prefix position (no prediction needed)
        logits = self.output_projection(seq[:, 1:, :])  # [B, T, vocab_size]
        return logits
