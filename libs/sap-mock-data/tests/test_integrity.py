import unittest

import pandas as pd

from sap_mock_data.storage import MemoryTableStore
from sap_mock_data.validation import integrity_report


class IntegrityReportTests(unittest.TestCase):
    def test_reports_missing_relationship_columns(self) -> None:
        store = MemoryTableStore()
        store.save("makt", pd.DataFrame({"OTHER_CHILD_KEY": ["1"]}))
        store.save("mara", pd.DataFrame({"OTHER_PARENT_KEY": ["1"]}))

        report = integrity_report(store)

        self.assertFalse(report["ok"])
        self.assertEqual(
            report["checks"],
            [
                {
                    "child": "makt.MATNR",
                    "parent": "mara.MATNR",
                    "missing_keys": None,
                    "missing_columns": ["makt.MATNR", "mara.MATNR"],
                }
            ],
        )

    def test_still_reports_missing_key_values(self) -> None:
        store = MemoryTableStore()
        store.save("makt", pd.DataFrame({"MATNR": ["known", "missing"]}))
        store.save("mara", pd.DataFrame({"MATNR": ["known"]}))

        report = integrity_report(store)

        self.assertFalse(report["ok"])
        self.assertEqual(report["checks"][0]["missing_keys"], 1)
        self.assertNotIn("missing_columns", report["checks"][0])


if __name__ == "__main__":
    unittest.main()
