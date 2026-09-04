"""The ``sap-mock`` command."""

from __future__ import annotations

import argparse
import json
import math
from importlib.metadata import version
from pathlib import Path
from typing import Sequence

from .. import GenerationConfig, generate_dataset
from ..config import SIZE_KNOB_RANGES
from ..storage import DeltaTableStore
from ..validation import build_manifest, integrity_report


def _scale_factor(value: str) -> float | str:
    try:
        number = float(value)
    except ValueError:
        letter = value.strip().upper()
        if letter in SIZE_KNOB_RANGES:
            return letter
        raise argparse.ArgumentTypeError(
            f"must be a positive number or one of {', '.join(SIZE_KNOB_RANGES)}; "
            f"got {value!r}"
        )
    if not (number > 0 and math.isfinite(number)):
        raise argparse.ArgumentTypeError(f"must be a positive finite number; got {value}")
    return number


def _scenario_configs(values: Sequence[str]) -> dict[str, str]:
    configs: dict[str, str] = {}
    for value in values:
        scenario_id, separator, config = value.partition("=")
        if not separator:
            raise argparse.ArgumentTypeError(
                f"scenario config must be SCNxxx=value, got {value!r}"
            )
        configs[scenario_id.upper()] = config
    return configs


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="sap-mock", description="Generate and inspect synthetic SAP Delta tables."
    )
    parser.add_argument(
        "--version", action="version", version=f"%(prog)s {version('sap-mock-data')}"
    )
    commands = parser.add_subparsers(dest="command", required=True)

    generate = commands.add_parser("generate", help="generate a dataset")
    generate.add_argument("output", type=Path, help="Delta warehouse directory")
    generate.add_argument("--seed", type=int, default=42)
    generate.add_argument(
        "--scale-factor",
        type=_scale_factor,
        default=1.0,
        help="numeric multiplier, or a dataset size: S, M, L, XL",
    )
    generate.add_argument("--orders", type=int)
    generate.add_argument("--customers", type=int)
    generate.add_argument("--finished-goods", type=int)
    generate.add_argument("--raw-materials", type=int)
    generate.add_argument("--vendors", type=int)
    generate.add_argument("--sites", type=int)
    generate.add_argument("--currency", default="EUR")
    generate.add_argument(
        "--scenarios",
        default="demo",
        help="demo, none, all, or a comma-separated SCNxxx list",
    )
    generate.add_argument(
        "--scenario-config",
        action="append",
        default=[],
        metavar="SCNxxx=VALUE",
        help="scenario configuration; repeat for multiple scenarios",
    )
    generate.add_argument("--dirty-data", action="store_true")
    generate.add_argument("--dirty-data-rate", type=float, default=0.05)
    generate.add_argument(
        "--manifest", type=Path, help="write a canonical JSON manifest after generation"
    )

    manifest = commands.add_parser("manifest", help="describe an existing warehouse")
    manifest.add_argument("warehouse", type=Path)
    manifest.add_argument("--output", type=Path)
    manifest.add_argument("--integrity", action="store_true")
    return parser


def _write_json(payload: object, output: Path | None) -> None:
    rendered = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    if output:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(rendered)
    else:
        print(rendered, end="")


def main(argv: Sequence[str] | None = None) -> int:
    parser = _parser()
    args = parser.parse_args(argv)
    if args.command == "generate":
        try:
            scenario_configs = _scenario_configs(args.scenario_config)
            config = GenerationConfig(
                random_seed=args.seed,
                scale_factor=args.scale_factor,
                num_orders=args.orders,
                num_customers=args.customers,
                num_finished_goods=args.finished_goods,
                num_raw_materials=args.raw_materials,
                num_vendors=args.vendors,
                num_sites=args.sites,
                currency=args.currency,
                scenarios=args.scenarios,
                scenario_configs=scenario_configs,
                generate_dirty_data=args.dirty_data,
                dirty_data_rate=args.dirty_data_rate,
            )
        except (argparse.ArgumentTypeError, ValueError) as error:
            parser.error(str(error))
        store = DeltaTableStore(args.output)
        result = generate_dataset(config, store)
        print(
            f"[sap-mock] generated {result.table_count} tables and "
            f"{sum(result.row_counts.values())} rows in {args.output.resolve()}"
        )
        if args.manifest:
            _write_json(build_manifest(store), args.manifest)
        return 0

    store = DeltaTableStore(args.warehouse)
    payload: dict[str, object] = build_manifest(store)
    if args.integrity:
        payload["integrity"] = integrity_report(store)
    _write_json(payload, args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
