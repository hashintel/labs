import unittest
from contextlib import redirect_stderr
from io import StringIO

from sap_mock_data.cli.main import _parser, main


class ScaleFactorArgumentTests(unittest.TestCase):
    def parse(self, value):
        return _parser().parse_args(["generate", "out", "--scale-factor", value]).scale_factor

    def test_numbers_and_identifiers_parse(self) -> None:
        self.assertEqual(self.parse("0.5"), 0.5)
        self.assertEqual(self.parse("3"), 3.0)
        self.assertEqual(self.parse("s"), "S")
        self.assertEqual(self.parse("XL"), "XL")

    def assert_usage_error(self, argv, fragment) -> None:
        stderr = StringIO()
        with redirect_stderr(stderr), self.assertRaises(SystemExit) as exit_info:
            main(argv)
        self.assertEqual(exit_info.exception.code, 2)
        self.assertIn(fragment, stderr.getvalue())

    def test_unknown_identifier_is_a_usage_error(self) -> None:
        self.assert_usage_error(
            ["generate", "out", "--scale-factor", "banana"], "one of S, M, L, XL"
        )

    def test_non_finite_and_non_positive_numbers_are_usage_errors(self) -> None:
        for value in ("nan", "inf", "0", "-2"):
            self.assert_usage_error(
                ["generate", "out", "--scale-factor", value], "positive finite number"
            )

    def test_config_rejections_are_usage_errors(self) -> None:
        self.assert_usage_error(["generate", "out", "--vendors", "0"], "num_vendors")
        self.assert_usage_error(["generate", "out", "--currency", "EURO"], "currency")


if __name__ == "__main__":
    unittest.main()
