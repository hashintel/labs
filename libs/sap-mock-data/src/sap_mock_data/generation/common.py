"""Provide parameter lookup and random-seed helpers."""

import random

import numpy as np
from faker import Faker

from ..context import current_parameters

DEFAULTS = {
    "RANDOM_SEED": "42",
    "NUM_CUSTOMERS": "30",
    "NUM_FINISHED_GOODS": "40",
    "NUM_RAW_MATERIALS": "30",
    "MOQ_FINISHED_MIN": "250",
    "MOQ_FINISHED_MAX": "1000",
    "MOQ_RAW_MIN": "1000",
    "MOQ_RAW_MAX": "10000",
    "NUM_ORDERS": "5000",
    "HUB_PLANT": "1000",
    "DELIVERY_FILL_RATE": "0.8",
    "SAFETY_STOCK_WEEKS": "6",
    "SUPPLIER_RELIABILITY_RATE": "1.0",
    "UNRELIABLE_MATERIALS": "",
    "DATASET_CURRENCY": "EUR",
    "GENERATE_DIRTY_DATA": "false",
    "DIRTY_DATA_RATE": "0.05",
}

PLANT_CONFIG = {
    "1000": {
        "name": "Manufacturing Hub",
        "name2": "Primary Production",
        "country": "DE",
        "region": "BW",
        "city": "Stuttgart",
        "street": "Pharmastrasse 100",
        "postal": "70173",
        "plant_type": "PROD",
        "calendar": "DE",
        "xpos": 9.1829,
        "ypos": 48.7758,
    },
    "2000": {
        "name": "Regional DC Europe",
        "name2": "Distribution Center",
        "country": "DE",
        "region": "HE",
        "city": "Frankfurt",
        "street": "Logistikweg 50",
        "postal": "60313",
        "plant_type": "DC",
        "calendar": "DE",
        "xpos": 8.6821,
        "ypos": 50.1109,
    },
    "3000": {
        "name": "Regional DC Americas",
        "name2": "Distribution Center",
        "country": "US",
        "region": "NJ",
        "city": "Newark",
        "street": "500 Distribution Blvd",
        "postal": "07102",
        "plant_type": "DC",
        "calendar": "US",
        "xpos": -74.1724,
        "ypos": 40.7357,
    },
    "4000": {
        "name": "Regional DC Asia Pacific",
        "name2": "Distribution Center",
        "country": "SG",
        "region": "",
        "city": "Singapore",
        "street": "10 Changi Business Park",
        "postal": "486030",
        "plant_type": "DC",
        "calendar": "SG",
        "xpos": 103.8198,
        "ypos": 1.3521,
    },
    "5000": {
        "name": "Secondary Manufacturing",
        "name2": "Backup Production Site",
        "country": "IE",
        "region": "CO",
        "city": "Cork",
        "street": "Pharma Park 25",
        "postal": "T12 ABC1",
        "plant_type": "PROD",
        "calendar": "IE",
        "xpos": -8.4756,
        "ypos": 51.8985,
    },
}

EU_COUNTRIES = frozenset(
    {
        "AT",
        "BE",
        "BG",
        "CY",
        "CZ",
        "DE",
        "DK",
        "EE",
        "ES",
        "FI",
        "FR",
        "GR",
        "HR",
        "HU",
        "IE",
        "IT",
        "LT",
        "LU",
        "LV",
        "MT",
        "NL",
        "PL",
        "PT",
        "RO",
        "SE",
        "SI",
        "SK",
    }
)
PORT_PLANTS = frozenset({"3000", "4000", "5000"})

SCALED_KNOBS = {
    "NUM_ORDERS",
    "NUM_CUSTOMERS",
    "NUM_FINISHED_GOODS",
    "NUM_RAW_MATERIALS",
}


def param(name: str) -> str:
    parameters = current_parameters()
    if name in parameters:
        return parameters[name]
    default = DEFAULTS[name]
    scale_factor = float(parameters.get("SCALE_FACTOR", "1"))
    if name in SCALED_KNOBS and scale_factor != 1:
        return str(max(1, round(int(default) * scale_factor)))
    return default


def widget(name: str, default: str) -> str:
    return current_parameters().get(name, default)


def customs_days(country_from: str, country_to: str) -> int:
    if country_from == country_to:
        return 0
    if country_from in EU_COUNTRIES and country_to in EU_COUNTRIES:
        return 0
    return 1


def transport_modes_for_lane(
    loc_from: str, loc_to: str, distance_km: float
) -> tuple[str, ...]:
    country_from = PLANT_CONFIG[loc_from]["country"]
    country_to = PLANT_CONFIG[loc_to]["country"]
    modes = ["AIR"]
    if country_from == country_to or (
        country_from in EU_COUNTRIES and country_to in EU_COUNTRIES
    ):
        modes.insert(0, "ROAD")
    if loc_from in PORT_PLANTS and loc_to in PORT_PLANTS and distance_km > 200:
        modes.append("SEA")
    return tuple(modes)


def seed_all(seed: int) -> None:
    # Each stage starts the same pseudorandom sequences for a given seed.
    Faker.seed(seed)
    random.seed(seed)
    np.random.seed(seed)
