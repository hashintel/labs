from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date, timedelta

import pandas as pd

from ..timeframe import add_months, parse_date
from . import definitions, injection


@dataclass
class ScheduledScenario:
    id: str
    config: dict
    start: date
    stop: date
    affected: int = 0
    status: str = "NO_ELIGIBLE_ACTIVITY"

    def active(self, day, plant=None, material=None):
        return (
            self.start <= day < self.stop
            and self.config.get("plant", plant) == plant
            and self.config.get("material", material) in (material, "ALL", "")
        )


PARSERS = {
    1: "standard",
    2: "standard",
    3: "fire",
    4: "shutdown",
    5: "quarantine_single",
    6: "quarantine_all",
    7: "writeoff",
    8: "transfer",
    9: "reroute",
    10: "shutdown",
    11: "demand_increase",
    12: "new_product",
    13: "expedition",
    14: "limited_capacity",
    15: "equipment_failure",
    16: "competing_production",
    17: "regulatory_freeze",
    18: "new_facility",
    19: "shortage",
    20: "high_volatility",
}


class ScenarioSchedule:
    def __init__(self, config, parameters):
        self.timeframe = config.timeframe
        self.items = []
        for sid in config.resolved_scenarios():
            number = int(sid[3:])
            value = parameters.get(f"{sid}_CONFIG", "")
            if not value:
                raise ValueError(f"{sid} requires a scenario configuration")
            parser = (
                injection.parse_config
                if number <= 10
                else injection.parse_production_config
            )
            if number >= 21:
                parsed = injection.parse_supplier_config(
                    value, "fda" if number == 23 else "standard"
                )
            else:
                parsed = parser(value, PARSERS[number])
            if parsed is None:
                raise ValueError(f"{sid} has invalid configuration: {value!r}")
            for key, val in parsed.items():
                if isinstance(val, (float, int)) and (
                    not math.isfinite(val) or val < 0
                ):
                    raise ValueError(
                        f"{sid} {key} must be finite and nonnegative; got {val}"
                    )
            for key in ("cancel_ratio", "target_otif"):
                if parsed.get(key, 0) > 1:
                    raise ValueError(f"{sid} {key} must be between zero and one")
            for key in ("capacity_pct", "contention_pct", "volatility_pct"):
                if parsed.get(key, 0) > 100:
                    raise ValueError(f"{sid} {key} must be between zero and 100")
            start = self.timeframe.start + timedelta(days=self.timeframe.days // 3)
            dated = next(
                (
                    key
                    for key in (
                        "fire_date",
                        "shutdown_date",
                        "reroute_date",
                        "start_date",
                        "failure_date",
                        "ramp_start",
                    )
                    if key in parsed
                ),
                None,
            )
            is_demo = (
                isinstance(config.scenarios, str)
                and config.scenarios.strip().lower() == "demo"
                and sid not in config.scenario_configs
            )
            if dated:
                if is_demo:
                    parsed[dated] = start.strftime("%Y%m%d")
                else:
                    raw = parsed[dated]
                    start = parse_date(
                        raw if "-" in raw else f"{raw[:4]}-{raw[4:6]}-{raw[6:]}"
                    )
            if number >= 21:
                start = add_months(
                    self.timeframe.end + timedelta(days=1), -parsed["months_affected"]
                )
            duration = next(
                (
                    parsed[key]
                    for key in (
                        "downtime_days",
                        "quarantine_days",
                        "duration_days",
                        "freeze_days",
                    )
                    if key in parsed
                ),
                None,
            )
            if number == 18:
                duration = parsed["ramp_weeks"] * 7
            stop = (
                start + timedelta(days=duration)
                if duration is not None
                else self.timeframe.end + timedelta(days=1)
            )
            item = ScheduledScenario(sid, parsed, start, stop)
            instantaneous = number in {
                1,
                2,
                3,
                5,
                6,
                7,
                8,
                9,
            } and self.timeframe.contains(start)
            if start > self.timeframe.end or (
                stop <= self.timeframe.start and not instantaneous
            ):
                item.status = "OUTSIDE_TIMEFRAME"
            self.items.append(item)

    def validate_targets(self, store):
        plants = set(store.read("t001w").WERKS)
        materials = set(store.read("mara").MATNR)
        vendors = set(store.read("lfa1").LIFNR)
        for item in self.items:
            c = item.config
            for key, universe in (
                ("plant", plants),
                ("material", materials),
                ("base_material", materials),
                ("vendor", vendors),
            ):
                value = c.get(key)
                if value and value not in universe and value != "ALL":
                    raise ValueError(f"{item.id} references unknown {key} {value!r}")
            if "materials" in c and set(c["materials"]) - materials:
                raise ValueError(f"{item.id} references unknown materials")
            if item.id == "SCN012" and c["new_material"] in materials:
                raise ValueError(
                    f"{item.id} new material {c['new_material']!r} already exists"
                )

    def mark(self, item, count=1):
        item.affected += count
        item.status = "APPLIED"

    def available(self, day, plant, operation):
        while True:
            previous = day
            for item in self.items:
                blocked = {"SCN003", "SCN009"}
                blocked |= (
                    {"SCN004", "SCN015"} if operation == "production" else {"SCN017"}
                )
                if item.id in blocked and item.active(day, plant):
                    day = max(day, item.stop)
                    self.mark(item)
                if (
                    item.id == "SCN018"
                    and plant == item.config["new_plant"]
                    and day < item.start
                ):
                    day = item.start
            if day == previous:
                return day

    def production_days(self, day, plant, material, days):
        for item in self.items:
            if not item.active(day, plant):
                continue
            if item.id == "SCN010":
                days *= 2
                self.mark(item)
            elif item.id == "SCN014":
                days += math.ceil(days * item.config["capacity_pct"] / 100)
                self.mark(item)
            elif item.id == "SCN016" and material in item.config["materials"]:
                days += math.ceil(days * item.config["contention_pct"] / 100)
                self.mark(item)
            elif item.id == "SCN018" and plant == item.config["new_plant"]:
                progress = (day - item.start).days / max(
                    1, (item.stop - item.start).days
                )
                days = math.ceil(days / min(1, 0.2 + 0.8 * progress))
                self.mark(item)
        return days

    def production_finish(self, start, plant, material):
        finish = start + timedelta(days=self.production_days(start, plant, material, 3))
        interruptions = sorted(
            (
                i
                for i in self.items
                if i.id in {"SCN003", "SCN004", "SCN009", "SCN015"}
                and i.config.get("plant") == plant
            ),
            key=lambda i: i.start,
        )
        covered_until = start
        for item in interruptions:
            left = max(start, item.start, covered_until)
            if left < finish and item.stop > left:
                finish += item.stop - left
                covered_until = item.stop
                self.mark(item)
        return finish

    def supplier(self, vendor, material, planned, rng):
        rate, sid = 0.95, ""
        for item in self.items:
            c = item.config
            if int(item.id[3:]) < 21 or not item.start <= planned < item.stop:
                continue
            if c["vendor"] != vendor or c["material"] not in (material, "ALL", ""):
                continue
            sid = item.id
            self.mark(item)
            if item.id != "SCN023":
                progress = min(
                    1,
                    max(
                        0,
                        (planned - item.start).days
                        / max(1, (item.stop - item.start).days - 1),
                    ),
                )
                initial = 0.6 if item.id == "SCN026" else 0.95
                rate = initial + (c["target_otif"] - initial) * progress
        failed = rng.random() > rate
        late = failed and rng.random() < 0.6
        partial = failed and (not late or rng.random() < 0.4)
        return (
            planned + timedelta(days=rng.randint(3, 14) if late else 0),
            rng.uniform(0.6, 0.95) if partial else 1.0,
            sid,
        )

    def save(self, store):
        catalog = pd.DataFrame(definitions.scenarios)
        for item in self.items:
            mask = catalog.SCENARIO_ID == item.id
            catalog.loc[mask, "IMPACT_DATE"] = item.start.strftime("%Y%m%d")
            catalog.loc[mask, "IMPACT_DURATION_DAYS"] = max(
                0, (item.stop - item.start).days
            )
            for column, key in (
                ("IMPACTED_NODE", "plant"),
                ("IMPACTED_PRODUCTS", "material"),
                ("IMPACTED_SUPPLIER", "vendor"),
            ):
                if key in item.config:
                    catalog.loc[mask, column] = item.config[key]
        store.save(
            "scenario_config",
            catalog[catalog.SCENARIO_ID.isin([item.id for item in self.items])],
        )
        rows = [
            {
                "SCENARIO_ID": i.id,
                "IMPACT_DATE": i.start.strftime("%Y%m%d"),
                "RECOVERY_DATE": i.stop.strftime("%Y%m%d"),
                "STATUS": i.status,
                "AFFECTED_EVENTS": i.affected,
            }
            for i in self.items
        ]
        if rows:
            store.save("scenario_metadata", pd.DataFrame(rows))
