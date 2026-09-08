import unittest
from contextlib import redirect_stderr
from io import StringIO

from sap_mock_data.cli.main import _parser, main


class ScaleFactorArgumentTests(unittest.TestCase):
    def parse(self, value):
        return (
            _parser()
            .parse_args(["generate", "out", "--scale-factor", value])
            .scale_factor
        )

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

    def test_timeframe_validation_is_a_usage_error(self) -> None:
        self.assert_usage_error(
            ["generate", "out", "--duration-days", "14"], "--start-date"
        )
        self.assert_usage_error(
            ["generate", "out", "--start-date", "2026-01-05"], "exactly one"
        )
        self.assert_usage_error(
            [
                "generate",
                "out",
                "--start-date",
                "2026-01-05",
                "--end-date",
                "2026-01-04",
            ],
            "precedes",
        )

    def test_timeframe_options_parse(self) -> None:
        args = _parser().parse_args(
            ["generate", "out", "--start-date", "2026-01-05", "--duration-days", "14"]
        )
        self.assertEqual((args.start_date, args.duration_days), ("2026-01-05", 14))

    def test_duration_days_rejects_text_and_fractions(self) -> None:
        for duration in ("14 days", "2 weeks", "5 months", "1.5"):
            self.assert_usage_error(
                [
                    "generate",
                    "out",
                    "--start-date",
                    "2026-01-05",
                    "--duration-days",
                    duration,
                ],
                "invalid int value",
            )

    def test_duration_days_must_be_positive(self) -> None:
        for duration_days in ("0", "-1"):
            self.assert_usage_error(
                [
                    "generate",
                    "out",
                    "--start-date",
                    "2026-01-05",
                    "--duration-days",
                    duration_days,
                ],
                "duration_days must be a positive integer",
            )


if __name__ == "__main__":
    unittest.main()
