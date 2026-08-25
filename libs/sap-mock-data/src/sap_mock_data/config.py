"""Typed configuration for SAP mock-data generation."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Mapping, Sequence

ALL_SCENARIOS = tuple(f"SCN{i:03d}" for i in range(1, 27))

DEMO_SCENARIO_CONFIGS: dict[str, str] = {
    "SCN001": "MAT-A0008,1000,FG01,500",
    "SCN003": "2000,ALL,20250615,30",
    "SCN011": "MAT-A0005,1000,25,20250615",
    "SCN012": "MAT-NEW01,1000,MAT-A0005",
    "SCN014": "1000,95,30",
    "SCN015": "1000,20250615,7,0.3",
    "SCN016": "1000,MAT-A0005;MAT-A0008,30",
    "SCN020": "40,30",
    "SCN021": "VEND-0005,ALL,0.72,3",
    "SCN023": "VEND-0008,MAT-R0010",
    "SCN026": "VEND-0008,ALL,0.85,3",
}


@dataclass(frozen=True, slots=True)
class GenerationConfig:
    random_seed: int = 42
    scale_factor: float = 1.0
    num_customers: int | None = None
    num_finished_goods: int | None = None
    num_raw_materials: int | None = None
    num_orders: int | None = None
    moq_finished_min: int = 250
    moq_finished_max: int = 1000
    moq_raw_min: int = 1000
    moq_raw_max: int = 10000
    hub_plant: str = "1000"
    delivery_fill_rate: float = 0.8
    safety_stock_weeks: int = 6
    supplier_reliability_rate: float = 1.0
    unreliable_materials: Sequence[str] = ()
    currency: str = "EUR"
    generate_dirty_data: bool = False
    dirty_data_rate: float = 0.05
    scenarios: str | Sequence[str] = "demo"
    scenario_configs: Mapping[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.scale_factor <= 0:
            raise ValueError(
                f"scale_factor must be greater than zero; got {self.scale_factor}"
            )
        if not 0 <= self.delivery_fill_rate <= 1:
            raise ValueError(
                "delivery_fill_rate must be between zero and one; "
                f"got {self.delivery_fill_rate}"
            )
        if not 0 <= self.supplier_reliability_rate <= 1:
            raise ValueError(
                "supplier_reliability_rate must be between zero and one; "
                f"got {self.supplier_reliability_rate}"
            )
        if len(self.currency) != 3 or not self.currency.isalpha():
            raise ValueError(
                f"currency must be a three-letter code; got {self.currency!r}"
            )
        if not 0 <= self.dirty_data_rate <= 1:
            raise ValueError(
                f"dirty_data_rate must be between zero and one; got {self.dirty_data_rate}"
            )
        for name in (
            "num_customers",
            "num_finished_goods",
            "num_raw_materials",
            "num_orders",
        ):
            value = getattr(self, name)
            if value is not None and value < 1:
                raise ValueError(f"{name} must be at least one; got {value}")
        unknown = set(self.scenario_configs) - set(ALL_SCENARIOS)
        if unknown:
            raise ValueError(f"unknown scenario ids: {', '.join(sorted(unknown))}")

    def resolved_scenarios(self) -> tuple[str, ...]:
        if isinstance(self.scenarios, str):
            selection = self.scenarios.strip().lower()
            if selection == "demo":
                return tuple(DEMO_SCENARIO_CONFIGS)
            if selection in {"", "none", "off"}:
                return ()
            if selection == "all":
                return ALL_SCENARIOS
            values = tuple(
                part.strip().upper() for part in selection.split(",") if part.strip()
            )
        else:
            values = tuple(value.strip().upper() for value in self.scenarios)
        unknown = set(values) - set(ALL_SCENARIOS)
        if unknown:
            raise ValueError(f"unknown scenario ids: {', '.join(sorted(unknown))}")
        return values

    def parameters(self) -> dict[str, str]:
        """Return the normalized parameter map consumed by generation stages."""

        values = {
            "RANDOM_SEED": str(self.random_seed),
            "SCALE_FACTOR": str(self.scale_factor),
            "MOQ_FINISHED_MIN": str(self.moq_finished_min),
            "MOQ_FINISHED_MAX": str(self.moq_finished_max),
            "MOQ_RAW_MIN": str(self.moq_raw_min),
            "MOQ_RAW_MAX": str(self.moq_raw_max),
            "HUB_PLANT": self.hub_plant,
            "DELIVERY_FILL_RATE": str(self.delivery_fill_rate),
            "SAFETY_STOCK_WEEKS": str(self.safety_stock_weeks),
            "SUPPLIER_RELIABILITY_RATE": str(self.supplier_reliability_rate),
            "UNRELIABLE_MATERIALS": ",".join(self.unreliable_materials),
            "DATASET_CURRENCY": self.currency.upper(),
            "GENERATE_DIRTY_DATA": str(self.generate_dirty_data).lower(),
            "DIRTY_DATA_RATE": str(self.dirty_data_rate),
        }
        optional = {
            "NUM_CUSTOMERS": self.num_customers,
            "NUM_FINISHED_GOODS": self.num_finished_goods,
            "NUM_RAW_MATERIALS": self.num_raw_materials,
            "NUM_ORDERS": self.num_orders,
        }
        values.update(
            {key: str(value) for key, value in optional.items() if value is not None}
        )
        selected = self.resolved_scenarios()
        configs = dict(self.scenario_configs)
        if isinstance(self.scenarios, str) and self.scenarios.strip().lower() == "demo":
            configs = {**DEMO_SCENARIO_CONFIGS, **configs}
        for scenario_id in selected:
            values[f"{scenario_id}_ENABLED"] = "true"
            if scenario_id in configs:
                values[f"{scenario_id}_CONFIG"] = configs[scenario_id]
        return values
