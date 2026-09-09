import unittest
from contextlib import redirect_stdout
from datetime import date
from io import StringIO
from tempfile import TemporaryDirectory
from typing import ClassVar
from unittest.mock import patch

from sap_mock_data import GenerationConfig, Timeframe, generate_dataset
from sap_mock_data.generation.scheduled import Schedule
from sap_mock_data.storage import DeltaTableStore, MemoryTableStore
from sap_mock_data.validation.manifest import build_manifest
from sap_mock_data.validation.temporal import temporal_report


def generate(timeframe, **kwargs):
    store = MemoryTableStore()
    config = GenerationConfig(
        timeframe=timeframe, **{"scale_factor": "S", "scenarios": "none", **kwargs}
    )
    with redirect_stdout(StringIO()):
        generate_dataset(config, store)
    return store


class TimeframeTests(unittest.TestCase):
    def test_inclusive_dates_and_day_durations(self):
        self.assertEqual(Timeframe("2026-01-05", end="2026-05-02").days, 118)
        self.assertEqual(
            Timeframe("2026-01-05", duration_days=14).end, date(2026, 1, 18)
        )
        self.assertEqual(
            Timeframe("2026-01-05", duration_days=151).end, date(2026, 6, 4)
        )
        self.assertEqual(
            Timeframe("2024-01-31", duration_days=30).end, date(2024, 2, 29)
        )
        self.assertEqual(
            Timeframe("2026-01-31", duration_days=30).end, date(2026, 3, 1)
        )
        self.assertEqual(
            Timeframe("2024-02-28", duration_days=2).end, date(2024, 2, 29)
        )

    def test_invalid_inputs(self):
        for kwargs in (
            {},
            {"end": "2026-01-01"},
            {"end": "2026-02-01", "duration_days": 14},
            {"duration_days": 0},
            {"duration_days": -1},
            {"duration_days": 1.5},
            {"duration_days": 14.0},
            {"duration_days": True},
            {"duration_days": False},
            {"duration_days": "14"},
            {"duration_days": "14 days"},
            {"end": "2026-02-30"},
            {"duration_days": 10000000000},
        ):
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                Timeframe("2026-01-05", **kwargs)

    def test_scale_and_override(self):
        timeframe = Timeframe("2026-01-05", end="2026-05-02")
        config = GenerationConfig(timeframe=timeframe)
        self.assertEqual(
            int(config.parameters()["NUM_ORDERS"]), round(5000 * 118 / 365)
        )
        small = GenerationConfig(timeframe=timeframe, scale_factor="S")
        annual = GenerationConfig(scale_factor="S")
        for key in (
            "NUM_CUSTOMERS",
            "NUM_FINISHED_GOODS",
            "NUM_RAW_MATERIALS",
            "NUM_VENDORS",
            "NUM_SITES",
        ):
            self.assertEqual(small.parameters()[key], annual.parameters()[key])
        self.assertEqual(
            int(small.parameters()["NUM_ORDERS"]),
            round(int(annual.parameters()["NUM_ORDERS"]) * 118 / 365),
        )
        self.assertEqual(
            GenerationConfig(timeframe=timeframe, num_orders=7).parameters()[
                "NUM_ORDERS"
            ],
            "7",
        )

    def test_month_periods_cover_only_requested_dates(self):
        periods = list(Timeframe("2026-01-05", end="2026-05-02").periods())
        self.assertEqual(periods[0], (date(2026, 1, 5), date(2026, 1, 31)))
        self.assertEqual(periods[-1], (date(2026, 5, 1), date(2026, 5, 2)))
        self.assertEqual(len(periods), 5)


