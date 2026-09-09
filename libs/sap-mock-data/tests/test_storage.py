import subprocess
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

import pandas as pd

from sap_mock_data.storage import DeltaTableStore


class DeltaStorageTests(unittest.TestCase):
    def test_local_reads_use_current_snapshot_and_exit(self):
        with TemporaryDirectory() as directory:
            root = Path(directory) / "tables with spaces"
            store = DeltaTableStore(root)
            store.save("example", pd.DataFrame({"value": [1]}))
            store.save("example", pd.DataFrame({"value": [2, 3]}))
            for _ in range(5):
                result = subprocess.run(
                    [
                        sys.executable,
                        "-c",
                        (
                            "import sys; from sap_mock_data.storage import DeltaTableStore; "
                            "assert DeltaTableStore(sys.argv[1]).read('example').VALUE.tolist() == [2, 3]"
                        ),
                        str(root),
                    ],
                    capture_output=True,
                    text=True,
                    timeout=15,
                    check=False,
                )
                self.assertEqual(result.returncode, 0, result.stderr)
