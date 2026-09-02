"""Parameters, seeding, and the plant model shared by the generation stages."""

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
    "NUM_VENDORS": "20",
    "NUM_SITES": "5",
    "HUB_PLANT": "1000",
    "DELIVERY_FILL_RATE": "0.8",
    "SAFETY_STOCK_WEEKS": "6",
    "SUPPLIER_RELIABILITY_RATE": "1.0",
    "UNRELIABLE_MATERIALS": "",
    "DATASET_CURRENCY": "EUR",
    "GENERATE_DIRTY_DATA": "false",
    "DIRTY_DATA_RATE": "0.05",
}

BASE_PLANTS = {
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
        "port": False,
        "cost_factor": 1.0,
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
        "port": False,
        "cost_factor": 1.15,
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
        "port": True,
        "cost_factor": 0.85,
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
        "port": True,
        "cost_factor": 1.25,
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
        "port": True,
        "cost_factor": 1.0,
    },
}

# Cities for plants beyond the base plants: country, region, city,
# calendar, longitude, latitude, port.
CITY_POOL = (
    ("NL", "ZH", "Rotterdam", "NL", 4.4777, 51.9244, True),
    ("DE", "HH", "Hamburg", "DE", 9.9937, 53.5511, True),
    ("FR", "ARA", "Lyon", "FR", 4.8357, 45.7640, False),
    ("IT", "LOM", "Milan", "IT", 9.1900, 45.4642, False),
    ("ES", "CAT", "Barcelona", "ES", 2.1734, 41.3851, True),
    ("PL", "MZ", "Warsaw", "PL", 21.0122, 52.2297, False),
    ("AT", "W", "Vienna", "AT", 16.3738, 48.2082, False),
    ("CH", "BS", "Basel", "CH", 7.5886, 47.5596, False),
    ("IE", "D", "Dublin", "IE", -6.2603, 53.3498, True),
    ("GB", "MAN", "Manchester", "GB", -2.2426, 53.4808, False),
    ("BE", "VAN", "Antwerp", "BE", 4.4025, 51.2194, True),
    ("SE", "O", "Gothenburg", "SE", 11.9746, 57.7089, True),
    ("US", "IL", "Chicago", "US", -87.6298, 41.8781, False),
    ("US", "TX", "Houston", "US", -95.3698, 29.7604, True),
    ("CA", "ON", "Toronto", "CA", -79.3832, 43.6532, False),
    ("MX", "CMX", "Mexico City", "MX", -99.1332, 19.4326, False),
    ("BR", "SP", "Sao Paulo", "BR", -46.6333, -23.5505, False),
    ("IN", "MH", "Mumbai", "IN", 72.8777, 19.0760, True),
    ("CN", "SH", "Shanghai", "CN", 121.4737, 31.2304, True),
    ("JP", "13", "Tokyo", "JP", 139.6917, 35.6895, True),
    ("AU", "NSW", "Sydney", "AU", 151.2093, -33.8688, True),
    ("ZA", "GP", "Johannesburg", "ZA", 28.0473, -26.2041, False),
    ("AE", "DU", "Dubai", "AE", 55.2708, 25.2048, True),
    ("KR", "11", "Seoul", "KR", 126.9780, 37.5665, False),
)

SYNTHESIZED_ID_START = 6000
SYNTHESIZED_ID_STEP = 10
MAX_SITES = len(BASE_PLANTS) + (10000 - SYNTHESIZED_ID_START) // SYNTHESIZED_ID_STEP

# Plants for the active run; empty until configure_plants() runs.
PLANT_CONFIG: dict[str, dict] = {}


def build_plants(num_sites: int) -> dict[str, dict]:
    """Return plant records: the base plants first, then synthesized plants."""
    if not 1 <= num_sites <= MAX_SITES:
        raise ValueError(f"NUM_SITES must be between 1 and {MAX_SITES}; got {num_sites}")
    plants = dict(list(BASE_PLANTS.items())[:num_sites])
    for index in range(num_sites - len(BASE_PLANTS)):
        country, region, city, calendar, xpos, ypos, port = CITY_POOL[index % len(CITY_POOL)]
        production = index % 5 == 4
        suffix = f" {index // len(CITY_POOL) + 1}" if index >= len(CITY_POOL) else ""
        plants[f"{SYNTHESIZED_ID_START + SYNTHESIZED_ID_STEP * index}"] = {
            "name": f"{'Production Site' if production else 'Regional DC'} {city}{suffix}",
            "name2": "Regional Production Site" if production else "Distribution Center",
            "country": country,
            "region": region,
            "city": city,
            "street": f"{10 * (index + 1)} Industrial Way",
            "postal": f"{10000 + index:05d}",
            "plant_type": "PROD" if production else "DC",
            "calendar": calendar,
            "xpos": xpos,
            "ypos": ypos,
            "port": port,
            "cost_factor": (0.9, 1.0, 1.1, 1.2)[index % 4],
        }
    return plants


def configure_plants() -> None:
    """Rebuild PLANT_CONFIG in place for the active run's NUM_SITES."""
    PLANT_CONFIG.clear()
    PLANT_CONFIG.update(build_plants(int(param("NUM_SITES"))))
    hub = param("HUB_PLANT")
    if hub not in PLANT_CONFIG:
        raise ValueError(f"HUB_PLANT {hub!r} is not one of the {len(PLANT_CONFIG)} generated plants")


ROUTE_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def route_segment(werks: str) -> str:
    """Two-character route code segment for a plant.

    Base plants use their leading digits. Synthesized plants use a letter
    followed by a base-36 digit, so no two plants share a segment.
    """
    if werks in BASE_PLANTS:
        return werks[:2]
    index = (int(werks) - SYNTHESIZED_ID_START) // SYNTHESIZED_ID_STEP
    return chr(ord("A") + index // len(ROUTE_ALPHABET)) + ROUTE_ALPHABET[index % len(ROUTE_ALPHABET)]


def route_code(loc_from: str, loc_to: str) -> str:
    return f"R{route_segment(loc_from)}{route_segment(loc_to)}"


def production_plants() -> list[str]:
    return [werks for werks, plant in PLANT_CONFIG.items() if plant["plant_type"] == "PROD"]


def dc_plants() -> list[str]:
    return [werks for werks, plant in PLANT_CONFIG.items() if plant["plant_type"] == "DC"]


def is_port(werks: str) -> bool:
    return PLANT_CONFIG[werks]["port"]


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

SCALED_KNOBS = {
    "NUM_ORDERS",
    "NUM_CUSTOMERS",
    "NUM_FINISHED_GOODS",
    "NUM_RAW_MATERIALS",
    "NUM_VENDORS",
    "NUM_SITES",
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
    if is_port(loc_from) and is_port(loc_to) and distance_km > 200:
        modes.append("SEA")
    return tuple(modes)


def seed_all(seed: int) -> None:
    # Each stage starts the same pseudorandom sequences for a given seed.
    Faker.seed(seed)
    random.seed(seed)
    np.random.seed(seed)
