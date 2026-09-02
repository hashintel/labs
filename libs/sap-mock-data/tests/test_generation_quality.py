import unittest
from contextlib import redirect_stdout
from io import StringIO

from sap_mock_data import GenerationConfig, generate_dataset
from sap_mock_data.generation.common import (
    EU_COUNTRIES,
    PLANT_CONFIG,
    is_port,
    customs_days,
)
from sap_mock_data.storage import MemoryTableStore


class GenerationQualityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.store = MemoryTableStore()
        with redirect_stdout(StringIO()):
            generate_dataset(
                GenerationConfig(scale_factor=0.1, num_sites=5, scenarios="demo"), cls.store
            )

    def test_generated_columns_have_no_corruption_marker(self) -> None:
        malformed = [
            f"{table}.{column}"
            for table in self.store.tables()
            for column in self.store.read(table).columns
            if "ESSION" in column
        ]

        self.assertEqual(malformed, [])

    def test_component_reservations_and_goods_issues_are_generated(self) -> None:
        resb = self.store.read("resb")
        afko = self.store.read("afko")
        matdoc = self.store.read("matdoc")

        self.assertGreater(len(resb), 0)
        self.assertTrue(resb["BDMNG"].gt(0).all())
        self.assertTrue(matdoc["BWART"].eq("261").any())
        self.assertTrue(resb["RSNUM"].str.fullmatch(r"\d{10}").all())
        reservations = resb[["AUFNR", "RSNUM"]].drop_duplicates()
        orders = afko[["AUFNR", "RSNUM"]]
        reservation_links = reservations.merge(
            orders,
            on="AUFNR",
            how="left",
            suffixes=("_resb", "_afko"),
            validate="one_to_one",
        )
        self.assertTrue(
            reservation_links["RSNUM_resb"].eq(reservation_links["RSNUM_afko"]).all()
        )

    def test_raw_material_stock_uses_rm01(self) -> None:
        mara = self.store.read("mara")
        mard = self.store.read("mard")
        raw_materials = set(mara.loc[mara["MTART"].eq("ROH"), "MATNR"])

        self.assertEqual(set(mard.loc[mard["MATNR"].isin(raw_materials), "LGORT"]), {"RM01"})
        self.assertEqual(set(mard.loc[~mard["MATNR"].isin(raw_materials), "LGORT"]), {"FG01"})

    def test_plant_master_and_transport_locations_match(self) -> None:
        plants = self.store.read("t001w")
        locations = self.store.read("sapapo_loc")

        self.assertEqual(set(plants["WERKS"]), set(locations["LOCNO"]))
        plant_ids = set(plants["WERKS"])
        for table in ("marc", "mard", "vbap", "matdoc"):
            with self.subTest(table=table):
                self.assertEqual(set(self.store.read(table)["WERKS"]), plant_ids)
        cities = plants[["WERKS", "ORT01"]].merge(
            locations[["LOCNO", "CITY"]],
            left_on="WERKS",
            right_on="LOCNO",
        )
        self.assertTrue(cities["ORT01"].eq(cities["CITY"]).all())

    def test_transport_lanes_use_valid_modes_and_customs_delays(self) -> None:
        lanes = self.store.read("sapapo_tr")
        modes = self.store.read("sapapo_trm")
        preferred = lanes.merge(
            modes.loc[modes["PRIFLAG"].eq("X")],
            on="TRLID",
            validate="one_to_one",
        )

        self.assertEqual(set(preferred["TRMID"]), {"ROAD", "SEA", "AIR"})
        for lane in preferred.itertuples():
            country_from = PLANT_CONFIG[lane.LOCFR]["country"]
            country_to = PLANT_CONFIG[lane.LOCTO]["country"]
            if lane.TRMID == "ROAD":
                self.assertTrue(
                    country_from == country_to
                    or {country_from, country_to}.issubset(EU_COUNTRIES)
                )
            if lane.TRMID == "SEA":
                self.assertTrue(is_port(lane.LOCFR) and is_port(lane.LOCTO))

        self.assertEqual(customs_days("DE", "DE"), 0)
        self.assertEqual(customs_days("DE", "IE"), 0)
        self.assertEqual(customs_days("DE", "US"), 1)
        self.assertEqual(customs_days("US", "SG"), 1)

    def test_batch_statuses_use_sap_values(self) -> None:
        for table in ("mch1", "mcha"):
            with self.subTest(table=table):
                self.assertLessEqual(set(self.store.read(table)["ZUSTD"]), {"", "X"})

    def test_sales_orders_have_consistent_type_currency_and_dates(self) -> None:
        vbak = self.store.read("vbak")

        self.assertEqual(set(vbak["AUART"]), {"OR"})
        self.assertEqual(set(vbak["WAERK"]), {"EUR"})
        self.assertFalse(vbak["VDATU"].isna().any())
        self.assertFalse(vbak["BSTNK"].isna().any())

    def test_all_suppliers_have_info_records_and_purchase_orders(self) -> None:
        suppliers = set(self.store.read("lfa1")["LIFNR"])

        self.assertEqual(set(self.store.read("eina")["LIFNR"]), suppliers)
        self.assertEqual(set(self.store.read("ekko")["LIFNR"]), suppliers)

    def test_all_monetary_tables_use_dataset_currency(self) -> None:
        currency_columns = {
            "mbew": "WAERS",
            "vbak": "WAERK",
            "vbap": "WAERK",
            "ekko": "WAERS",
            "ekbe": "WAERS",
            "eine": "WAERS",
            "sapapo_trm": "TRACOSTCUR",
        }

        for table, column in currency_columns.items():
            with self.subTest(table=table):
                self.assertEqual(set(self.store.read(table)[column]), {"EUR"})

    def test_production_statuses_share_one_vocabulary(self) -> None:
        statuses = set(self.store.read("afko")["STAT"])

        self.assertLessEqual(statuses, {"CRTD", "REL", "PCNF", "CNF", "DLFL"})


if __name__ == "__main__":
    unittest.main()