class ScheduledGenerationTests(unittest.TestCase):
    def test_empty_short_window_and_delta_storage(self):
        timeframe = Timeframe("2026-01-05", duration_days=1)
        with TemporaryDirectory() as path, redirect_stdout(StringIO()):
            store = DeltaTableStore(path)
            generate_dataset(
                GenerationConfig(
                    timeframe=timeframe, scale_factor=0.001, scenarios="none"
                ),
                store,
            )
            self.assertEqual(len(store.read("vbak")), 0)
            self.assertEqual(len(store.read("matdoc")), 0)
            self.assertIn("AUFNR", store.read("afko"))
            self.assertTrue(temporal_report(store, timeframe)["ok"])

    def test_late_orders_remain_open(self):
        store = generate(
            Timeframe("2026-05-02", duration_days=1),
            num_orders=10,
            delivery_fill_rate=1,
        )
        self.assertEqual(len(store.read("vbak")), 10)
        self.assertTrue(store.read("vbak").VDATU.eq("20260509").all())
        self.assertTrue(store.read("vbap").LFSTA.eq("A").all())
        self.assertEqual(len(store.read("likp")), 0)

    def test_year_boundary_and_stock_reconciliation(self):
        timeframe = Timeframe("2025-12-20", duration_days=151)
        store = generate(timeframe, num_orders=600, num_sites=5, delivery_fill_rate=1)
        self.assertGreater(len(store.read("afko")), 0)
        self.assertGreater(len(store.read("resb")), 0)
        self.assertEqual(set(store.read("matdoc").MJAHR), {"2025", "2026"})
        self.assertTrue(temporal_report(store, timeframe)["ok"])
        self.assertFalse(store.read("mardh").LFMON.eq("05").any())

    def test_reproducible_with_explicit_dates(self):
        timeframe = Timeframe("2026-01-05", duration_days=14)
        first = generate(timeframe, scenarios="demo")
        second = generate(timeframe, scenarios="demo")
        self.assertEqual(build_manifest(first), build_manifest(second))

    def test_shorter_timeframes_construct_less_activity(self):
        stores = [
            generate(Timeframe("2026-01-05", duration_days=duration_days))
            for duration_days in (14, 151, 365)
        ]
        counts = [s.read("generation_metadata").iloc[0] for s in stores]
        self.assertLess(counts[0].EVENTS_PROCESSED, counts[1].EVENTS_PROCESSED)
        self.assertLess(counts[1].EVENTS_PROCESSED, counts[2].EVENTS_PROCESSED)
        for store, metadata in zip(stores, counts):
            self.assertEqual(metadata.BASELINE_ORDERS, len(store.read("vbak")))
            self.assertEqual(metadata.EVENTS_SCHEDULED, metadata.EVENTS_PROCESSED)
        self.assertEqual(
            [len(s.read("mara")) for s in stores], [len(stores[0].read("mara"))] * 3
        )

    def test_production_waits_for_components(self):
        original = Schedule._opening_batches

        def remove_stock(schedule):
            original(schedule)
            schedule.initial["LABST"] = 0.0

        timeframe = Timeframe("2026-01-05", duration_days=151)
        with patch.object(Schedule, "_opening_batches", remove_stock):
            store = generate(timeframe, num_orders=200, delivery_fill_rate=1)
        self.assertGreater(len(store.read("ekbe")), 0)
        self.assertTrue(temporal_report(store, timeframe)["ok"])
        movements = store.read("matdoc")
        components = movements[movements.BWART.eq("261")]
        self.assertGreater(len(components), 0)
        for material, rows in components.groupby("MATNR"):
            receipts = movements[
                movements.MATNR.eq(material) & movements.BWART.eq("101")
            ]
            self.assertLessEqual(receipts.BUDAT.min(), rows.BUDAT.min())

    def test_validator_detects_cross_document_corruption(self):
        timeframe = Timeframe("2026-01-05", duration_days=151)
        store = generate(timeframe, delivery_fill_rate=1)
        shipments = store.read("vttk")
        shipments.loc[0, "DATBG"] = "20200101"
        store.save("vttk", shipments)
        self.assertFalse(temporal_report(store, timeframe)["ok"])

    def test_validator_detects_quantity_corruption(self):
        timeframe = Timeframe("2026-01-05", duration_days=151)
        store = generate(timeframe, delivery_fill_rate=1)
        stock = store.read("mard")
        stock.loc[0, "LABST"] += 100
        store.save("mard", stock)
        report = temporal_report(store, timeframe)
        self.assertFalse(report["ok"])
        self.assertTrue(any("closing stock" in e for e in report["errors"]))

    def test_medium_year_aggregates_repeated_bom_components(self):
        timeframe = Timeframe("2026-01-05", duration_days=365)
        store = generate(timeframe, scale_factor="M")
        reservations = store.read("resb")
        self.assertFalse(reservations.duplicated(["AUFNR", "MATNR"]).any())
        self.assertTrue(temporal_report(store, timeframe)["ok"])

    def test_timeframe_does_not_call_legacy_history_generator(self):
        with patch(
            "sap_mock_data.api.transactions.generate",
            side_effect=AssertionError("legacy history generator called"),
        ):
            generate(Timeframe("2026-01-05", duration_days=14))


