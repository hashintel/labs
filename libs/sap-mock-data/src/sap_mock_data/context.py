"""Run-local generation context."""

from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Iterator, Mapping

from .config import GenerationConfig

_ACTIVE_CONTEXT: ContextVar["GenerationContext | None"] = ContextVar(
    "sap_mock_data_generation_context", default=None
)


def current_parameters() -> Mapping[str, str]:
    context = _ACTIVE_CONTEXT.get()
    return context.parameters if context else {}


@dataclass(slots=True)
class GenerationContext:
    """Configuration owned by one generation run."""

    config: GenerationConfig
    parameters: Mapping[str, str] = field(init=False)

    def __post_init__(self) -> None:
        self.parameters = self.config.parameters()

    @contextmanager
    def activate(self) -> Iterator["GenerationContext"]:
        token = _ACTIVE_CONTEXT.set(self)
        try:
            yield self
        finally:
            _ACTIVE_CONTEXT.reset(token)
