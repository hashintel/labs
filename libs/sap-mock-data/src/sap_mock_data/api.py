"""Public orchestration API."""

from __future__ import annotations

import threading
from datetime import datetime, timezone

import pandas as pd

from .config import GenerationConfig
from .context import GenerationContext
from .generation import masterdata, transactions
from .result import GenerationResult
from .scenarios import definitions, injection
from .storage import TableStore

_GENERATION_LOCK = threading.RLock()


def _seed_empty_resb(store: TableStore) -> None:
    if store.exists("resb"):
        return
    frame = pd.DataFrame(
        {
            "MANDT": pd.Series(dtype="string"),
            "RSNUM": pd.Series(dtype="string"),
            "RSPOS": pd.Series(dtype="string"),
            "AUFNR": pd.Series(dtype="string"),
            "MATNR": pd.Series(dtype="string"),
            "BDMNG": pd.Series(dtype="float64"),
            "ENMNG": pd.Series(dtype="float64"),
            "WERKS": pd.Series(dtype="string"),
            "LGORT": pd.Series(dtype="string"),
        }
    )
    store.save("resb", frame)


def generate_dataset(config: GenerationConfig, store: TableStore) -> GenerationResult:
    """Generate a complete dataset into *store* and return a run summary."""

    started_at = datetime.now(timezone.utc)
    selected_scenarios = config.resolved_scenarios()
    context = GenerationContext(config)
    with _GENERATION_LOCK, context.activate():
        masterdata.generate(store)
        transactions.generate(store)
        if selected_scenarios:
            configless = [
                scenario_id
                for scenario_id in selected_scenarios
                if not context.parameters.get(f"{scenario_id}_CONFIG", "").strip()
            ]
            if configless:
                print(
                    "[sap-mock] WARNING: enabled without configuration; the "
                    f"upstream behavior skips these scenarios: {', '.join(configless)}"
                )
            definitions.generate(store)
            injection.generate(store)
        _seed_empty_resb(store)

    tables = tuple(store.tables())
    row_counts = {name: len(store.read(name)) for name in tables}
    return GenerationResult(
        tables=tables,
        row_counts=row_counts,
        scenarios=selected_scenarios,
        started_at=started_at,
        finished_at=datetime.now(timezone.utc),
    )