class ScenarioTimeframeTests(unittest.TestCase):
    CONFIGS: ClassVar[dict[str, str]] = {
        "SCN001": "MAT-A0001,1000,FG01,500",
        "SCN002": "MAT-A0001,1000,FG01,500",
        "SCN003": "1000,ALL,20260201,30",
        "SCN004": "1000,20260201,14",
        "SCN005": "MAT-A0001,1000,FG01,ALL,500,14",
        "SCN006": "MAT-A0001,14",
        "SCN007": "MAT-A0001,1000,FG01,ALL,500",
        "SCN008": "ALL,1000,FG01,QA01,500",
        "SCN009": "1000,ALL,20260201,14",
        "SCN010": "1000,20260201,14",
        "SCN011": "MAT-A0001,1000,25,20260201",
        "SCN012": "MAT-NEW01,1000,MAT-A0001",
        "SCN013": "MAT-A0001,1000,500,20260401",
        "SCN014": "1000,95,30",
        "SCN015": "1000,20260201,7,0.3",
        "SCN016": "1000,MAT-A0001;MAT-A0020,30",
        "SCN017": "1000,20260201,14",
        "SCN018": "6000,20260201,8",
        "SCN019": "MAT-A0001,1000,100,30",
        "SCN020": "40,30",
        "SCN021": "VEND-0001,ALL,0.72,3",
        "SCN022": "VEND-0001,ALL,0.65,3",
        "SCN023": "VEND-0001,API1",
        "SCN024": "VEND-0001,ALL,0.68,3",
        "SCN025": "VEND-0001,ALL,0.60,3",
        "SCN026": "VEND-0001,ALL,0.85,3",
    }

    def test_each_scenario_preserves_temporal_consistency(self):
        timeframe = Timeframe("2026-01-05", duration_days=151)
        for sid, value in self.CONFIGS.items():
            with self.subTest(scenario=sid):
                store = generate(
                    timeframe,
                    scenarios=[sid],
                    scenario_configs={sid: value},
                    num_orders=150,
                )
                self.assertTrue(temporal_report(store, timeframe)["ok"])
                self.assertEqual(
                    store.read("scenario_metadata").SCENARIO_ID.tolist(), [sid]
                )

    def test_scenarios_combine(self):
        timeframe = Timeframe("2026-01-05", duration_days=151)
        store = generate(
            timeframe, scenarios="all", scenario_configs=self.CONFIGS, num_orders=300
        )
        self.assertTrue(temporal_report(store, timeframe)["ok"])
        self.assertEqual(len(store.read("scenario_metadata")), 26)

    def test_outside_scenario_is_reported(self):
        store = generate(
            Timeframe("2026-01-05", duration_days=14),
            scenarios=["SCN003"],
            scenario_configs={"SCN003": "1000,ALL,20250615,30"},
        )
        self.assertEqual(
            store.read("scenario_metadata").STATUS.tolist(), ["OUTSIDE_TIMEFRAME"]
        )

    def test_carry_in_fire_changes_opening_state(self):
        timeframe = Timeframe("2026-01-05", duration_days=14)
        store = generate(
            timeframe,
            num_sites=1,
            scenarios=["SCN003"],
            scenario_configs={"SCN003": "1000,ALL,20251225,30"},
        )
        self.assertEqual(store.read("opening_stock").LABST.sum(), 0)
        self.assertFalse(store.read("matdoc").BKTXT.eq("SCN003").any())
        self.assertEqual(
            store.read("scenario_metadata").IMPACT_DATE.iloc[0], "20251225"
        )
        self.assertTrue(temporal_report(store, timeframe)["ok"])

    def test_zero_day_fire_still_destroys_inventory(self):
        store = generate(
            Timeframe("2026-01-05", duration_days=1),
            scenarios=["SCN003"],
            scenario_configs={"SCN003": "1000,ALL,20260105,0"},
        )
        self.assertTrue(store.read("matdoc").BKTXT.eq("SCN003").any())

    def test_disruption_extends_beyond_end_without_future_postings(self):
        timeframe = Timeframe("2026-01-05", duration_days=14)
        store = generate(
            timeframe,
            scenarios=["SCN003"],
            scenario_configs={"SCN003": "1000,ALL,20260105,30"},
            num_orders=100,
            delivery_fill_rate=1,
            num_sites=1,
        )
        self.assertTrue(temporal_report(store, timeframe)["ok"])
        self.assertTrue(store.read("vbap").LFSTA.eq("A").all())
        self.assertEqual(
            store.read("scenario_metadata").RECOVERY_DATE.iloc[0], "20260204"
        )
