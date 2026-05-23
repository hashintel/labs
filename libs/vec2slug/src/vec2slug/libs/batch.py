"""Generic batch processing with automatic persistence.

The Batch ABC handles splitting, id mapping, wave-based submission
(to respect enqueue limits), and saving/loading state to disk.
Subclasses implement the API-specific parts.

Lifecycle:
    batch.submit(requests)   -> splits, submits in waves, saves state
    batch.poll()             -> reads batch IDs from disk, checks status
    batch.collect()          -> reads state from disk, downloads results
"""

import json
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass
class RequestInfo[Req]:
    id: str
    safe_id: str
    request: Req
    size: int  # serialized size in bytes


@dataclass
class BatchState:
    """Persisted state for a batch operation."""

    id_map: dict[str, str]  # safe_id -> original_id
    batch_ids: list[str]  # API batch IDs


class Batch[Req, Res](ABC):
    """Base class for batch API operations with automatic persistence.

    Type parameters:
        Req: the request type (e.g., a dict with id + text)
        Res: the result type per request (e.g., an embedding vector)
    """

    def __init__(self, *, batch_dir: Path, max_concurrent_batches: int | None = None):
        self.batch_dir = batch_dir
        self.batch_dir.mkdir(parents=True, exist_ok=True)
        self.max_concurrent_batches = max_concurrent_batches

    @abstractmethod
    def request_id(self, request: Req) -> str:
        """Extract the unique ID from a request."""
        ...

    def request_size(self, request: Req) -> int:
        """Serialized size of a request in bytes."""
        return len(json.dumps(request).encode("utf-8"))

    @abstractmethod
    def should_split(
        self,
        request: RequestInfo[Req],
        *,
        current_size: int,
        current_count: int,
    ) -> bool:
        """Whether adding this request would exceed batch limits."""
        ...

    @abstractmethod
    def submit_batch(self, requests: list[RequestInfo[Req]]) -> str:
        """Submit one batch of requests to the API. Returns the batch ID."""
        ...

    @abstractmethod
    def poll_batch(self, batch_id: str) -> dict[str, Any]:
        """Check status of a single batch. Returns dict with at least 'done': bool."""
        ...

    @abstractmethod
    def collect_batch(self, batch_id: str) -> dict[str, Res]:
        """Download results from a completed batch.

        Returns a dict mapping safe_id -> result.
        """
        ...

    def submit(self, requests: list[Req]) -> BatchState:
        """Split requests into batches, submit (in waves if needed), persist state."""
        id_map, batches = self._split(requests)

        if self.max_concurrent_batches and len(batches) > self.max_concurrent_batches:
            return self._submit_waves(id_map, batches)
        else:
            return self._submit_all(id_map, batches)

    def poll(self, interval: int = 60) -> bool:
        """Poll all batches until complete. Returns True if all succeeded."""
        state = self._load_state()
        print(f"Polling {len(state.batch_ids)} batches...")

        while True:
            all_done = True
            for i, bid in enumerate(state.batch_ids):
                status = self.poll_batch(bid)
                print(f"  [{i:>2d}] {bid}: {status}")
                if not status.get("done", False):
                    all_done = False

            if all_done:
                print("All batches complete.")
                return True

            print(f"  Waiting {interval}s...")
            time.sleep(interval)

    def collect(self) -> dict[str, Res]:
        """Collect results from all batches. Returns original_id -> result."""
        state = self._load_state()
        print(f"Collecting from {len(state.batch_ids)} batches...")

        # safe_id -> result
        all_results: dict[str, Res] = {}
        for i, bid in enumerate(state.batch_ids):
            batch_results = self.collect_batch(bid)
            all_results.update(batch_results)
            print(
                f"  [{i:>2d}] {bid}: {len(batch_results)} results ({len(all_results)} total)"
            )

        # Map safe_id back to original_id
        return {
            state.id_map[safe_id]: result
            for safe_id, result in all_results.items()
            if safe_id in state.id_map
        }

    # ── Splitting ──────────────────────────────────────────────────────────

    def _split(
        self, requests: list[Req]
    ) -> tuple[dict[str, str], list[list[RequestInfo[Req]]]]:
        """Split requests into batch-sized chunks. Returns (id_map, chunks)."""
        chunks: list[list[RequestInfo[Req]]] = []
        running: list[RequestInfo[Req]] = []
        current_size = 0
        current_count = 0
        id_map: dict[str, str] = {}

        def flush():
            nonlocal running, current_size, current_count
            if running:
                chunks.append(running)
                running = []
                current_size = 0
                current_count = 0

        for index, request in enumerate(requests):
            req_id = self.request_id(request)
            req_size = self.request_size(request)
            info = RequestInfo(
                id=req_id,
                safe_id=f"req_{index:07d}",
                request=request,
                size=req_size,
            )
            id_map[info.safe_id] = req_id

            if self.should_split(
                info, current_size=current_size, current_count=current_count
            ):
                flush()

            running.append(info)
            current_size += req_size
            current_count += 1

        flush()

        return id_map, chunks

    # ── Submission strategies ──────────────────────────────────────────────

    def _submit_all(
        self, id_map: dict[str, str], chunks: list[list[RequestInfo[Req]]]
    ) -> BatchState:
        """Submit all chunks at once."""
        print(f"  Submitting {len(chunks)} batches...")
        batch_ids = [self.submit_batch(chunk) for chunk in chunks]
        state = BatchState(id_map=id_map, batch_ids=batch_ids)
        self._save_state(state)
        return state

    def _submit_waves(
        self, id_map: dict[str, str], chunks: list[list[RequestInfo[Req]]]
    ) -> BatchState:
        """Submit in waves, waiting for each wave to complete before the next."""
        wave_size = self.max_concurrent_batches
        total_waves = (len(chunks) + wave_size - 1) // wave_size
        print(
            f"  {len(chunks)} batches, submitting in {total_waves} waves of {wave_size}"
        )

        all_batch_ids: list[str] = []

        for wave_start in range(0, len(chunks), wave_size):
            wave = chunks[wave_start : wave_start + wave_size]
            wave_num = wave_start // wave_size + 1
            print(f"\n  Wave {wave_num}/{total_waves} ({len(wave)} batches)")

            wave_ids = [self.submit_batch(chunk) for chunk in wave]
            all_batch_ids.extend(wave_ids)

            # Persist after each wave so we can resume
            state = BatchState(id_map=id_map, batch_ids=all_batch_ids)
            self._save_state(state)

            # Wait for wave to finish before submitting next (unless last wave)
            if wave_start + wave_size < len(chunks):
                print(f"  Waiting for wave {wave_num} to complete...")
                self._poll_wave(wave_ids)

        state = BatchState(id_map=id_map, batch_ids=all_batch_ids)
        self._save_state(state)
        return state

    def _poll_wave(self, batch_ids: list[str], interval: int = 60):
        """Block until all batches in a wave are done."""
        while True:
            pending = sum(
                1 for bid in batch_ids if not self.poll_batch(bid).get("done", False)
            )
            if pending == 0:
                return
            print(
                f"    {pending}/{len(batch_ids)} still processing, waiting {interval}s..."
            )
            time.sleep(interval)

    @property
    def _state_file(self) -> Path:
        return self.batch_dir / "state.json"

    def _save_state(self, state: BatchState):
        self._state_file.write_text(
            json.dumps(
                {
                    "id_map": state.id_map,
                    "batch_ids": state.batch_ids,
                }
            )
        )

    def _load_state(self) -> BatchState:
        data = json.loads(self._state_file.read_text())
        return BatchState(id_map=data["id_map"], batch_ids=data["batch_ids"])
