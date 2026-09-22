from __future__ import annotations

import calendar
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta


def parse_date(value: date | str) -> date:
    if isinstance(value, datetime):
        raise TypeError(f"timeframe dates must be calendar dates; got {value!r}")
    if isinstance(value, date):
        return value
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ValueError(f"date must use YYYY-MM-DD; got {value!r}")
    return date.fromisoformat(value)


def add_months(value: date, months: int) -> date:
    year, month = divmod(value.year * 12 + value.month - 1 + months, 12)
    month += 1
    return date(year, month, min(value.day, calendar.monthrange(year, month)[1]))


@dataclass(frozen=True, slots=True)
class Timeframe:
    start: date | str
    end: date | str | None = None
    duration_days: int | None = None

    def __post_init__(self) -> None:
        start = parse_date(self.start)
        if (self.end is None) == (self.duration_days is None):
            raise ValueError("timeframe requires exactly one of end or duration_days")
        if self.duration_days is not None:
            if (
                not isinstance(self.duration_days, int)
                or isinstance(self.duration_days, bool)
                or self.duration_days <= 0
            ):
                raise ValueError(
                    f"duration_days must be a positive integer; got {self.duration_days!r}"
                )
            try:
                end = start + timedelta(days=self.duration_days - 1)
            except (OverflowError, ValueError) as error:
                raise ValueError(
                    f"duration_days exceeds the supported calendar: {self.duration_days!r}"
                ) from error
        else:
            end = parse_date(self.end)
        if end < start:
            raise ValueError(f"timeframe end {end} precedes start {start}")
        if start.year < 1900 or end.year > 2200:
            raise ValueError("timeframe must fall between 1900-01-01 and 2200-12-31")
        object.__setattr__(self, "start", start)
        object.__setattr__(self, "end", end)

    @property
    def days(self) -> int:
        return (self.end - self.start).days + 1

    def contains(self, value: date) -> bool:
        return self.start <= value <= self.end

    def periods(self):
        start = self.start
        while start <= self.end:
            end = min(
                self.end,
                date(
                    start.year,
                    start.month,
                    calendar.monthrange(start.year, start.month)[1],
                ),
            )
            yield start, end
            start = end + timedelta(days=1)
