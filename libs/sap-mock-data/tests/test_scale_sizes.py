import os
import unittest
from contextlib import redirect_stdout
from io import StringIO

from sap_mock_data import GenerationConfig, generate_dataset
from sap_mock_data.config import DEMO_SCENARIO_CONFIGS, SIZE_KNOB_RANGES
from sap_mock_data.context import GenerationContext
from sap_mock_data.generation.common import BASE_PLANTS, build_plants, param
from sap_mock_data.storage import MemoryTableStore

# Target ranges per size. BOM depth is fixed at 1 for every size.
SIZE_RANGES = {
    "S": {"products": (1, 3), "suppliers": (3, 5), "sites": (1, 2)},
    "M": {"products": (10, 50), "suppliers": (20, 30), "sites": (4, 5)},
    "L": {"products": (100, 200), "suppliers": (50, 100), "sites": (20, 40)},
    "XL": {"products": (400, 800), "suppliers": (150, 300), "sites": (100, 120)},
}


def measure(store):
    mara = store.read("mara")
    stpo = store.read("stpo")
    parents = set(store.read("mast")["MATNR"])
    children = set(stpo["IDNRK"])
    return {
        "products": mara[mara["MTART"] == "FERT"]["MATNR"].nunique(),
        "suppliers": store.read("lfa1")["LIFNR"].nunique(),
        "sites": store.read("t001w")["WERKS"].nunique(),
        "bom_depth": 2 if parents & children else 1,
    }


def generate_at(size):
    store = MemoryTableStore()
    with redirect_stdout(StringIO()):
        generate_dataset(GenerationConfig(scale_factor=size, scenarios=()), store)
    return measure(store)


class ScaleFactorValidationTests(unittest.TestCase):
    def test_identifiers_normalize_case_and_whitespace(self) -> None:
        for raw, letter in (("S", "S"), ("m", "M"), (" l ", "L"), ("xl", "XL")):
            self.assertEqual(GenerationConfig(scale_factor=raw).scale_factor, letter)

    def test_unknown_letters_are_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "positive number or one of"):
            GenerationConfig(scale_factor="banana")

    def test_non_positive_and_non_finite_numbers_are_rejected(self) -> None:
        for value in (0, -1, float("nan"), float("inf")):
            with self.assertRaises(ValueError):
                GenerationConfig(scale_factor=value)

    def test_identifiers_sample_knobs_within_their_ranges(self) -> None:
        for size, ranges in SIZE_KNOB_RANGES.items():
            for seed in (1, 42, 999):
                parameters = GenerationConfig(scale_factor=size, random_seed=seed).parameters()
                for knob, (low, high) in ranges.items():
                    self.assertTrue(
                        low <= int(parameters[knob]) <= high, f"{size}.{knob} seed={seed}"
                    )

    def test_sampling_is_deterministic_per_seed(self) -> None:
        first = GenerationConfig(scale_factor="M", random_seed=7).parameters()
        second = GenerationConfig(scale_factor="M", random_seed=7).parameters()
        self.assertEqual(first, second)

    def test_sampling_varies_across_seeds(self) -> None:
        knobs = list(SIZE_KNOB_RANGES["M"])
        samples = {
            tuple(GenerationConfig(scale_factor="M", random_seed=seed).parameters()[knob]
                  for knob in knobs)
            for seed in range(10)
        }
        self.assertGreater(len(samples), 1)

    def test_numbers_multiply_without_size_adjustment(self) -> None:
        with GenerationContext(GenerationConfig(scale_factor=0.1)).activate():
            self.assertEqual(param("NUM_VENDORS"), "2")
            self.assertEqual(param("NUM_CUSTOMERS"), "3")
        with GenerationContext(GenerationConfig(scale_factor=0.001)).activate():
            self.assertEqual(param("NUM_VENDORS"), "1")

    def test_explicit_knobs_override_the_size_values(self) -> None:
        config = GenerationConfig(scale_factor="S", num_customers=77, num_vendors=9, num_sites=3)
        self.assertEqual(config.parameters()["NUM_CUSTOMERS"], "77")
        self.assertEqual(config.parameters()["NUM_VENDORS"], "9")
        self.assertEqual(config.parameters()["NUM_SITES"], "3")

    def test_tiny_numeric_factor_generates_a_minimal_dataset(self) -> None:
        store = MemoryTableStore()
        with redirect_stdout(StringIO()):
            generate_dataset(GenerationConfig(scale_factor=0.001, scenarios=()), store)
        self.assertEqual(store.read("lfa1")["LIFNR"].nunique(), 1)


