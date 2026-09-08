from __future__ import annotations

from collections import defaultdict
from datetime import timedelta

import pandas as pd

ACTUAL_DATES = {
    "vbak": ("ERDAT",),
    "ekko": ("BEDAT", "AEDAT"),
    "ekbe": ("BUDAT", "CPUDT"),
    "matdoc": ("BUDAT", "CPUDT"),
    "likp": ("ERDAT", "WADAT_IST", "ZZ_ARRIVAL_DATE"),
    "vttk": ("ERDAT", "DATBG", "DATEN"),
    "afko": ("GSTRI", "GETRI"),
}
KEY = ["MATNR", "WERKS", "LGORT", "CHARG"]


def temporal_report(store, timeframe):
    errors = []

    def check(condition, message):
        if not condition:
            errors.append(message)

    tables = {
        name: store.read(name)
        for name in (
            *ACTUAL_DATES,
            "vbap",
            "vbep",
            "lips",
            "vbfa",
            "vttp",
            "vtts",
            "ekpo",
            "resb",
            "opening_stock",
            "mard",
            "mch1",
            "mcha",
            "plaf",
            "mardh",
        )
    }
    start, end = timeframe.start.strftime("%Y%m%d"), timeframe.end.strftime("%Y%m%d")
    for name, columns in ACTUAL_DATES.items():
        df = tables[name]
        for column in columns:
            values = df[column].fillna("").astype(str)
            present = values != ""
            parsed = pd.to_datetime(values[present], format="%Y%m%d", errors="coerce")
            check(parsed.notna().all(), f"{name}.{column} contains invalid dates")
            check(
                values[present].between(start, end).all(),
                f"{name}.{column} contains activity outside the timeframe",
            )

    for name, keys in {
        "vbak": ["VBELN"],
        "vbap": ["VBELN", "POSNR"],
        "vbep": ["VBELN", "POSNR", "ETENR"],
        "likp": ["VBELN"],
        "lips": ["VBELN", "POSNR"],
        "vttk": ["TKNUM"],
        "ekko": ["EBELN"],
        "ekpo": ["EBELN", "EBELP"],
        "afko": ["AUFNR"],
        "resb": ["RSNUM", "RSPOS"],
        "mard": KEY,
        "opening_stock": KEY,
        "matdoc": ["MBLNR", "MJAHR", "ZEILE"],
    }.items():
        check(
            not tables[name].duplicated(keys).any(),
            f"{name} contains duplicate document keys",
        )
    if errors:
        return {"ok": False, "errors": errors}

    orders = tables["vbak"].set_index("VBELN").to_dict("index")
    items = tables["vbap"].set_index(["VBELN", "POSNR"]).to_dict("index")
    deliveries = tables["likp"].set_index("VBELN").to_dict("index")
    shipments = tables["vttk"].set_index("TKNUM").to_dict("index")
    production = tables["afko"].set_index("AUFNR").to_dict("index")
    purchases = tables["ekko"].set_index("EBELN").to_dict("index")
    purchase_items = tables["ekpo"].set_index(["EBELN", "EBELP"]).to_dict("index")
    shipped = defaultdict(float)
    delivery_items = {}
    for row in tables["lips"].itertuples():
        key = (row.VGBEL, row.VGPOS)
        check(
            key in items and row.VGBEL in orders and row.VBELN in deliveries,
            f"delivery {row.VBELN} references a missing sales document",
        )
        if key not in items or row.VBELN not in deliveries or row.VGBEL not in orders:
            continue
        item, order, delivery = items[key], orders[row.VGBEL], deliveries[row.VBELN]
        check(
            order["ERDAT"]
            <= delivery["ERDAT"]
            <= delivery["WADAT_IST"]
            <= delivery["LFDAT"],
            f"delivery {row.VBELN} precedes its order or dispatch",
        )
        check(
            row.MATNR == item["MATNR"] and row.WERKS == item["WERKS"],
            f"delivery {row.VBELN} disagrees with its sales item",
        )
        shipped[key] += row.LFIMG
        delivery_items[row.VBELN, row.POSNR] = (row.VGBEL, row.VGPOS, row.LFIMG)
    flow_items = {
        (r.VBELN_N, r.POSNN_N): (r.VBELN, r.POSNN, r.RFMNG)
        for r in tables["vbfa"].itertuples()
    }
    check(
        flow_items == delivery_items and len(flow_items) == len(tables["vbfa"]),
        "document flow disagrees with delivery items",
    )
    for key, item in items.items():
        check(key[0] in orders, f"sales item {key} references a missing order")
        check(
            shipped[key] <= item["KWMENG"] + 1e-7, f"sales item {key} is overdelivered"
        )
        check(
            (item["LFSTA"] == "C") == (abs(shipped[key] - item["KWMENG"]) < 1e-7),
            f"sales item {key} has inconsistent delivery status",
        )
    for row in tables["vttp"].itertuples():
        check(
            row.TKNUM in shipments and row.VBELN in deliveries,
            f"shipment {row.TKNUM} references a missing delivery",
        )
        if row.TKNUM in shipments and row.VBELN in deliveries:
            shipment, delivery = shipments[row.TKNUM], deliveries[row.VBELN]
            check(
                shipment["DATBG"] == delivery["WADAT_IST"]
                and shipment["DTTRG"] == delivery["LFDAT"],
                f"shipment {row.TKNUM} disagrees with its delivery dates",
            )
            check(
                shipment["DATEN"] == delivery["ZZ_ARRIVAL_DATE"],
                f"shipment {row.TKNUM} disagrees with its arrival status",
            )
            check(
                shipment["DTTRG"] >= shipment["DATBG"],
                f"shipment {row.TKNUM} arrives before dispatch",
            )
    receipt_qty = defaultdict(float)
    for row in tables["ekbe"].itertuples():
        key = (row.EBELN, row.EBELP)
        check(
            row.EBELN in purchases and key in purchase_items,
            f"receipt {key} references a missing purchase order",
        )
        if row.EBELN not in purchases or key not in purchase_items:
            continue
        po = purchase_items[key]
        check(
            purchases[row.EBELN]["BEDAT"] <= row.BUDAT,
            f"receipt {key} precedes its purchase order",
        )
        check(
            row.CPUDT == row.BUDAT,
            f"receipt {key} has inconsistent entry and posting dates",
        )
        check(
            (row.OTIF_ONTIME == "X") == (row.BUDAT <= po["EINDT"]),
            f"receipt {key} has inconsistent on-time status",
        )
        check(
            abs(row.DMBTR - round(row.MENGE * po["NETPR"], 2)) < 0.011,
            f"receipt {key} has an inconsistent value",
        )
        receipt_qty[key] += row.MENGE
    for key, po in purchase_items.items():
        check(
            receipt_qty[key] <= po["MENGE"] + 1e-7,
            f"purchase order {key} is overreceived",
        )
        check(
            (po["ELIKZ"] == "X") == (abs(receipt_qty[key] - po["MENGE"]) < 1e-7),
            f"purchase order {key} has inconsistent completion status",
        )

    produced, consumed, sold, received = (
        defaultdict(float),
        defaultdict(float),
        defaultdict(float),
        defaultdict(float),
    )
    balances = defaultdict(float)
    for row in tables["opening_stock"].itertuples():
        balances[row.MATNR, row.WERKS, row.LGORT, row.CHARG] += row.LABST
    batches = tables["mch1"].set_index(["MATNR", "CHARG"]).to_dict("index")
    for row in tables["matdoc"].sort_values(["BUDAT", "EVENT_SEQ"]).itertuples():
        key = (row.MATNR, row.WERKS, row.LGORT, row.CHARG)
        check(
            str(row.MJAHR) == row.BUDAT[:4],
            f"material document {row.MBLNR} has an inconsistent year",
        )
        check(
            row.MENGE > 0, f"material document {row.MBLNR} has a nonpositive quantity"
        )
        check(
            (row.MATNR, row.CHARG) in batches,
            f"material document {row.MBLNR} references a missing batch",
        )
        if (row.MATNR, row.CHARG) in batches:
            batch = batches[row.MATNR, row.CHARG]
            check(
                batch["HSDAT"] <= row.BUDAT,
                f"material document {row.MBLNR} precedes batch manufacture",
            )
            if row.BWART in ("601", "261", "641"):
                check(
                    row.BUDAT <= batch["VFDAT"],
                    f"material document {row.MBLNR} consumes expired stock",
                )
        balances[key] += row.MENGE if row.SHKZG == "S" else -row.MENGE
        check(
            balances[key] >= -1e-7,
            f"material document {row.MBLNR} consumes unavailable stock",
        )
        if row.AUFNR:
            check(
                row.AUFNR in production,
                f"material document {row.MBLNR} references missing production",
            )
            if row.AUFNR in production:
                order = production[row.AUFNR]
                check(
                    order["GSTRI"] != "" and order["GSTRI"] <= row.BUDAT,
                    f"material document {row.MBLNR} precedes production start",
                )
                if row.BWART == "101":
                    produced[row.AUFNR] += row.MENGE
                    check(
                        row.BUDAT == order["GETRI"],
                        f"production {row.AUFNR} receipt disagrees with completion",
                    )
                elif row.BWART == "261":
                    consumed[row.AUFNR, row.MATNR] += row.MENGE
        if row.KDAUF:
            sold[row.KDAUF, row.KDPOS] += row.MENGE
        if row.EBELN:
            received[row.EBELN, row.EBELP] += row.MENGE
    for number, order in production.items():
        check(
            abs(produced[number] - order["IGMNG"]) < 1e-7,
            f"production {number} has inconsistent output",
        )
        check(
            (order["STAT"] == "CNF") == bool(order["GETRI"]),
            f"production {number} has inconsistent completion status",
        )
        check(
            order["GSTRP"] <= order["GLTRP"],
            f"production {number} finishes before its planned start",
        )
        if order["GETRI"]:
            check(
                order["GSTRI"] <= order["GETRI"],
                f"production {number} finishes before starting",
            )
    active_orders = tables["afko"][tables["afko"].GSTRI != ""]
    for line, orders_on_line in active_orders.groupby("ZZ_PRODUCTION_LINE"):
        previous_finish = ""
        for row in orders_on_line.sort_values("GSTRI").itertuples():
            check(
                row.GSTRI >= previous_finish,
                f"production line {line} contains overlapping orders",
            )
            previous_finish = row.GLTRP
    for row in tables["resb"].itertuples():
        check(
            row.AUFNR in production,
            f"reservation {row.RSNUM} references missing production",
        )
        check(
            abs(consumed[row.AUFNR, row.MATNR] - row.ENMNG) < 1e-7
            and row.ENMNG <= row.BDMNG + 1e-7,
            f"reservation {row.RSNUM} has inconsistent consumption",
        )
    for key in set(sold) | set(shipped):
        check(
            abs(sold[key] - shipped[key]) < 1e-7,
            f"sales item {key} has inconsistent goods issues",
        )
    for key in set(received) | set(receipt_qty):
        check(
            abs(received[key] - receipt_qty[key]) < 1e-7,
            f"purchase item {key} has inconsistent goods receipts",
        )
    closing = {
        tuple(row[k] for k in KEY): float(row["LABST"])
        for row in tables["mard"].to_dict("records")
    }
    for key in set(balances) | set(closing):
        check(
            abs(balances[key] - closing.get(key, 0)) < 1e-7,
            f"closing stock {key} disagrees with movements",
        )
    transfers = tables["plaf"][tables["plaf"].BESKZ == "U"]
    transfer_movements = {
        key: group for key, group in tables["matdoc"].groupby("XBLNR")
    }
    for row in transfers.itertuples():
        movements = transfer_movements.get(row.ID_REF, tables["matdoc"].iloc[:0])
        issues = movements[movements.BWART == "641"]
        receipts = movements[movements.SHKZG == "S"]
        check(
            abs(issues.MENGE.sum() - row.GSMNG) < 1e-7,
            f"transfer {row.ID_REF} disagrees with dispatch quantity",
        )
        check(
            issues.BUDAT.eq(row.PSTTR).all(),
            f"transfer {row.ID_REF} disagrees with dispatch date",
        )
        expected = row.GSMNG if row.PEDTR <= end else 0
        check(
            abs(receipts.MENGE.sum() - expected) < 1e-7
            and receipts.BUDAT.eq(row.PEDTR).all(),
            f"transfer {row.ID_REF} disagrees with receipt date or quantity",
        )
        check(row.PEDTR > row.PSTTR, f"transfer {row.ID_REF} has no transit time")

    history = tables["mardh"]
    month_ends = {
        (day.year, day.month): day.strftime("%Y%m%d")
        for _, day in timeframe.periods()
        if (day + timedelta(days=1)).month != day.month
    }
    check(
        all((int(r.LFGJA), int(r.LFMON)) in month_ends for r in history.itertuples()),
        "historical stock contains an incomplete or outside month",
    )
    running = defaultdict(float)
    for row in tables["opening_stock"].itertuples():
        running[row.MATNR, row.WERKS, row.LGORT, row.CHARG] += row.LABST
    movements = iter(tables["matdoc"].sort_values(["BUDAT", "EVENT_SEQ"]).itertuples())
    movement = next(movements, None)
    for (year, month), boundary in month_ends.items():
        while movement is not None and movement.BUDAT <= boundary:
            key = movement.MATNR, movement.WERKS, movement.LGORT, movement.CHARG
            running[key] += movement.MENGE if movement.SHKZG == "S" else -movement.MENGE
            movement = next(movements, None)
        snapshot = history[
            (history.LFGJA == str(year)) & (history.LFMON == f"{month:02d}")
        ]
        recorded = {
            (r.MATNR, r.WERKS, r.LGORT, r.CHARG): r.LABST for r in snapshot.itertuples()
        }
        check(
            all(
                abs(running[k] - recorded.get(k, 0)) < 1e-7
                for k in set(running) | set(recorded)
            ),
            f"historical stock {year}-{month:02d} disagrees with movements",
        )
    return {"ok": not errors, "errors": errors[:50], "error_count": len(errors)}
