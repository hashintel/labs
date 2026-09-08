from __future__ import annotations

import heapq
import math
import random
from collections import defaultdict
from datetime import date, timedelta

import pandas as pd

from ..scenarios.scheduling import ScenarioSchedule
from .common import PLANT_CONFIG, customs_days
from .transactions import TRANSPORT_MODES, get_best_transport_mode, haversine_km

SCHEMAS = {
    "vbak": "VBELN AUART KUNNR ERDAT VDATU NETWR WAERK ERNAM BSTNK ZZ_SCENARIO",
    "vbap": "VBELN POSNR MATNR WERKS LGORT KWMENG MEINS NETPR NETWR WAERK LFSTA",
    "vbep": "VBELN POSNR ETENR EDATU WMENG BMENG",
    "likp": "VBELN KUNNR WERKS ERDAT LFDAT WADAT WADAT_IST LFART WBSTK ZZ_ARRIVAL_DATE",
    "lips": "VBELN POSNR MATNR WERKS LGORT CHARG LFIMG VGBEL VGPOS",
    "vbfa": "VBELN POSNN VBELN_N POSNN_N VBTYP_V VBTYP_N RFMNG",
    "vttk": "TKNUM SHTYP VSART ROUTE TDLNR ERDAT DISTZ FAHZT DTTRG DTDIS DATBG DATEN STTRG",
    "vttp": "TKNUM TPNUM VBELN LAUFK",
    "vtts": "TKNUM TSNUM TSRFO ROUTE VSART KNOTA KNOTB DISTZ FAHZTD",
    "matdoc": "MBLNR MJAHR ZEILE BWART MATNR WERKS LGORT CHARG SHKZG MENGE MEINS BUDAT CPUDT CPUTM KDAUF KDPOS AUFNR EBELN EBELP XBLNR BKTXT EVENT_SEQ",
    "afko": "AUFNR PLNBEZ MATNR WERKS GAMNG IGMNG GSTRP GLTRP GSTRI GETRI RSNUM STAT ZZ_SHORTAGE_REASON ZZ_PRODUCTION_LINE",
    "resb": "RSNUM RSPOS AUFNR MATNR BDMNG ENMNG WERKS LGORT BDTER",
    "plaf": "PLNUM MATNR WERKS LWERK GSMNG MEINS PSTTR PEDTR BESKZ PLSCN DISPO SOBSL ID_REF",
    "ekko": "EBELN BUKRS BSTYP BSART LIFNR EKORG EKGRP WAERS BEDAT AEDAT ERNAM PROCSTAT",
    "ekpo": "EBELN EBELP MATNR WERKS LGORT MENGE MEINS NETPR NETWR INFNR ELIKZ EINDT",
    "ekbe": "EBELN EBELP ZEKKN VGABE BEWTP BWART BUDAT MENGE BPMNG DMBTR WRBTR WAERS SHKZG MATNR WERKS LIFNR XBLNR CPUDT CPUTM EINDT_PLAN OTIF_ONTIME OTIF_INFULL ZZ_SCENARIO",
    "mardh": "MATNR WERKS LGORT CHARG LFGJA LFMON LABST",
}
NUMERIC = {
    "NETWR",
    "KWMENG",
    "NETPR",
    "WMENG",
    "BMENG",
    "LFIMG",
    "RFMNG",
    "DISTZ",
    "FAHZT",
    "FAHZTD",
    "MENGE",
    "EVENT_SEQ",
    "GAMNG",
    "IGMNG",
    "BDMNG",
    "ENMNG",
    "GSMNG",
    "BPMNG",
    "DMBTR",
    "WRBTR",
    "LABST",
}


def sap(day):
    return day.strftime("%Y%m%d")


def frame(rows, columns):
    result = pd.DataFrame(rows).reindex(columns=["MANDT", *columns.split()])
    result["MANDT"] = "800"
    for column in result:
        result[column] = (
            result[column].fillna(0).astype(float)
            if column in NUMERIC
            else result[column].fillna("").astype("string")
        )
    return result