class PlantModelTests(unittest.TestCase):
    def test_base_plants_come_first_and_unchanged(self) -> None:
        self.assertEqual(build_plants(5), BASE_PLANTS)
        self.assertEqual(list(build_plants(2)), ["1000", "2000"])

    def test_synthesized_plants_are_well_formed(self) -> None:
        plants = build_plants(60)
        self.assertEqual(len(plants), 60)
        fields = set(BASE_PLANTS["1000"])
        for werks, plant in plants.items():
            self.assertEqual(len(werks), 4, werks)
            self.assertEqual(set(plant), fields, werks)
        production = [w for w, plant in plants.items() if plant["plant_type"] == "PROD"]
        self.assertIn("1000", production)
        self.assertGreater(len(production), 2)

    TABLE_KEYS = {
        "t001w": ["WERKS"], "sapapo_loc": ["LOCNO"], "sapapo_tr": ["TRLID"],
        "sapapo_trm": ["TRLID", "TRMID"], "tvro": ["ROUTE"], "tvrot": ["ROUTE", "SPRAS"],
        "crhd": ["OBJID"], "kako": ["KAPID"], "plko": ["PLNNR"], "plpo": ["PLNNR", "VORNR"],
        "marc": ["MATNR", "WERKS"], "mbew": ["MATNR", "BWKEY"], "mard": ["MATNR", "WERKS", "LGORT", "CHARG"],
        "vttk": ["TKNUM"], "vttp": ["TKNUM", "TPNUM"], "vtts": ["TKNUM", "TSNUM"],
    }

    def test_synthesized_plants_keep_every_key_unique(self) -> None:
        store = MemoryTableStore()
        with redirect_stdout(StringIO()):
            generate_dataset(GenerationConfig(scale_factor="S", num_sites=60, scenarios=()), store)
        for table, key in self.TABLE_KEYS.items():
            duplicates = int(store.read(table).duplicated(subset=key).sum())
            self.assertEqual(duplicates, 0, f"{table} has {duplicates} duplicate {'+'.join(key)}")
        tvro, tvrot, vttk = store.read("tvro"), store.read("tvrot"), store.read("vttk")
        self.assertEqual(len(tvro), 60 * 59)
        self.assertFalse(tvrot["BEZEI"].str.contains(r"\b6\d{3}\b").any())
        self.assertTrue(set(vttk["ROUTE"]) <= set(tvro["ROUTE"]))

    def test_hub_outside_the_generated_plants_is_rejected(self) -> None:
        with redirect_stdout(StringIO()), self.assertRaisesRegex(ValueError, "HUB_PLANT '3000'"):
            generate_dataset(
                GenerationConfig(scale_factor="S", num_sites=2, hub_plant="3000"), MemoryTableStore()
            )

    def test_single_site_dataset_generates(self) -> None:
        store = MemoryTableStore()
        with redirect_stdout(StringIO()):
            generate_dataset(GenerationConfig(scale_factor="S", num_sites=1, scenarios="demo"), store)
        self.assertEqual(store.read("t001w")["WERKS"].tolist(), ["1000"])
        self.assertEqual(set(store.read("marc")["WERKS"]), {"1000"})
        self.assertEqual(set(store.read("vbap")["WERKS"]), {"1000"})


