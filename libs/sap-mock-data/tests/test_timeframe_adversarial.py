import unittest

from test_timeframe import generate

from sap_mock_data import Timeframe
from sap_mock_data.validation import temporal_report


class AdversarialTimeframeTests(unittest.TestCase):
    def test_validation_rejects_missing_and_corrupted_logistics(self):
        timeframe = Timeframe("2026-01-05", duration_days=118)
        store = generate(timeframe)
        self.assertTrue(temporal_report(store, timeframe)["ok"])
        mutations = (
            ("vbep", lambda rows: rows.iloc[:0]),
            ("vttp", lambda rows: rows.iloc[:0]),
            ("vtts", lambda rows: rows.iloc[:0]),
            ("vbep", lambda rows: rows.assign(POSNR="999999")),
            ("vbep", lambda rows: rows.assign(WMENG=rows.WMENG + 1)),
            ("vbep", lambda rows: rows.assign(BMENG=rows.WMENG + 1)),
            ("vbep", lambda rows: rows.assign(EDATU="20260101")),
            ("vbep", lambda rows: rows.assign(EDATU="20260230")),
        )
        for table, mutate in mutations:
            original = store.read(table)
            with self.subTest(table=table, mutate=mutate):
                store.save(table, mutate(original))
                self.assertFalse(temporal_report(store, timeframe)["ok"])
            store.save(table, original)
        store.save("likp", store.read("likp").assign(ZZ_ARRIVAL_DATE=""))
        store.save("vttk", store.read("vttk").assign(DATEN=""))
        self.assertFalse(temporal_report(store, timeframe)["ok"])

    def test_zero_duration_demand_scenarios_create_no_orders(self):
        for scenario, config in (
            ("SCN019", "MAT-A0001,1000,100,0"),
            ("SCN020", "40,0"),
        ):
            with self.subTest(scenario=scenario):
                store = generate(
                    Timeframe("2026-01-05", duration_days=118),
                    scenarios=[scenario],
                    scenario_configs={scenario: config},
                )
                self.assertFalse(store.read("vbak").ZZ_SCENARIO.eq(scenario).any())
                self.assertEqual(
                    store.read("scenario_metadata").STATUS.iloc[0],
                    "NO_ELIGIBLE_ACTIVITY",
                )

    def test_emergency_orders_require_positive_quantity(self):
        with self.assertRaisesRegex(ValueError, "order quantity must be positive"):
            generate(
                Timeframe("2026-01-05", duration_days=118),
                scenarios=["SCN013"],
                scenario_configs={"SCN013": "MAT-A0001,1000,0,20260110"},
            )
