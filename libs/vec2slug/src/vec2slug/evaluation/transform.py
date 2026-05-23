from abc import ABC, abstractmethod
from typing import Any, Iterable

from datasets import Dataset


class Transform(ABC):
    def name(self) -> str:
        return self.__class__.__name__

    def description(self) -> str:
        return self.__doc__ or ""

    @abstractmethod
    def transform(self, dataset: Dataset) -> Dataset: ...

    @abstractmethod
    def evaluate(self, dataset: Dataset, stats: dict[str, Any]) -> dict[str, Any]: ...


class Pipeline(Transform):
    def __init__(self, transforms: Iterable[Transform]):
        self.transforms = tuple(transforms)

    def name(self) -> str:
        return f"Pipeline({', '.join(t.name() for t in self.transforms)})"

    def description(self) -> str:
        return f"Pipeline of {', '.join(t.description() for t in self.transforms)}"

    def transform(self, dataset: Dataset) -> Dataset:
        for transform in self.transforms:
            dataset = transform.transform(dataset)

        return dataset

    def evaluate(self, dataset: Dataset, stats: dict[str, Any]) -> dict[str, Any]:
        for transform in self.transforms:
            stats |= transform.evaluate(dataset, stats)

        return stats


def pipeline(*transforms: Transform) -> Transform:
    return Pipeline(transforms)
