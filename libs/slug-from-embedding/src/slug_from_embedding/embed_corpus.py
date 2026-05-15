"""Embed the corpus using a registered encoder.

Usage:
    uv run -m slug_from_embedding.embed_corpus openai
    uv run -m slug_from_embedding.embed_corpus harrier
"""

from __future__ import annotations

import sys

import numpy as np

from .config import CORPUS_FILE, ENCODERS, EncoderConfig, openrouter_client, embeddings_file
from .io import batched, load_corpus_texts, write_embeddings


# ── Backends ───────────────────────────────────────────────────────────────────


def _embed_openrouter(cfg: EncoderConfig):
    """Embed via OpenRouter's OpenAI-compatible embeddings endpoint."""
    client = openrouter_client()
    corpus = load_corpus_texts(CORPUS_FILE)
    print(f"Embedding {len(corpus)} documents with {cfg.model}...")

    all_ids = []
    all_embeddings = []

    for i, batch in enumerate(batched(corpus, cfg.batch_size)):
        ids = [doc_id for doc_id, _ in batch]
        texts = [text for _, text in batch]

        response = client.embeddings.create(model=cfg.model, input=texts)

        batch_embeddings = [None] * len(texts)
        for item in response.data:
            batch_embeddings[item.index] = item.embedding

        all_ids.extend(ids)
        all_embeddings.extend(batch_embeddings)

        done = min((i + 1) * cfg.batch_size, len(corpus))
        print(f"  {done}/{len(corpus)}")

    embeddings_array = np.array(all_embeddings, dtype=np.float32)
    write_embeddings(all_ids, embeddings_array, embeddings_file(cfg.name))


def _embed_local(cfg: EncoderConfig):
    """Embed locally using transformers + torch."""
    import torch
    import torch.nn.functional as F
    from transformers import AutoModel, AutoTokenizer

    corpus = load_corpus_texts(CORPUS_FILE)
    ids = [doc_id for doc_id, _ in corpus]
    texts = [text for _, text in corpus]

    print(f"Loading {cfg.model}...")
    tokenizer = AutoTokenizer.from_pretrained(cfg.model)
    model = AutoModel.from_pretrained(cfg.model, dtype="auto")
    model.eval()

    if torch.backends.mps.is_available():
        device = torch.device("mps")
    elif torch.cuda.is_available():
        device = torch.device("cuda")
    else:
        device = torch.device("cpu")
    model.to(device)
    print(f"Using device: {device}")

    def last_token_pool(last_hidden_states, attention_mask):
        left_padding = attention_mask[:, -1].sum() == attention_mask.shape[0]
        if left_padding:
            return last_hidden_states[:, -1]
        sequence_lengths = attention_mask.sum(dim=1) - 1
        batch_size = last_hidden_states.shape[0]
        return last_hidden_states[
            torch.arange(batch_size, device=last_hidden_states.device),
            sequence_lengths,
        ]

    all_embeddings = []
    print(f"Embedding {len(texts)} documents...")

    for i, batch_texts in enumerate(batched(texts, cfg.batch_size)):
        batch_dict = tokenizer(
            batch_texts,
            max_length=8192,
            padding=True,
            truncation=True,
            return_tensors="pt",
        )
        batch_dict = {k: v.to(device) for k, v in batch_dict.items()}

        with torch.inference_mode():
            outputs = model(**batch_dict)

        emb = last_token_pool(outputs.last_hidden_state, batch_dict["attention_mask"])
        emb = F.normalize(emb, p=2, dim=1)
        all_embeddings.append(emb.cpu().float().numpy())

        done = min((i + 1) * cfg.batch_size, len(texts))
        print(f"  {done}/{len(texts)}")

    embeddings_array = np.concatenate(all_embeddings, axis=0).astype(np.float32)
    write_embeddings(ids, embeddings_array, embeddings_file(cfg.name))


BACKENDS = {
    "openrouter": _embed_openrouter,
    "local": _embed_local,
}


# ── CLI ───────────────────────────────────────────────────────────────────────


def main():
    if len(sys.argv) < 2:
        names = ", ".join(ENCODERS)
        print(f"Usage: uv run -m slug_from_embedding.embed_corpus [{names}]")
        sys.exit(1)

    encoder_name = sys.argv[1]
    if encoder_name not in ENCODERS:
        print(f"Unknown encoder: {encoder_name}. Available: {', '.join(ENCODERS)}")
        sys.exit(1)

    cfg = ENCODERS[encoder_name]
    backend_fn = BACKENDS.get(cfg.backend)
    if not backend_fn:
        print(f"Unknown backend: {cfg.backend}")
        sys.exit(1)

    backend_fn(cfg)


if __name__ == "__main__":
    main()