class SmallDatasetTests(unittest.TestCase):
    """The S size generates the full pipeline with observable scenarios."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.store = MemoryTableStore()
        with redirect_stdout(StringIO()):
            generate_dataset(
                GenerationConfig(scale_factor="S", scenarios="demo"), cls.store
            )

    def test_material_universe_is_s_sized(self) -> None:
        mara = self.store.read("mara")
        finished = mara[mara["MTART"] == "FERT"]["MATNR"].nunique()
        self.assertLessEqual(finished, 4)

    def test_vendor_count_is_s_sized(self) -> None:
        self.assertTrue(3 <= self.store.read("lfa1")["LIFNR"].nunique() <= 5)

    def test_every_sales_order_names_an_existing_customer(self) -> None:
        customers = set(self.store.read("kna1")["KUNNR"])
        self.assertTrue(set(self.store.read("vbak")["KUNNR"]) <= customers)

    def test_every_eina_record_names_an_existing_vendor(self) -> None:
        vendors = set(self.store.read("lfa1")["LIFNR"])
        self.assertTrue(set(self.store.read("eina")["LIFNR"]) <= vendors)

    def test_demo_scenarios_leave_observable_evidence(self) -> None:
        metadata = self.store.read("scenario_metadata")
        self.assertGreaterEqual(metadata["SCENARIO_ID"].nunique(), 8)
        mara = self.store.read("mara")
        self.assertIn("MAT-NEW01", set(mara["MATNR"]))
        matdoc = self.store.read("matdoc")
        self.assertTrue(matdoc["MBLNR"].astype(str).str.startswith("SCN").any())

    def test_material_scenarios_target_existing_materials(self) -> None:
        materials = set(self.store.read("mara")["MATNR"])
        for scenario_material in ("MAT-A0001", "MAT-A0020", "API1"):
            self.assertIn(scenario_material, materials)

    def test_scenario_catalog_names_only_ids_that_exist(self) -> None:
        catalog = self.store.read("scenario_config")
        catalog = catalog[catalog["SCENARIO_ID"].isin(DEMO_SCENARIO_CONFIGS)]
        plants = set(self.store.read("t001w")["WERKS"])
        materials = set(self.store.read("mara")["MATNR"])
        vendors = set(self.store.read("lfa1")["LIFNR"])
        for row in catalog.itertuples(index=False):
            if row.IMPACTED_NODE not in ("", "ALL"):
                self.assertIn(row.IMPACTED_NODE, plants, row.SCENARIO_ID)
            if row.IMPACTED_SUPPLIER:
                self.assertIn(row.IMPACTED_SUPPLIER, vendors, row.SCENARIO_ID)
            for field in (row.IMPACTED_PRODUCTS, row.COMPETING_PRODUCTS):
                for material in filter(None, field.split(",")):
                    if material != "ALL":
                        self.assertIn(material, materials, f"{row.SCENARIO_ID}: {material}")

    def test_supplier_scenario_targets_an_existing_supply_relationship(self) -> None:
        vendor, material = DEMO_SCENARIO_CONFIGS["SCN023"].split(",")
        eina = self.store.read("eina")
        self.assertTrue(((eina["LIFNR"] == vendor) & (eina["MATNR"] == material)).any())


class SizeTableTests(unittest.TestCase):
    """Generated datasets land in the size table's ranges."""

    def assert_size(self, size) -> None:
        measured = generate_at(size)
        for dimension, (low, high) in SIZE_RANGES[size].items():
            self.assertTrue(
                low <= measured[dimension] <= high,
                f"{size} {dimension}: {measured[dimension]} outside [{low}, {high}]",
            )
        self.assertEqual(measured["bom_depth"], 1)

    def test_s_dataset_matches_the_size_table(self) -> None:
        self.assert_size("S")

    @unittest.skipUnless(
        os.environ.get("SAP_MOCK_SIZE_VALIDATION") == "1",
        "M and L generation adds about 45 seconds; set SAP_MOCK_SIZE_VALIDATION=1",
    )
    def test_m_dataset_matches_the_size_table(self) -> None:
        self.assert_size("M")

    @unittest.skipUnless(
        os.environ.get("SAP_MOCK_SIZE_VALIDATION") == "1",
        "M and L generation adds about 45 seconds; set SAP_MOCK_SIZE_VALIDATION=1",
    )
    def test_l_dataset_matches_the_size_table(self) -> None:
        self.assert_size("L")

    @unittest.skipUnless(
        os.environ.get("SAP_MOCK_XL_VALIDATION") == "1",
        "XL generation takes over an hour; set SAP_MOCK_XL_VALIDATION=1",
    )
    def test_xl_dataset_matches_the_size_table(self) -> None:
        self.assert_size("XL")


if __name__ == "__main__":
    unittest.main()
