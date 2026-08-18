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
    "GENERATE_DIRTY_DATA": "false",
    "DIRTY_DATA_RATE": "0.05",
}

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


def seed_all(seed: int) -> None:
    # Each stage starts the same pseudorandom sequences for a given seed.
    Faker.seed(seed)
    random.seed(seed)
    np.random.seed(seed)
