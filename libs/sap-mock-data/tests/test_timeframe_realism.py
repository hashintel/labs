import unittest
from datetime import date
from unittest.mock import patch

import pandas as pd
from test_timeframe import generate

from sap_mock_data import GenerationConfig, Timeframe
from sap_mock_data.generation.scheduled import Schedule
from sap_mock_data.scenarios.scheduling import ScenarioSchedule
from sap_mock_data.validation import temporal_report
from sap_mock_data.validation.manifest import build_manifest


class TimeframeRealismTests(unittest.TestCase):
    def test_component_replenishment_prevents_months_of_baseline_backlog(self):
        timeframe = Timeframe("2026-01-05", duration_days=365)
        store = generate(timeframe, scale_factor="M")
        shipments = (
            store.read("lips")
            .merge(store.read("likp")[["VBELN", "WADAT_IST"]], on="VBELN")
            .merge(
                store.read("vbak")[["VBELN", "VDATU"]],
                left_on="VGBEL",
                right_on="VBELN",
            )
        )
        late = pd.to_datetime(shipments.WADAT_IST) - pd.to_datetime(shipments.VDATU)
        self.assertLessEqual(late.dt.days.max(), 60)
        eligible = store.read("vbap").query("ZZ_FULFILLMENT_REASON != 'Delivery block'")
        self.assertGreater(eligible.LFSTA.eq("C").mean(), 0.97)
        self.assertTrue(temporal_report(store, timeframe)["ok"])

    def test_smaller_orders_do_not_overtake_an_order_waiting_for_stock(self):
        opening_batches, sales_order = Schedule._opening_batches, Schedule.sales_order

        def set_stock(schedule):
            opening_batches(schedule)
            mask = schedule.initial.MATNR.eq("MAT-A0001") & schedule.initial.WERKS.eq(
                "1000"
            )
            schedule.initial.loc[mask, "LABST"] = 0
            schedule.initial.loc[schedule.initial[mask].index[0], "LABST"] = 600

        def place_order(schedule, day):
            index = len(schedule.rows["vbak"])
            sales_order(
                schedule,
                date(2026, 1, 5 + index),
                "MAT-A0001",
                "1000",
                900 if index == 0 else 100,
                due=date(2026, 1, 6 + index),
            )

        timeframe = Timeframe("2026-01-05", duration_days=60)
        with (
            patch.object(Schedule, "_opening_batches", set_stock),
            patch.object(Schedule, "sales_order", place_order),
        ):
            store = generate(timeframe, num_orders=2, delivery_fill_rate=1)
        self.assertTrue(store.read("vbap").LFSTA.eq("C").all())
        shipments = store.read("lips").merge(store.read("likp"), on="VBELN")
        dispatch = shipments.groupby("VGBEL").WADAT_IST.min().sort_index()
        self.assertLessEqual(dispatch.iloc[0], dispatch.iloc[1])
        self.assertTrue(temporal_report(store, timeframe)["ok"])

    def test_baseline_demand_only_uses_open_facilities(self):
        timeframe = Timeframe("2026-01-05", duration_days=118)
        for opening in ("20260301", "20260105"):
            with self.subTest(opening=opening):
                store = generate(
                    timeframe,
                    scale_factor="M",
                    scenarios=["SCN018"],
                    scenario_configs={"SCN018": f"6000,{opening},12"},
                )
                items = store.read("vbap").merge(store.read("vbak"), on="VBELN")
                new_plant = items[items.WERKS.eq("6000")]
                self.assertTrue(new_plant.ERDAT.ge(opening).all())
                self.assertFalse(new_plant.empty)
                self.assertTrue(temporal_report(store, timeframe)["ok"])

    def test_outside_facility_ramps_match_generation_without_the_scenario(self):
        timeframe = Timeframe("2026-01-05", duration_days=118)
        options = {"num_sites": 6, "num_orders": 600, "delivery_fill_rate": 1}
        baseline = generate(timeframe, **options)
        expected = build_manifest(baseline)["tables"]
        self.assertTrue(baseline.read("vbap").WERKS.eq("6000").any())
        self.assertTrue(baseline.read("plaf").WERKS.eq("6000").any())
        for ramp in (
            "6000,20250101,12",
            "6000,20270101,12",
            "6000,20251229,1",
            "6000,20260503,1",
        ):
            with self.subTest(ramp=ramp):
                store = generate(
                    timeframe,
                    **options,
                    scenarios=["SCN018"],
                    scenario_configs={"SCN018": ramp},
                )
                actual = build_manifest(store)["tables"]
                for name in expected.keys() - {
                    "generation_metadata",
                    "scenario_config",
                }:
                    self.assertEqual(actual[name], expected[name], name)
                metadata = store.read("scenario_metadata").iloc[0]
                self.assertEqual(metadata.STATUS, "OUTSIDE_TIMEFRAME")
                self.assertEqual(metadata.AFFECTED_EVENTS, 0)
                config = GenerationConfig(
                    timeframe=timeframe,
                    scenarios=["SCN018"],
                    scenario_configs={"SCN018": ramp},
                )
                schedule = ScenarioSchedule(config, config.parameters())
                for day in (timeframe.start, schedule.items[0].start):
                    self.assertEqual(schedule.available(day, "6000", "production"), day)
                    self.assertEqual(
                        schedule.production_days(day, "6000", "MAT-A0001", 3), 3
                    )

    def test_overlapping_quarantines_keep_stock_held_until_recovery(self):
        timeframe = Timeframe("2026-01-01", duration_days=30)
        for scenarios in (["SCN005", "SCN006"], ["SCN006", "SCN005"]):
            for single_days, all_days in ((2, 15), (15, 2)):
                with self.subTest(scenarios=scenarios, single_days=single_days):
                    store = generate(
                        timeframe,
                        num_orders=1,
                        delivery_fill_rate=0,
                        scenarios=scenarios,
                        scenario_configs={
                            "SCN005": f"MAT-A0001,1000,FG01,ALL,10,{single_days}",
                            "SCN006": f"MAT-A0001,{all_days}",
                        },
                    )
                    moves = store.read("matdoc")
                    opening = store.read("opening_stock")
                    stock = opening.loc[
                        opening.MATNR.eq("MAT-A0001") & opening.WERKS.eq("1000"),
                        "LABST",
                    ].sum()
                    releases = moves[
                        moves.MATNR.eq("MAT-A0001")
                        & moves.WERKS.eq("1000")
                        & moves.LGORT.eq("FG01")
                        & moves.SHKZG.eq("S")
                        & moves.BKTXT.isin(scenarios)
                    ]
                    self.assertEqual(
                        releases.loc[releases.BUDAT.lt("20260126"), "MENGE"].sum(),
                        0 if all_days == 15 else stock - 10,
                    )
                    self.assertEqual(releases.MENGE.sum(), stock)
                    self.assertTrue(temporal_report(store, timeframe)["ok"])

    def test_partial_shutdown_only_reduces_capacity_during_overlap(self):
        for start, finish in ((5, 9), (7, 11), (8, 11)):
            with self.subTest(start=start):
                config = GenerationConfig(
                    timeframe=Timeframe("2026-01-01", duration_days=30),
                    scenarios=["SCN010"],
                    scenario_configs={"SCN010": "1000,20260106,2"},
                )
                schedule = ScenarioSchedule(config, config.parameters())
                self.assertEqual(
                    schedule.production_finish(
                        date(2026, 1, start), "1000", "MAT-A0001"
                    ),
                    date(2026, 1, finish),
                )

    def test_production_requires_complete_unique_bom_reservations(self):
        timeframe = Timeframe("2026-01-05", duration_days=151)
        store = generate(
            timeframe,
            scenarios=["SCN014"],
            scenario_configs={"SCN014": "1000,95,30"},
            random_seed=7,
        )
        reservations = store.read("resb")
        self.assertFalse(reservations.empty)
        self.assertTrue(temporal_report(store, timeframe)["ok"])
        duplicate = reservations.iloc[[0]].assign(RSNUM="9999999999")
        for broken in (
            reservations.iloc[:0],
            reservations.iloc[1:],
            pd.concat([reservations, duplicate], ignore_index=True),
        ):
            store.save("resb", broken)
            report = temporal_report(store, timeframe)
            self.assertFalse(report["ok"])
            self.assertTrue(
                any("BOM reservations" in error for error in report["errors"])
            )

    def test_stock_covered_sales_do_not_create_component_purchases(self):
        store = generate(Timeframe("2026-01-05", duration_days=118))
        self.assertTrue(store.read("afko").empty)
        self.assertTrue(store.read("ekpo").empty)
        self.assertTrue(store.read("ekbe").empty)

    def test_routes_end_at_customers_and_allow_time_for_transit(self):
        timeframe = Timeframe("2026-01-05", duration_days=118)
        store = generate(timeframe, scale_factor="M", delivery_fill_rate=1)
        customers = store.read("kna1").set_index("KUNNR")
        deliveries = store.read("likp").set_index("VBELN")
        legs = store.read("vtts").set_index("TKNUM")
        links = store.read("vttp")
        self.assertFalse(links.empty)
        for row in links.itertuples():
            customer = deliveries.loc[row.VBELN, "KUNNR"]
            self.assertEqual(legs.loc[row.TKNUM, "KNOTB"], customer)
            self.assertIn(customer, customers.index)
        self.assertTrue(
            customers.loc[customers.LAND1.eq("GB"), "ORT01"].eq("Manchester").all()
        )
        orders = store.read("vbak").set_index("VBELN")
        for line in store.read("lips").itertuples():
            order, delivery = orders.loc[line.VGBEL], deliveries.loc[line.VBELN]
            lead = (
                date.fromisoformat(order.VDATU) - date.fromisoformat(order.ERDAT)
            ).days
            transit = (
                date.fromisoformat(delivery.LFDAT)
                - date.fromisoformat(delivery.WADAT_IST)
            ).days
            self.assertGreaterEqual(lead, transit + 2)
        self.assertTrue(temporal_report(store, timeframe)["ok"])
        broken = store.read("vtts")
        broken.loc[0, "KNOTB"] = "1000"
        store.save("vtts", broken)
        self.assertFalse(temporal_report(store, timeframe)["ok"])

    def test_delivery_blocks_are_explicit_and_unconfirmed(self):
        store = generate(
            Timeframe("2026-01-05", duration_days=118), delivery_fill_rate=0
        )
        self.assertTrue(
            store.read("vbap").ZZ_FULFILLMENT_REASON.eq("Delivery block").all()
        )
        self.assertTrue(store.read("vbep").BMENG.eq(0).all())
        self.assertTrue(store.read("likp").empty)

    def test_capacity_pressure_occupies_production_lines(self):
        for scale in ("S", "M"):
            with self.subTest(scale=scale):
                store = generate(
                    Timeframe("2026-01-05", duration_days=151),
                    scale_factor=scale,
                    random_seed=7,
                    scenarios=["SCN014"],
                    scenario_configs={"SCN014": "1000,95,30"},
                )
                meta = store.read("scenario_metadata").iloc[0]
                start, stop = (
                    pd.to_datetime(meta.IMPACT_DATE),
                    pd.to_datetime(meta.RECOVERY_DATE),
                )
                production = store.read("afko")
                production = production[
                    production.WERKS.eq("1000") & production.GSTRI.ne("")
                ]
                begin = pd.to_datetime(production.GSTRI).clip(lower=start)
                end = pd.to_datetime(production.GLTRP).clip(upper=stop)
                busy = (end - begin).dt.days.clip(lower=0).sum()
                lines = (
                    store.read("production_capacity")
                    .set_index("WERKS")
                    .loc["1000", "PARALLEL_LINES"]
                )
                self.assertGreaterEqual(busy / (lines * 30), 0.9)
                self.assertLessEqual(busy / (lines * 30), 1)
                self.assertTrue(
                    temporal_report(store, Timeframe("2026-01-05", duration_days=151))[
                        "ok"
                    ]
                )

    def test_bom_grams_convert_to_stock_units(self):
        timeframe = Timeframe("2026-01-05", duration_days=151)
        store = generate(
            timeframe,
            random_seed=7,
            scenarios=["SCN014"],
            scenario_configs={"SCN014": "1000,95,30"},
        )
        units = store.read("marm").query("MATNR == 'API1'").set_index("MEINH")
        grams_per_piece = units.loc["PC", "BRGEW"] * 1000
        self.assertAlmostEqual(
            units.loc["GRM", "UMREZ"] / units.loc["GRM", "UMREN"], 1 / grams_per_piece
        )
        production = store.read("afko").query("MATNR == 'B1_TAB1'")
        self.assertFalse(production.empty)
        order = production.iloc[0]
        reservation = (
            store.read("resb")
            .query("AUFNR == @order.AUFNR and MATNR == 'API1'")
            .iloc[0]
        )
        self.assertAlmostEqual(reservation.BDMNG, order.GAMNG * 500 / grams_per_piece)
        self.assertTrue(temporal_report(store, timeframe)["ok"])

    def test_shortage_leaves_evidence_even_after_fulfilment(self):
        for scale in ("S", "M"):
            with self.subTest(scale=scale):
                store = generate(
                    Timeframe("2026-01-05", duration_days=151),
                    scale_factor=scale,
                    random_seed=7,
                    scenarios=["SCN019"],
                    scenario_configs={"SCN019": "MAT-A0001,1000,100,30"},
                )
                orders = store.read("vbak").query("ZZ_SCENARIO == 'SCN019'")
                items = store.read("vbap")
                urgent = items[items.VBELN.isin(orders.VBELN)]
                self.assertTrue(urgent.ZZ_STOCK_WAIT_DATE.ne("").any())

    def test_replenishment_produces_only_the_missing_quantity_or_minimum_lot(self):
        original = Schedule._opening_batches

        def set_finished_stock(schedule):
            original(schedule)
            mask = schedule.initial.MATNR.eq("MAT-A0001") & schedule.initial.WERKS.eq(
                "1000"
            )
            schedule.initial.loc[mask, "LABST"] = 0
            schedule.initial.loc[schedule.initial[mask].index[0], "LABST"] = 600

        with patch.object(Schedule, "_opening_batches", set_finished_stock):
            store = generate(
                Timeframe("2026-01-05", duration_days=30),
                scale_factor=0.001,
                delivery_fill_rate=1,
                scenarios=["SCN013"],
                scenario_configs={"SCN013": "MAT-A0001,1000,900,20260110"},
            )
        orders = store.read("afko").query("MATNR == 'MAT-A0001'")
        minimum = (
            store.read("marc")
            .query("MATNR == 'MAT-A0001' and WERKS == '1000'")
            .BSTMI.iloc[0]
        )
        self.assertEqual(len(orders), 1)
        self.assertEqual(orders.GAMNG.iloc[0], max(300, minimum))

    def test_finished_stock_and_deliveries_are_whole_pieces(self):
        timeframe = Timeframe("2026-01-05", duration_days=365)
        store = generate(timeframe, scale_factor="M")
        finished = set(store.read("mara").query("MTART == 'FERT'").MATNR)
        for table, quantity in (
            ("opening_stock", "LABST"),
            ("mard", "LABST"),
            ("matdoc", "MENGE"),
            ("lips", "LFIMG"),
        ):
            rows = store.read(table)
            values = rows.loc[rows.MATNR.isin(finished), quantity]
            self.assertFalse(values.empty)
            self.assertTrue((values - values.round()).abs().lt(1e-7).all(), table)
        self.assertTrue(temporal_report(store, timeframe)["ok"])

    def test_capacity_reporting_distinguishes_scheduled_and_started_work(self):
        timeframe = Timeframe("2026-01-05", duration_days=1)
        store = generate(
            timeframe,
            scenarios=["SCN004", "SCN014"],
            scenario_configs={"SCN004": "1000,20260105,30", "SCN014": "1000,95,30"},
        )
        meta = store.read("scenario_metadata").set_index("SCENARIO_ID").loc["SCN014"]
        self.assertEqual(meta.STATUS, "SCHEDULED")
        self.assertEqual(meta.AFFECTED_EVENTS, 0)
        self.assertGreater(meta.SCHEDULED_EVENTS, 0)
        catalog = store.read("scenario_config").set_index("SCENARIO_ID").loc["SCN014"]
        self.assertFalse(catalog.IMPACT_PERMANENT)
        self.assertIn("Target", catalog.CAPACITY_CONSTRAINT)
        self.assertIn("STATUS=SCHEDULED", catalog.DATA_EVIDENCE)
        self.assertNotIn("CONFIG ONLY", catalog.DATA_EVIDENCE)

    def test_supplier_overlap_selects_worst_rate_independent_of_order(self):
        from random import Random

        from sap_mock_data import GenerationConfig
        from sap_mock_data.scenarios.scheduling import ScenarioSchedule

        config = GenerationConfig(
            timeframe=Timeframe("2026-01-01", duration_days=90),
            scenarios=["SCN021", "SCN023", "SCN026"],
            scenario_configs={
                "SCN021": "VEND-0001,ALL,0.2,3",
                "SCN023": "VEND-0001,ALL",
                "SCN026": "VEND-0001,ALL,0.9,3",
            },
        )
        forward = ScenarioSchedule(config, config.parameters())
        reverse = ScenarioSchedule(config, config.parameters())
        reverse.items.reverse()
        result = forward.supplier("VEND-0001", "API1", date(2026, 3, 31), Random(7))
        self.assertEqual(
            result, reverse.supplier("VEND-0001", "API1", date(2026, 3, 31), Random(7))
        )
        self.assertEqual(result[2], "SCN021,SCN023")
        by_id = {i.id: i for i in forward.items}
        self.assertEqual(by_id["SCN021"].affected, 1)
        self.assertEqual(by_id["SCN023"].affected, 1)
        self.assertEqual(by_id["SCN026"].affected, 0)
        self.assertEqual(by_id["SCN026"].status, "SUPPRESSED")
        self.assertEqual(by_id["SCN026"].suppressed, 1)

    def test_fractional_finished_goods_scenario_quantity_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "whole-piece quantity"):
            generate(
                Timeframe("2026-01-05", duration_days=14),
                scenarios=["SCN001"],
                scenario_configs={"SCN001": "MAT-A0001,1000,FG01,0.5"},
            )

    def test_each_supplier_scenario_has_receipts_in_a_stock_shortage_fixture(self):
        original = Schedule._opening_batches

        def empty_stock(schedule):
            original(schedule)
            schedule.initial["LABST"] = 0

        timeframe = Timeframe("2026-01-05", duration_days=60)
        for sid in ("SCN021", "SCN022", "SCN023", "SCN024", "SCN025", "SCN026"):
            with self.subTest(scenario=sid):
                config = "VEND-0001,ALL" if sid == "SCN023" else "VEND-0001,ALL,0.65,3"
                with patch.object(Schedule, "_opening_batches", empty_stock):
                    store = generate(
                        timeframe,
                        num_vendors=1,
                        num_orders=150,
                        delivery_fill_rate=1,
                        scenarios=[sid],
                        scenario_configs={sid: config},
                    )
                receipts = store.read("ekbe")
                self.assertFalse(receipts.empty)
                self.assertTrue(receipts.ZZ_SCENARIO.eq(sid).all())
                self.assertEqual(
                    store.read("scenario_metadata").STATUS.iloc[0], "APPLIED"
                )
                self.assertTrue(temporal_report(store, timeframe)["ok"])