class Schedule:
    def __init__(self, config, store, parameters):
        self.config, self.store = config, store
        self.timeframe = config.timeframe
        self.rng = random.Random(config.random_seed)
        self.supplier_rng = random.Random(config.random_seed + 999)
        self.rows = {name: [] for name in SCHEMAS}
        self.queue, self.serial, self.processed = [], 0, 0
        self.pending = {}
        self.production = {}
        self.reservations = defaultdict(list)
        self.production_lanes = defaultdict(list)
        self.balances = defaultdict(float)
        self.lots = defaultdict(list)
        self.expiry = {}
        self.scenarios = ScenarioSchedule(config, parameters)
        self.scenarios.validate_targets(store)
        self.materials = store.read("mara").set_index("MATNR").MTART.to_dict()
        self.prices = {
            (r.MATNR, r.BWKEY): float(r.STPRS) * 1.35
            for r in store.read("mbew").itertuples()
        }
        self.customers = store.read("kna1").KUNNR.tolist()
        self.hub = config.hub_plant
        self.orders = int(parameters["NUM_ORDERS"])
        self.boms = defaultdict(list)
        bom_ids = (
            store.read("mast")
            .drop_duplicates("MATNR")
            .set_index("MATNR")
            .STLNR.to_dict()
        )
        components = defaultdict(lambda: defaultdict(float))
        for row in store.read("stpo").itertuples():
            components[row.STLNR][row.IDNRK] += float(row.MENGE)
        for material, bom in bom_ids.items():
            self.boms[material] = list(components[bom].items())
        self.initial = store.read("mard")
        for scenario in self.scenarios.items:
            if scenario.id == "SCN018":
                self.initial.loc[
                    self.initial.WERKS == scenario.config["new_plant"], "LABST"
                ] = 0.0
        self._opening_batches()
        self.initial = self.initial.copy()
        for row in self.initial.itertuples():
            key = (row.MATNR, row.WERKS, row.LGORT, row.CHARG)
            self.balances[key] += float(row.LABST)
            self.lots[key[:3]].append(key)
        self.opening = dict(self.balances)
        self.future_raw = defaultdict(list)
        self.demand = defaultdict(float)
        self._new_products()
        self.minimum_lots = {
            (r.MATNR, r.WERKS): float(r.BSTMI)
            for r in self.store.read("marc").itertuples()
        }

    def _opening_batches(self):
        mch1 = self.store.read("mch1")
        for row in mch1.itertuples():
            self.expiry[(row.MATNR, row.CHARG)] = date.fromisoformat(
                f"{row.VFDAT[:4]}-{row.VFDAT[4:6]}-{row.VFDAT[6:]}"
            )
        mcha = self.store.read("mcha")
        dates = mch1.set_index(["MATNR", "CHARG"])[["HSDAT", "VFDAT"]].to_dict("index")
        for idx, row in mcha.iterrows():
            values = dates[(row.MATNR, row.CHARG)]
            mcha.at[idx, "ERSDA"] = values["HSDAT"]
            mcha.at[idx, "VFDAT"] = values["VFDAT"]
        self.store.save("mcha", mcha)
        self.batch_master = mch1.to_dict("records")
        self.plant_batches = mcha.to_dict("records")
        self.batch_keys = {(r["MATNR"], r["CHARG"]) for r in self.batch_master}
        self.plant_batch_keys = {
            (r["MATNR"], r["WERKS"], r["CHARG"]) for r in self.plant_batches
        }
        for table, columns in {
            "crhd": ["ERDAT", "AEDAT"],
            "kako": ["BEGDA"],
            "plko": ["DATUV"],
            "stko": ["DATUV"],
        }.items():
            if self.store.exists(table):
                df = self.store.read(table)
                for column in columns:
                    if column in df:
                        df[column] = df[column].map(
                            lambda value: min(
                                str(value),
                                sap(self.timeframe.start - timedelta(days=1)),
                            )
                        )
                self.store.save(table, df)

    def _new_products(self):
        for item in self.scenarios.items:
            if item.id != "SCN012" or item.status == "OUTSIDE_TIMEFRAME":
                continue
            c = item.config
            base, new = c["base_material"], c["new_material"]
            for table in ("mara", "makt", "marc", "mbew", "marm", "mast"):
                df = self.store.read(table)
                copied = df[df.MATNR == base].copy()
                copied["MATNR"] = new
                for col in ("ERSDA", "LAEDA"):
                    if col in copied:
                        copied[col] = sap(max(item.start, self.timeframe.start))
                if "MAKTX" in copied:
                    copied["MAKTX"] = copied["MAKTX"].astype(str) + " New Formulation"
                self.store.save(table, pd.concat([df, copied], ignore_index=True))
            self.materials[new] = self.materials[base]
            self.boms[new] = list(self.boms[base])
            for plant in PLANT_CONFIG:
                self.prices[new, plant] = self.prices.get((base, plant), 100)
            self.scenarios.mark(item)

    def enqueue(self, day, priority, kind, payload):
        if not self.timeframe.contains(day):
            return
        self.serial += 1
        heapq.heappush(self.queue, (day, priority, self.serial, kind, payload))

    def batch(self, material, plant, day, batch=None):
        batch = batch or f"T{len(self.batch_keys) + 1:09d}"
        if (material, batch) not in self.batch_keys:
            self.batch_keys.add((material, batch))
            self.expiry[material, batch] = day + timedelta(days=730)
            self.batch_master.append(
                {
                    "MANDT": "800",
                    "MATNR": material,
                    "CHARG": batch,
                    "HSDAT": sap(day),
                    "LWEDT": sap(day),
                    "VFDAT": sap(self.expiry[material, batch]),
                    "ZUSTD": "",
                    "ZZ_ORIGIN_PLANT": plant,
                }
            )
        if (material, plant, batch) not in self.plant_batch_keys:
            self.plant_batch_keys.add((material, plant, batch))
            self.plant_batches.append(
                {
                    "MANDT": "800",
                    "MATNR": material,
                    "WERKS": plant,
                    "CHARG": batch,
                    "ERSDA": sap(day),
                    "VFDAT": sap(self.expiry[material, batch]),
                    "ZUSTD": "",
                    "CLABS": 0.0,
                }
            )
        return batch

    def movement(self, day, key, qty, direction, movement, **refs):
        if qty <= 0:
            return
        if direction == "H" and self.balances[key] + 1e-7 < qty:
            raise ValueError(
                f"insufficient stock for {key} on {day}: {self.balances[key]} available, {qty} required"
            )
        self.balances[key] += qty if direction == "S" else -qty
        if key not in self.lots[key[:3]]:
            self.lots[key[:3]].append(key)
        number = len(self.rows["matdoc"]) + 1
        self.rows["matdoc"].append(
            dict(
                MBLNR=f"{5000000000 + number}",
                MJAHR=str(day.year),
                ZEILE="0001",
                BWART=movement,
                MATNR=key[0],
                WERKS=key[1],
                LGORT=key[2],
                CHARG=key[3],
                SHKZG=direction,
                MENGE=qty,
                MEINS="PC",
                BUDAT=sap(day),
                CPUDT=sap(day),
                CPUTM="120000",
                EVENT_SEQ=number,
                **refs,
            )
        )

    def available(self, material, plant, day, sloc=None):
        sloc = sloc or ("RM01" if self.materials[material] == "ROH" else "FG01")
        return sum(
            self.balances[key]
            for key in self.lots[material, plant, sloc]
            if self.expiry.get((material, key[3]), date.max) >= day
        )

    def take(self, material, plant, day, qty, movement, sloc=None, **refs):
        sloc = sloc or ("RM01" if self.materials[material] == "ROH" else "FG01")
        allocated = []
        for key in self.lots[material, plant, sloc]:
            if self.expiry.get((material, key[3]), date.max) < day:
                continue
            amount = min(qty, self.balances[key])
            if amount > 0:
                self.movement(day, key, amount, "H", movement, **refs)
                allocated.append((key[3], amount))
                qty -= amount
            if qty < 1e-7:
                break
        if qty > 1e-7:
            raise ValueError(
                f"allocation for {material} at {plant} on {day} is short by {qty}"
            )
        return allocated

    def sales_order(
        self, day, material=None, plant=None, qty=None, scenario="", due=None
    ):
        number = f"{1000000000 + len(self.rows['vbak'])}"
        customer = self.rng.choice(self.customers)
        due = due or day + timedelta(days=7)
        header = {
            "VBELN": number,
            "AUART": "OR",
            "KUNNR": customer,
            "ERDAT": sap(day),
            "VDATU": sap(due),
            "NETWR": 0,
            "WAERK": self.config.currency.upper(),
            "ERNAM": "AUTO_JOB",
            "BSTNK": f"PO-{number}",
            "ZZ_SCENARIO": scenario,
        }
        self.rows["vbak"].append(header)
        choices = [
            m
            for m, t in self.materials.items()
            if t == "FERT"
            and not any(
                i.id == "SCN012" and i.config["new_material"] == m
                for i in self.scenarios.items
            )
        ]
        count = 1 if material else self.rng.randint(1, 3)
        for index in range(count):
            mat = material or self.rng.choice(choices)
            site = plant or self.rng.choice(list(PLANT_CONFIG))
            quantity = float(qty if qty is not None else self.rng.randint(10, 100))
            price = round(self.prices.get((mat, site), 100), 2)
            item = {
                "VBELN": number,
                "POSNR": f"{(index + 1) * 10:06d}",
                "MATNR": mat,
                "WERKS": site,
                "LGORT": "FG01",
                "KWMENG": quantity,
                "MEINS": "PC",
                "NETPR": price,
                "NETWR": round(quantity * price, 2),
                "WAERK": self.config.currency.upper(),
                "LFSTA": "A",
            }
            self.rows["vbap"].append(item)
            self.rows["vbep"].append(
                {
                    "VBELN": number,
                    "POSNR": item["POSNR"],
                    "ETENR": "0001",
                    "EDATU": sap(due),
                    "WMENG": quantity,
                    "BMENG": quantity,
                }
            )
            header["NETWR"] += item["NETWR"]
            self.demand[mat, site] += quantity
            if self.rng.random() < self.config.delivery_fill_rate:
                destination = self.rng.choice(
                    [p for p in PLANT_CONFIG if p != site] or [site]
                )
                transit, distance, mode, hours = self.route(site, destination)
                dispatch = max(day + timedelta(days=1), due - timedelta(days=transit))
                self.enqueue(
                    dispatch,
                    3,
                    "sale",
                    (header, item, (destination, transit, distance, mode, hours)),
                )
        header["NETWR"] = round(header["NETWR"], 2)

    def demand_scenarios(self):
        baseline = list(self.rows["vbap"])
        headers = {r["VBELN"]: r for r in self.rows["vbak"]}
        for item in self.scenarios.items:
            if item.status == "OUTSIDE_TIMEFRAME":
                continue
            c = item.config
            start, stop = (
                max(item.start, self.timeframe.start),
                min(item.stop, self.timeframe.end + timedelta(days=1)),
            )
            if item.id == "SCN013":
                raw = c["due_date"]
                due = date.fromisoformat(
                    raw if "-" in raw else f"{raw[:4]}-{raw[4:6]}-{raw[6:]}"
                )
                if due < start:
                    raise ValueError(
                        f"SCN013 due date {due} precedes order creation {start}"
                    )
                self.sales_order(
                    start, c["material"], c["plant"], c["qty"], item.id, due
                )
                self.scenarios.mark(item)
            elif item.id in {"SCN011", "SCN012", "SCN019", "SCN020"}:
                eligible = [
                    row
                    for row in baseline
                    if sap(start) <= headers[row["VBELN"]]["ERDAT"] < sap(stop)
                    and c.get("material", c.get("base_material", row["MATNR"]))
                    == row["MATNR"]
                    and c.get("plant", row["WERKS"]) == row["WERKS"]
                ]
                rate = c.get("increase_pct", c.get("volatility_pct", 100)) / 100
                count = round(len(eligible) * rate)
                for _ in range(count):
                    source = self.rng.choice(eligible)
                    day = start + timedelta(
                        days=self.rng.randrange((stop - start).days)
                    )
                    quantity = source["KWMENG"] * (
                        self.rng.uniform(0.3, 2) if item.id == "SCN020" else 1
                    )
                    self.sales_order(
                        day,
                        c.get("new_material", source["MATNR"]),
                        source["WERKS"],
                        max(1, round(quantity)),
                        item.id,
                    )
                    self.scenarios.mark(item)

    def purchases(self):
        raw_demand = defaultdict(float)
        for (material, _), quantity in self.demand.items():
            for component, factor in self.boms[material]:
                raw_demand[component] += quantity * factor
        info = self.store.read("eina").merge(
            self.store.read("eine").query("EKORG == '1000'"), on="INFNR"
        )
        counts = info.groupby("MATNR").size().to_dict()
        for start, end in self.timeframe.periods():
            weight = ((end - start).days + 1) / self.timeframe.days
            for record in info.to_dict("records"):
                material = record["MATNR"]
                quantity = raw_demand[material] * weight / counts[material]
                if quantity <= 0:
                    continue
                minimum = max(
                    float(record.get("MINBM", 100)),
                    self.minimum_lots.get(
                        (material, self.hub), self.config.moq_raw_min
                    ),
                )
                quantity = math.ceil(max(minimum, quantity) / 100) * 100
                day = start + timedelta(
                    days=self.rng.randint(0, min(6, (end - start).days))
                )
                planned = day + timedelta(days=max(1, int(record.get("APLFZ", 14))))
                actual, fill, sid = self.scenarios.supplier(
                    record["LIFNR"], material, planned, self.supplier_rng
                )
                if (
                    material in self.config.unreliable_materials
                    or self.supplier_rng.random()
                    > self.config.supplier_reliability_rate
                ):
                    fill *= self.supplier_rng.uniform(0.3, 0.8)
                    actual += timedelta(days=7)
                actual = self.scenarios.available(actual, self.hub, "shipment")
                number = str(4500000000 + len(self.rows["ekko"]))
                self.rows["ekko"].append(
                    {
                        "EBELN": number,
                        "BUKRS": "1000",
                        "BSTYP": "F",
                        "BSART": "NB",
                        "LIFNR": record["LIFNR"],
                        "EKORG": "1000",
                        "EKGRP": "P01",
                        "WAERS": self.config.currency.upper(),
                        "BEDAT": sap(day),
                        "AEDAT": sap(day),
                        "ERNAM": "AUTO_JOB",
                        "PROCSTAT": "05",
                    }
                )
                po = {
                    "EBELN": number,
                    "EBELP": "00010",
                    "MATNR": material,
                    "WERKS": self.hub,
                    "LGORT": "RM01",
                    "MENGE": quantity,
                    "MEINS": "PC",
                    "NETPR": float(record["NETPR"]),
                    "NETWR": round(quantity * float(record["NETPR"]), 2),
                    "INFNR": record["INFNR"],
                    "ELIKZ": "",
                    "EINDT": sap(planned),
                }
                self.rows["ekpo"].append(po)
                if actual <= self.timeframe.end:
                    self.future_raw[material].append(actual)
                    self.enqueue(
                        actual,
                        1,
                        "purchase",
                        (
                            po,
                            record["LIFNR"],
                            planned,
                            max(1, round(quantity * fill)),
                            sid,
                        ),
                    )
        for values in self.future_raw.values():
            values.sort()

    def purchase(self, day, data):
        po, vendor, planned, quantity, sid = data
        batch = self.batch(po["MATNR"], self.hub, day)
        refs = {
            "EBELN": po["EBELN"],
            "EBELP": po["EBELP"],
            "BKTXT": sid or "Supplier goods receipt",
        }
        self.movement(
            day, (po["MATNR"], self.hub, "RM01", batch), quantity, "S", "101", **refs
        )
        po["ELIKZ"] = "X" if quantity >= po["MENGE"] else ""
        self.rows["ekbe"].append(
            {
                "EBELN": po["EBELN"],
                "EBELP": po["EBELP"],
                "ZEKKN": "0001",
                "VGABE": "1",
                "BEWTP": "E",
                "BWART": "101",
                "BUDAT": sap(day),
                "MENGE": quantity,
                "BPMNG": quantity,
                "DMBTR": round(quantity * po["NETPR"], 2),
                "WRBTR": round(quantity * po["NETPR"], 2),
                "WAERS": self.config.currency.upper(),
                "SHKZG": "S",
                "MATNR": po["MATNR"],
                "WERKS": self.hub,
                "LIFNR": vendor,
                "XBLNR": po["EBELN"],
                "CPUDT": sap(day),
                "CPUTM": "120000",
                "EINDT_PLAN": sap(planned),
                "OTIF_ONTIME": "X" if day <= planned else "",
                "OTIF_INFULL": po["ELIKZ"],
                "ZZ_SCENARIO": sid,
            }
        )

    def supply(self, material, plant, day, quantity):
        key = (material, plant)
        if self.pending.get(key, date.min) >= day:
            return self.pending[key]
        new_facility = any(
            i.id == "SCN018" and i.config["new_plant"] == plant
            for i in self.scenarios.items
        )
        if plant != self.hub and (
            not new_facility or self.materials[material] == "ROH"
        ):
            permitted = self.scenarios.available(day, self.hub, "shipment")
            if permitted > day:
                return permitted
            if self.available(material, self.hub, day) >= quantity:
                transit, _, _, _ = self.route(self.hub, plant)
                arrival = day + timedelta(days=transit)
                arrival = self.scenarios.available(arrival, plant, "shipment")
                reference = f"TR{len(self.rows['plaf']) + 1}"
                allocated = self.take(
                    material, self.hub, day, quantity, "641", XBLNR=reference
                )
                for batch, amount in allocated:
                    self.enqueue(
                        arrival,
                        1,
                        "transfer",
                        (material, plant, batch, amount, reference),
                    )
                self.plan(material, plant, day, arrival, quantity, "U", reference)
                self.pending[key] = arrival
                return arrival
            return self.supply(material, self.hub, day, quantity)
        if self.materials[material] == "ROH":
            return min(
                (d for d in self.future_raw[material] if d > day),
                default=self.timeframe.end + timedelta(days=1),
            )
        start = self.scenarios.available(day, plant, "production")
        if self.production_lanes[plant]:
            start = max(start, min(self.production_lanes[plant]))
        quantity = max(
            quantity, self.minimum_lots.get(key, self.config.moq_finished_min)
        )
        if key not in self.production:
            number = f"{6000000000 + len(self.rows['afko'])}"
            order = {
                "AUFNR": number,
                "PLNBEZ": material,
                "MATNR": material,
                "WERKS": plant,
                "GAMNG": quantity,
                "IGMNG": 0,
                "GSTRP": sap(start),
                "GLTRP": sap(start + timedelta(days=3)),
                "GSTRI": "",
                "GETRI": "",
                "RSNUM": str(5000000000 + len(self.rows["afko"])),
                "STAT": "CRTD",
                "ZZ_SHORTAGE_REASON": "",
            }
            self.rows["afko"].append(order)
            self.production[key] = order
            for component, factor in self.boms[material]:
                reservation = {
                    "RSNUM": order["RSNUM"],
                    "RSPOS": f"{len(self.reservations[number]) + 1:04d}",
                    "AUFNR": number,
                    "MATNR": component,
                    "BDMNG": quantity * factor,
                    "ENMNG": 0,
                    "WERKS": plant,
                    "LGORT": "RM01",
                    "BDTER": sap(start),
                }
                self.rows["resb"].append(reservation)
                self.reservations[number].append(reservation)
        order = self.production[key]
        for scenario in self.scenarios.items:
            if (
                scenario.id == "SCN015"
                and scenario.active(day, plant)
                and self.rng.random() < scenario.config["cancel_ratio"]
            ):
                order["STAT"] = "DLFL"
                self.production.pop(key)
                self.scenarios.mark(scenario)
                return scenario.stop
        if start > day:
            order["GSTRP"], order["GLTRP"] = sap(start), sap(start + timedelta(days=3))
            return start
        quantity = order["GAMNG"]
        missing = [
            m
            for m, factor in self.boms[material]
            if self.available(m, plant, day) + 1e-7 < quantity * factor
        ]
        if missing:
            order["ZZ_SHORTAGE_REASON"] = "Insufficient components: " + ", ".join(
                missing
            )
            if plant != self.hub:
                factors = dict(self.boms[material])
                upcoming = [
                    self.supply(m, plant, day, quantity * factors[m]) for m in missing
                ]
            else:
                upcoming = [d for m in missing for d in self.future_raw[m] if d > day]
            next_day = min(upcoming, default=self.timeframe.end + timedelta(days=1))
            order["GSTRP"], order["GLTRP"] = (
                sap(next_day),
                sap(next_day + timedelta(days=3)),
            )
            return next_day
        finish = self.scenarios.production_finish(day, plant, material)
        lanes = self.production_lanes[plant]
        if lanes:
            lane = lanes.index(min(lanes))
            lanes[lane] = finish
            order["ZZ_PRODUCTION_LINE"] = f"{plant}-{lane + 1}"
        for component, factor in self.boms[material]:
            self.take(
                component, plant, day, quantity * factor, "261", AUFNR=order["AUFNR"]
            )
        for reservation in self.reservations[order["AUFNR"]]:
            reservation["ENMNG"] = reservation["BDMNG"]
            reservation["BDTER"] = sap(day)
        order.update(
            STAT="REL",
            GSTRP=sap(day),
            GSTRI=sap(day),
            GLTRP=sap(finish),
            ZZ_SHORTAGE_REASON="",
        )
        self.plan(material, plant, day, finish, quantity, "E", order["AUFNR"])
        self.pending[key] = finish
        self.enqueue(finish, 1, "production", (order, key))
        return finish

    def plan(self, material, plant, start, finish, quantity, kind, reference=""):
        self.rows["plaf"].append(
            {
                "PLNUM": f"{1000000 + len(self.rows['plaf'])}",
                "MATNR": material,
                "WERKS": plant,
                "LWERK": self.hub if kind == "U" else "",
                "GSMNG": quantity,
                "MEINS": "PC",
                "PSTTR": sap(start),
                "PEDTR": sap(finish),
                "BESKZ": kind,
                "PLSCN": "000",
                "DISPO": "MRP",
                "SOBSL": "40" if kind == "U" else "",
                "ID_REF": reference,
            }
        )

    def route(self, source, destination):
        a, b = PLANT_CONFIG[source], PLANT_CONFIG[destination]
        distance = haversine_km(a["ypos"], a["xpos"], b["ypos"], b["xpos"])
        mode = get_best_transport_mode(source, destination, distance)
        hours = distance / TRANSPORT_MODES[mode]["speed_kmh"]
        return (
            max(1, math.ceil(hours / 24) + customs_days(a["country"], b["country"])),
            distance,
            mode,
            hours,
        )

    def sale(self, day, data):
        header, item, route_info = data
        mat, plant, quantity = item["MATNR"], item["WERKS"], item["KWMENG"]
        permitted = self.scenarios.available(day, plant, "shipment")
        if permitted > day:
            self.enqueue(permitted, 3, "sale", data)
            return
        if self.available(mat, plant, day) + 1e-7 < quantity:
            ready = self.supply(mat, plant, day, quantity)
            self.enqueue(max(day + timedelta(days=1), ready), 3, "sale", data)
            return
        destination, transit, distance, mode, hours = route_info
        arrival = day + timedelta(days=transit)
        number = f"{8000000000 + len(self.rows['likp'])}"
        self.rows["likp"].append(
            {
                "VBELN": number,
                "KUNNR": header["KUNNR"],
                "WERKS": plant,
                "ERDAT": sap(day),
                "LFDAT": sap(arrival),
                "WADAT": sap(day),
                "WADAT_IST": sap(day),
                "LFART": "LF",
                "WBSTK": "C",
                "ZZ_ARRIVAL_DATE": sap(arrival)
                if arrival <= self.timeframe.end
                else "",
            }
        )
        allocated = self.take(
            mat,
            plant,
            day,
            quantity,
            "601",
            KDAUF=item["VBELN"],
            KDPOS=item["POSNR"],
            XBLNR=number,
        )
        for index, (batch, amount) in enumerate(allocated):
            position = f"{(index + 1) * 10:06d}"
            self.rows["lips"].append(
                {
                    "VBELN": number,
                    "POSNR": position,
                    "MATNR": mat,
                    "WERKS": plant,
                    "LGORT": "FG01",
                    "CHARG": batch,
                    "LFIMG": amount,
                    "VGBEL": item["VBELN"],
                    "VGPOS": item["POSNR"],
                }
            )
            self.rows["vbfa"].append(
                {
                    "VBELN": item["VBELN"],
                    "POSNN": item["POSNR"],
                    "VBELN_N": number,
                    "POSNN_N": position,
                    "VBTYP_V": "C",
                    "VBTYP_N": "J",
                    "RFMNG": amount,
                }
            )
        item["LFSTA"] = "C"
        from .common import route_code

        route = route_code(plant, destination)
        shipment = str(7000000000 + len(self.rows["vttk"]))
        self.rows["vttk"].append(
            {
                "TKNUM": shipment,
                "SHTYP": "0001",
                "VSART": TRANSPORT_MODES[mode]["vsart"],
                "ROUTE": route,
                "TDLNR": {"ROAD": "DHL", "SEA": "MAERSK", "AIR": "FEDEX"}[mode],
                "ERDAT": sap(day),
                "DISTZ": distance,
                "FAHZT": hours,
                "DTTRG": sap(arrival),
                "DTDIS": sap(day),
                "DATBG": sap(day),
                "DATEN": sap(arrival) if arrival <= self.timeframe.end else "",
                "STTRG": "7" if arrival <= self.timeframe.end else "5",
            }
        )
        self.rows["vttp"].append(
            {"TKNUM": shipment, "TPNUM": "000010", "VBELN": number, "LAUFK": "A"}
        )
        self.rows["vtts"].append(
            {
                "TKNUM": shipment,
                "TSNUM": "0001",
                "TSRFO": "0001",
                "ROUTE": route,
                "VSART": TRANSPORT_MODES[mode]["vsart"],
                "KNOTA": plant,
                "KNOTB": destination,
                "DISTZ": distance,
                "FAHZTD": hours,
            }
        )

    def inventory_scenario(self, day, item, opening=False):
        c, sid = item.config, item.id
        affected = []
        remaining = c.get("qty", math.inf)
        for key in list(self.balances):
            material, plant, sloc, batch = key
            if (
                c.get("material", "ALL") not in ("ALL", material)
                or c.get("plant", plant) != plant
            ):
                continue
            if c.get("sloc", c.get("from_sloc", "ALL")) not in ("ALL", sloc):
                continue
            if sloc == "QA01" and sid in {"SCN001", "SCN005", "SCN006", "SCN009"}:
                continue
            if c.get("batch", batch) not in (batch, "ALL", ""):
                continue
            quantity = self.balances[key]
            if sid not in {"SCN003", "SCN006", "SCN008", "SCN009"}:
                quantity = min(quantity, remaining)
            if quantity <= 0:
                continue
            quarantine = sid in {"SCN001", "SCN005", "SCN006", "SCN009"}
            if opening:
                self.balances[key] -= quantity
            else:
                self.movement(
                    day, key, quantity, "H", "311" if quarantine else "551", BKTXT=sid
                )
            if quarantine:
                target = (material, plant, "QA01", batch)
                if opening:
                    self.balances[target] += quantity
                    if target not in self.lots[target[:3]]:
                        self.lots[target[:3]].append(target)
                else:
                    self.movement(day, target, quantity, "S", "311", BKTXT=sid)
                affected.append((key, target, quantity, sid))
            remaining -= quantity
            self.scenarios.mark(item)
        if sid in {"SCN005", "SCN006", "SCN009"}:
            self.enqueue(item.stop, 1, "release", affected)

    def run(self):
        for _ in range(self.orders):
            self.sales_order(
                self.timeframe.start
                + timedelta(days=self.rng.randrange(self.timeframe.days))
            )
        self.demand_scenarios()
        daily_volume = sum(self.demand.values()) / self.timeframe.days
        lane_count = max(
            1, math.ceil(daily_volume * 3 / max(1, self.config.moq_finished_min))
        )
        for plant in PLANT_CONFIG:
            self.production_lanes[plant] = [self.timeframe.start] * lane_count
        self.purchases()
        for item in sorted(self.scenarios.items, key=lambda i: i.start):
            if (
                item.id
                in {
                    "SCN001",
                    "SCN002",
                    "SCN003",
                    "SCN005",
                    "SCN006",
                    "SCN007",
                    "SCN008",
                    "SCN009",
                }
                and item.status != "OUTSIDE_TIMEFRAME"
            ):
                if item.start < self.timeframe.start:
                    self.inventory_scenario(self.timeframe.start, item, opening=True)
                else:
                    self.enqueue(item.start, 0, "inventory", item)
        self.opening = dict(self.balances)
        for _, end in self.timeframe.periods():
            if (end + timedelta(days=1)).month != end.month:
                self.enqueue(end, 9, "snapshot", None)
        while self.queue:
            day, _, _, kind, data = heapq.heappop(self.queue)
            self.processed += 1
            if kind == "sale":
                self.sale(day, data)
            elif kind == "purchase":
                self.purchase(day, data)
            elif kind == "inventory":
                self.inventory_scenario(day, data)
            elif kind == "release":
                for source, target, qty, sid in data:
                    qty = min(qty, self.balances[target])
                    self.movement(day, target, qty, "H", "311", BKTXT=sid)
                    self.movement(day, source, qty, "S", "311", BKTXT=sid)
            elif kind == "production":
                order, key = data
                batch = self.batch(key[0], key[1], day)
                self.movement(
                    day,
                    (*key, "FG01", batch),
                    order["GAMNG"],
                    "S",
                    "101",
                    AUFNR=order["AUFNR"],
                )
                order.update(IGMNG=order["GAMNG"], GETRI=sap(day), STAT="CNF")
                self.production.pop(key)
                self.pending.pop(key)
            elif kind == "transfer":
                material, plant, batch, quantity, reference = data
                self.batch(material, plant, day, batch)
                sloc = "RM01" if self.materials[material] == "ROH" else "FG01"
                self.movement(
                    day,
                    (material, plant, sloc, batch),
                    quantity,
                    "S",
                    "101",
                    XBLNR=reference,
                    BKTXT="Stock transfer receipt",
                )
                self.pending.pop((material, plant), None)
            elif kind == "snapshot":
                for (material, plant, sloc, batch), qty in self.balances.items():
                    self.rows["mardh"].append(
                        {
                            "MATNR": material,
                            "WERKS": plant,
                            "LGORT": sloc,
                            "CHARG": batch,
                            "LFGJA": str(day.year),
                            "LFMON": f"{day.month:02d}",
                            "LABST": qty,
                        }
                    )
        self.save()

    def save(self):
        for name, rows in self.rows.items():
            self.store.save(name, frame(rows, SCHEMAS[name]))

        def stock_frame(balances):
            return frame(
                [
                    {"MATNR": m, "WERKS": p, "LGORT": s, "CHARG": b, "LABST": q}
                    for (m, p, s, b), q in balances.items()
                ],
                "MATNR WERKS LGORT CHARG LABST",
            )

        self.store.save("opening_stock", stock_frame(self.opening))
        self.store.save("mard", stock_frame(self.balances))
        unrestricted = defaultdict(float)
        for (material, plant, sloc, batch), quantity in self.balances.items():
            if sloc != "QA01":
                unrestricted[material, plant, batch] += quantity
        for row in self.plant_batches:
            row["CLABS"] = unrestricted[row["MATNR"], row["WERKS"], row["CHARG"]]
            row["CINSM"] = self.balances.get(
                (row["MATNR"], row["WERKS"], "QA01", row["CHARG"]), 0
            )
            row["ZUSTD"] = "X" if row["CINSM"] > 0 else ""
        for name, rows in (("mch1", self.batch_master), ("mcha", self.plant_batches)):
            df = pd.DataFrame(rows)
            for col in df:
                df[col] = (
                    df[col].fillna(0)
                    if col in {"CLABS", "CINSM", "CUMLM", "CEINM", "CSPEM"}
                    else df[col].fillna("").astype("string")
                )
            self.store.save(name, df)
        marc = self.store.read("marc")
        marc["EISBE"] = [
            round(
                self.demand.get((r.MATNR, r.WERKS), 0)
                / self.timeframe.days
                * 7
                * self.config.safety_stock_weeks
            )
            for r in marc.itertuples()
        ]
        self.store.save("marc", marc)
        self.scenarios.save(self.store)
        self.store.save(
            "generation_metadata",
            pd.DataFrame(
                [
                    {
                        "TIMEFRAME_START": self.timeframe.start.isoformat(),
                        "TIMEFRAME_END": self.timeframe.end.isoformat(),
                        "TIMEFRAME_DAYS": self.timeframe.days,
                        "BASELINE_ORDERS": self.orders,
                        "SCENARIO_ORDERS": len(self.rows["vbak"]) - self.orders,
                        "EVENTS_SCHEDULED": self.serial,
                        "EVENTS_PROCESSED": self.processed,
                        "OPENING_STOCK_DATE": sap(
                            self.timeframe.start - timedelta(days=1)
                        ),
                        "CLOSING_STOCK_DATE": sap(self.timeframe.end),
                    }
                ]
            ),
        )


def generate(config, store, parameters):
    schedule = Schedule(config, store, parameters)
    schedule.run()
