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
    "vbap": "VBELN POSNR MATNR WERKS LGORT KWMENG MEINS NETPR NETWR WAERK LFSTA ZZ_FULFILLMENT_REASON ZZ_STOCK_WAIT_DATE",
    "vbep": "VBELN POSNR ETENR EDATU WMENG BMENG",
    "likp": "VBELN KUNNR WERKS ERDAT LFDAT WADAT WADAT_IST LFART WBSTK ZZ_ARRIVAL_DATE",
    "lips": "VBELN POSNR MATNR WERKS LGORT CHARG LFIMG VGBEL VGPOS",
    "vbfa": "VBELN POSNN VBELN_N POSNN_N VBTYP_V VBTYP_N RFMNG",
    "vttk": "TKNUM SHTYP VSART ROUTE TDLNR ERDAT DISTZ FAHZT DTTRG DTDIS DATBG DATEN STTRG",
    "vttp": "TKNUM TPNUM VBELN LAUFK",
    "vtts": "TKNUM TSNUM TSRFO ROUTE VSART KNOTA KNOTB DISTZ FAHZTD",
    "matdoc": "MBLNR MJAHR ZEILE BWART MATNR WERKS LGORT CHARG SHKZG MENGE MEINS BUDAT CPUDT CPUTM KDAUF KDPOS AUFNR EBELN EBELP XBLNR BKTXT EVENT_SEQ",
    "afko": "AUFNR PLNBEZ MATNR WERKS GAMNG IGMNG GSTRP GLTRP GSTRI GETRI RSNUM STAT ZZ_SHORTAGE_REASON ZZ_PRODUCTION_LINE ZZ_SCENARIO",
    "resb": "RSNUM RSPOS AUFNR MATNR BDMNG ENMNG WERKS LGORT BDTER",
    "plaf": "PLNUM MATNR WERKS LWERK GSMNG MEINS PSTTR PEDTR BESKZ PLSCN DISPO SOBSL ID_REF",
    "ekko": "EBELN BUKRS BSTYP BSART LIFNR EKORG EKGRP WAERS BEDAT AEDAT ERNAM PROCSTAT",
    "ekpo": "EBELN EBELP MATNR WERKS LGORT MENGE MEINS NETPR NETWR INFNR ELIKZ EINDT",
    "ekbe": "EBELN EBELP ZEKKN VGABE BEWTP BWART BUDAT MENGE BPMNG DMBTR WRBTR WAERS SHKZG MATNR WERKS LIFNR XBLNR CPUDT CPUTM EINDT_PLAN OTIF_ONTIME OTIF_INFULL ZZ_SCENARIO",
    "mardh": "MATNR WERKS LGORT CHARG LFGJA LFMON LABST SPEME",
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
    "SPEME",
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
        self.waiting_sales = defaultdict(dict)
        self.production = {}
        self.reservations = defaultdict(list)
        self.quarantines = []
        self.production_lanes = defaultdict(list)
        self.balances = defaultdict(float)
        self.blocked = defaultdict(float)
        self.lots = defaultdict(list)
        self.expiry = {}
        self.scenarios = ScenarioSchedule(config, parameters)
        self.scenarios.validate_targets(store)
        self.materials = store.read("mara").set_index("MATNR").MTART.to_dict()
        self.prices = {
            (r.MATNR, r.BWKEY): float(r.STPRS) * 1.35
            for r in store.read("mbew").itertuples()
        }
        self.customer_locations = self.prepare_customers()
        self.customers = list(self.customer_locations)
        self.routes = store.read("tvro").to_dict("records")
        self.customer_routes = set()
        self.hub = config.hub_plant
        self.orders = int(parameters["NUM_ORDERS"])
        self.boms = defaultdict(list)
        bom_ids = (
            store.read("mast")
            .drop_duplicates("MATNR")
            .set_index("MATNR")
            .STLNR.to_dict()
        )
        conversions = self.prepare_units()
        components = defaultdict(lambda: defaultdict(float))
        for row in store.read("stpo").itertuples():
            components[row.STLNR][row.IDNRK] += (
                float(row.MENGE) * conversions[row.IDNRK, row.MEINS]
            )
        for material, bom in bom_ids.items():
            self.boms[material] = list(components[bom].items())
        self.initial = store.read("mard")
        for scenario in self.scenarios.items:
            if scenario.id == "SCN018" and scenario.status != "OUTSIDE_TIMEFRAME":
                self.initial.loc[
                    self.initial.WERKS == scenario.config["new_plant"], "LABST"
                ] = 0.0
        self._opening_batches()
        self.initial = self.initial.copy()
        finished = self.initial.MATNR.map(self.materials).eq("FERT")
        self.initial.loc[finished, "LABST"] = self.initial.loc[finished, "LABST"].map(
            math.floor
        )
        for row in self.initial.itertuples():
            key = (row.MATNR, row.WERKS, row.LGORT, row.CHARG)
            self.balances[key] += float(row.LABST)
            self.lots[key[:3]].append(key)
        self.opening = dict(self.balances)
        self.future_raw = defaultdict(list)
        self.raw_pending = {}
        self.purchase_info = store.read("eina").merge(
            store.read("eine").query("EKORG == '1000'"), on="INFNR"
        )
        self.demand = defaultdict(float)
        self._new_products()
        self.workloads = []
        self.minimum_lots = {
            (r.MATNR, r.WERKS): float(r.BSTMI)
            for r in self.store.read("marc").itertuples()
        }

    def prepare_units(self):
        units = self.store.read("marm").copy()
        base = units[units.MEINH.eq("PC")].set_index("MATNR")
        for unit, column in (("KG", "BRGEW"), ("L", "VOLUM")):
            mask = units.MEINH.eq(unit)
            units.loc[mask, "UMREZ"] = 1
            units.loc[mask, "UMREN"] = units.loc[mask, "MATNR"].map(base[column])
        grams = units[units.MEINH.eq("KG")].copy()
        grams["MEINH"] = "GRM"
        grams["UMREN"] *= 1000
        grams["BRGEW"] = 0.001
        units = pd.concat([units, grams], ignore_index=True)
        self.store.save("marm", units)
        materials = self.store.read("mara").copy()
        materials["BRGEW"] = materials.MATNR.map(base.BRGEW)
        self.store.save("mara", materials)
        return {
            (r.MATNR, r.MEINH): float(r.UMREZ) / float(r.UMREN)
            for r in units.itertuples()
        }

    def prepare_customers(self):
        locations = {
            "GB": ("Manchester", "M1 1AD", 53.4808, -2.2426),
            "US": ("Newark", "07102", 40.7357, -74.1724),
            "DE": ("Frankfurt", "60313", 50.1109, 8.6821),
            "FR": ("Lyon", "69002", 45.7640, 4.8357),
            "IN": ("Mumbai", "400001", 19.0760, 72.8777),
        }
        customers = self.store.read("kna1").copy()
        result = {}
        for index, row in customers.iterrows():
            city, postal, latitude, longitude = locations[row.LAND1]
            customers.loc[index, ["ORT01", "PSTLZ"]] = [city, postal]
            customers.loc[index, "ZZ_LATITUDE"] = latitude
            customers.loc[index, "ZZ_LONGITUDE"] = longitude
            result[row.KUNNR] = (row.LAND1, latitude, longitude)
        self.store.save("kna1", customers)
        return result

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
        balances = self.blocked if movement == "555" else self.balances
        if direction == "H" and balances[key] + 1e-7 < qty:
            raise ValueError(
                f"insufficient stock for {key} on {day}: {balances[key]} available, {qty} required"
            )
        balances[key] += qty if direction == "S" else -qty
        if movement == "344":
            self.blocked[key] += qty
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
        self,
        day,
        material=None,
        plant=None,
        qty=None,
        scenario="",
        due=None,
        force_delivery=False,
    ):
        number = f"{1000000000 + len(self.rows['vbak'])}"
        customer = self.rng.choice(self.customers)
        requested_due = due
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
        open_plants = [
            site
            for site in PLANT_CONFIG
            if not any(
                i.id == "SCN018"
                and i.status != "OUTSIDE_TIMEFRAME"
                and i.config["new_plant"] == site
                and day < i.start
                for i in self.scenarios.items
            )
        ]
        for index in range(count):
            mat = material or self.rng.choice(choices)
            site = plant or self.rng.choice(open_plants)
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
                "ZZ_FULFILLMENT_REASON": "Not yet due",
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
            transit, distance, mode, hours = self.customer_route(site, customer)
            item_due = requested_due or day + timedelta(days=max(7, transit + 2))
            header["VDATU"] = max(header["VDATU"], sap(item_due))
            self.rows["vbep"][-1]["EDATU"] = sap(item_due)
            if self.rng.random() < self.config.delivery_fill_rate or force_delivery:
                dispatch = max(
                    day + timedelta(days=1), item_due - timedelta(days=transit)
                )
                self.enqueue(
                    dispatch,
                    3,
                    "sale",
                    (header, item, (customer, transit, distance, mode, hours)),
                )
            else:
                item["ZZ_FULFILLMENT_REASON"] = "Delivery block"
                self.rows["vbep"][-1]["BMENG"] = 0
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
            if start >= stop:
                continue
            if item.id == "SCN013":
                raw = c["due_date"]
                due = date.fromisoformat(
                    raw if "-" in raw else f"{raw[:4]}-{raw[4:6]}-{raw[6:]}"
                )
                if due < self.timeframe.start:
                    item.status = "OUTSIDE_TIMEFRAME"
                    continue
                start = min(start, max(self.timeframe.start, due - timedelta(days=1)))
                item.start = start
                self.sales_order(
                    start, c["material"], c["plant"], c["qty"], item.id, due
                )
                self.scenarios.mark(item)
            elif item.id in {"SCN011", "SCN012", "SCN016", "SCN019", "SCN020"}:
                matching = [
                    row
                    for row in baseline
                    if sap(start) <= headers[row["VBELN"]]["ERDAT"] < sap(stop)
                    and c.get("material", c.get("base_material", row["MATNR"]))
                    == row["MATNR"]
                    and c.get("plant", row["WERKS"]) == row["WERKS"]
                ]
                materials = c.get(
                    "materials", [c.get("new_material", c.get("material"))]
                )
                rate = (
                    c.get(
                        "increase_pct",
                        c.get("volatility_pct", c.get("contention_pct", 100)),
                    )
                    / 100
                )
                for material in materials:
                    eligible = [
                        r
                        for r in matching
                        if item.id != "SCN016" or r["MATNR"] == material
                    ]
                    minimum = (
                        5 if item.id == "SCN019" else 3 if item.id == "SCN012" else 1
                    )
                    count = max(minimum, round(len(eligible) * rate)) if rate > 0 else 0
                    for index in range(count):
                        source = (
                            self.rng.choice(eligible)
                            if eligible
                            else {
                                "MATNR": material
                                or self.rng.choice(
                                    [
                                        m
                                        for m, t in self.materials.items()
                                        if t == "FERT"
                                    ]
                                ),
                                "WERKS": c.get("plant", self.hub),
                                "KWMENG": self.rng.randint(50, 200),
                            }
                        )
                        day = start + timedelta(
                            days=self.rng.randrange(max(1, (stop - start).days))
                        )
                        quantity = source["KWMENG"]
                        lead = 7
                        if item.id == "SCN020":
                            quantity *= 1 + self.rng.uniform(-rate, rate) * 2
                            lead = self.rng.choice([3, 5, 7, 10, 14, 21])
                        elif item.id == "SCN019":
                            quantity *= self.rng.uniform(0.9, 1.3)
                            lead = self.rng.randint(3, 7)
                            if index == 0:
                                day = start
                                quantity = max(
                                    quantity,
                                    self.available(
                                        source["MATNR"], source["WERKS"], day
                                    )
                                    + self.config.moq_finished_min * rate,
                                )
                        quantity = max(10, round(quantity))
                        product = material or source["MATNR"]
                        self.sales_order(
                            day,
                            product,
                            source["WERKS"],
                            quantity,
                            item.id,
                            day + timedelta(days=lead),
                            force_delivery=item.id == "SCN019" and index == 0,
                        )
                        if item.id == "SCN016":
                            self.workloads.append(
                                {
                                    "day": day,
                                    "material": product,
                                    "plant": source["WERKS"],
                                    "qty": quantity,
                                    "scenario": item,
                                    "order": None,
                                }
                            )
                        self.scenarios.mark(item)
            elif item.id == "SCN014":
                plant = c["plant"]
                quantity = self.config.moq_finished_min
                lanes = len(self.production_lanes[plant])
                count = math.ceil(lanes * (stop - start).days * c["capacity_pct"] / 300)
                products = [m for m, t in self.materials.items() if t == "FERT"]
                for index in range(count):
                    material = products[index % len(products)]
                    day = start + timedelta(
                        days=min(
                            (stop - start).days - 1,
                            int(index * (stop - start).days / count),
                        )
                    )
                    self.workloads.append(
                        {
                            "day": day,
                            "material": material,
                            "plant": plant,
                            "qty": quantity,
                            "scenario": item,
                            "order": None,
                        }
                    )
                    self.demand[material, plant] += quantity

    def workload(self, day, request):
        key = request["material"], request["plant"]
        order = request["order"]
        if order is not None and order["GSTRI"]:
            return
        if key in self.production and self.production[key] is not order:
            ready = max(
                day + timedelta(days=1),
                date.fromisoformat(self.production[key]["GLTRP"]),
            )
        else:
            ready = self.supply(
                *key,
                day,
                request["qty"],
                force_production=True,
                scenario_id=request["scenario"].id,
            )
            request["order"] = self.production.get(key)
            if request["order"] is not None and order is not request["order"]:
                self.scenarios.mark(request["scenario"])
            if request["order"] is not None and request["order"]["GSTRI"]:
                return
        self.enqueue(max(day + timedelta(days=1), ready), 2, "workload", request)

    def replenish(self, material, day, quantity):
        if material in self.raw_pending:
            return self.raw_pending[material]
        records = self.purchase_info[self.purchase_info.MATNR.eq(material)]
        if records.empty:
            return self.timeframe.end + timedelta(days=1)
        record = self.rng.choice(records.to_dict("records"))
        minimum = max(
            float(record.get("MINBM", 100)),
            self.minimum_lots.get((material, self.hub), self.config.moq_raw_min),
        )
        quantity = math.ceil(max(minimum, quantity))
        planned = day + timedelta(days=max(1, int(record.get("APLFZ", 14))))
        actual, fill, sid = self.scenarios.supplier(
            record["LIFNR"], material, planned, self.supplier_rng
        )
        if (
            material in self.config.unreliable_materials
            or self.supplier_rng.random() > self.config.supplier_reliability_rate
        ):
            fill *= self.supplier_rng.uniform(0.3, 0.8)
            actual += timedelta(days=7)
        actual = self.scenarios.available(actual, self.hub, "receipt")
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
        self.raw_pending[material] = actual
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
                    round(quantity * fill, 6),
                    sid,
                ),
            )
        self.future_raw[material].sort()
        return actual

    def purchase(self, day, data):
        po, vendor, planned, quantity, sid = data
        self.raw_pending.pop(po["MATNR"], None)
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

    def supply(
        self, material, plant, day, quantity, *, force_production=False, scenario_id=""
    ):
        key = (material, plant)
        if self.pending.get(key, date.min) >= day:
            return self.pending[key]
        new_facility = any(
            i.id == "SCN018"
            and i.status != "OUTSIDE_TIMEFRAME"
            and i.config["new_plant"] == plant
            for i in self.scenarios.items
        )
        if (
            not force_production
            and plant != self.hub
            and (not new_facility or self.materials[material] == "ROH")
        ):
            permitted = self.scenarios.available(day, self.hub, "shipment")
            if permitted > day:
                return permitted
            if self.available(material, self.hub, day) >= quantity:
                transit, _, _, _ = self.route(self.hub, plant)
                arrival = day + timedelta(days=transit)
                arrival = self.scenarios.available(arrival, plant, "receipt")
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
            return self.replenish(
                material, day, max(0, quantity - self.available(material, plant, day))
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
                "ZZ_SCENARIO": scenario_id,
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
                    self.supply(
                        m,
                        plant,
                        day,
                        quantity * factors[m] - self.available(m, plant, day),
                    )
                    for m in missing
                ]
            else:
                factors = dict(self.boms[material])
                upcoming = [
                    self.supply(m, plant, day, quantity * factors[m]) for m in missing
                ]
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
            stock = self.available(component, self.hub, day)
            cover = self.component_cover[component]
            if stock < cover:
                self.replenish(component, day, 2 * cover - stock)
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

    def customer_route(self, source, customer):
        plant = PLANT_CONFIG[source]
        country, latitude, longitude = self.customer_locations[customer]
        distance = haversine_km(plant["ypos"], plant["xpos"], latitude, longitude)
        europe = {"GB", "IE", "DE", "FR", "NL", "BE", "IT", "ES", "PL", "AT", "CH"}
        mode = (
            "ROAD"
            if (
                plant["country"] == country
                or plant["country"] in europe
                and country in europe
            )
            else "AIR"
        )
        hours = max(1, distance / TRANSPORT_MODES[mode]["speed_kmh"])
        transit = max(
            1, math.ceil(hours / 24) + customs_days(plant["country"], country)
        )
        code = f"C{source}{country}"
        if code not in self.customer_routes:
            self.customer_routes.add(code)
            self.routes.append(
                {
                    "MANDT": "800",
                    "ROUTE": code,
                    "TRAZTD": transit,
                    "TDVZTD": transit,
                    "FAHZTD": hours,
                    "DISTZ": distance,
                    "MEDST": "KM",
                    "VSART": TRANSPORT_MODES[mode]["vsart"],
                    "TDLNR": "DHL" if mode == "ROAD" else "FEDEX",
                }
            )
        return transit, distance, mode, hours

    def sale(self, day, data):
        header, item, route_info = data
        mat, plant, quantity = item["MATNR"], item["WERKS"], item["KWMENG"]
        waiting = self.waiting_sales[mat, plant]
        key = (item["VBELN"], item["POSNR"])
        waiting[key] = data
        if next(iter(waiting)) != key:
            item["ZZ_FULFILLMENT_REASON"] = "Awaiting earlier order"
            return
        permitted = self.scenarios.available(day, plant, "shipment")
        if permitted > day:
            item["ZZ_FULFILLMENT_REASON"] = "Shipment blocked by scenario"
            self.enqueue(permitted, 3, "sale", data)
            return
        if self.available(mat, plant, day) + 1e-7 < quantity:
            item["ZZ_FULFILLMENT_REASON"] = "Awaiting stock"
            item.setdefault("ZZ_STOCK_WAIT_DATE", sap(day))
            ready = self.supply(
                mat, plant, day, quantity - self.available(mat, plant, day)
            )
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
        del waiting[key]
        if waiting:
            self.enqueue(day, 3, "sale", next(iter(waiting.values())))
        item["ZZ_FULFILLMENT_REASON"] = ""
        route = f"C{plant}{self.customer_locations[destination][0]}"
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

    def inventory_scenario(self, day, item, opening=False, plant_filter=None):
        c, sid = item.config, item.id
        affected = []
        deferred = set()
        remaining = c.get("qty", math.inf)

        def matches(key):
            material, plant, sloc, batch = key
            return (
                (plant_filter is None or plant == plant_filter)
                and c.get("material", "ALL") in ("ALL", material)
                and c.get("plant", plant) == plant
                and c.get("sloc", c.get("from_sloc", "ALL")) in ("ALL", sloc)
                and c.get("batch", batch) in (batch, "ALL", "")
            )

        if sid in {"SCN005", "SCN006", "SCN009"}:
            for hold in list(self.quarantines):
                if not matches(hold[0]):
                    continue
                quantity = min(hold[2], remaining)
                if quantity <= 0:
                    continue
                if quantity < hold[2]:
                    hold[2] -= quantity
                    hold = [*hold[:2], quantity, *hold[3:]]
                    self.quarantines.append(hold)
                    self.enqueue(hold[4], 1, "release", [hold])
                hold[4] = max(hold[4], item.stop)
                remaining -= quantity
                self.scenarios.mark(item)
        for key in list(self.balances):
            material, plant, sloc, batch = key
            if not matches(key):
                continue
            if sloc == "QA01" and sid in {"SCN001", "SCN005", "SCN006", "SCN009"}:
                continue
            if not opening and sid in {"SCN005", "SCN006", "SCN009"}:
                if plant in deferred:
                    continue
                permitted = self.scenarios.available(day, plant, "inventory")
                if permitted > day:
                    self.enqueue(permitted, 0, "inventory_deferred", (item, plant))
                    deferred.add(plant)
                    continue
            if sid in {"SCN003", "SCN008"} and self.blocked[key] > 0:
                if opening:
                    self.blocked[key] = 0
                else:
                    self.movement(day, key, self.blocked[key], "H", "555", BKTXT=sid)
                self.scenarios.mark(item)
            quantity = self.balances[key]
            if sid not in {"SCN003", "SCN006", "SCN008", "SCN009"}:
                quantity = min(quantity, remaining)
            if quantity <= 0:
                continue
            quarantine = sid in {"SCN005", "SCN006", "SCN009"}
            movement = "344" if sid == "SCN001" else "311" if quarantine else "551"
            if opening:
                self.balances[key] -= quantity
                if sid == "SCN001":
                    self.blocked[key] += quantity
            else:
                self.movement(day, key, quantity, "H", movement, BKTXT=sid)
            if quarantine:
                target = (material, plant, "QA01", batch)
                if opening:
                    self.balances[target] += quantity
                    if target not in self.lots[target[:3]]:
                        self.lots[target[:3]].append(target)
                else:
                    self.movement(day, target, quantity, "S", "311", BKTXT=sid)
                hold = [key, target, quantity, sid, max(day, item.stop)]
                self.quarantines.append(hold)
                affected.append(hold)
            remaining -= quantity
            self.scenarios.mark(item)
        if sid in {"SCN005", "SCN006", "SCN009"}:
            self.enqueue(max(day, item.stop), 1, "release", affected)

    def run(self):
        for _ in range(self.orders):
            self.sales_order(
                self.timeframe.start
                + timedelta(days=self.rng.randrange(self.timeframe.days))
            )
        production_batches = 0
        for material, kind in self.materials.items():
            if kind != "FERT":
                continue
            needed = sum(
                quantity
                for (product, _), quantity in self.demand.items()
                if product == material
            )
            stock = sum(
                self.available(material, plant, self.timeframe.start)
                for plant in PLANT_CONFIG
            )
            lot = self.minimum_lots.get(
                (material, self.hub), self.config.moq_finished_min
            )
            production_batches += math.ceil(max(0, needed - stock) / lot)
        lane_count = max(
            1, math.ceil(production_batches * 3 / self.timeframe.days / 0.6)
        )
        for plant in PLANT_CONFIG:
            self.production_lanes[plant] = [self.timeframe.start] * lane_count
        self.store.save(
            "production_capacity",
            pd.DataFrame(
                [
                    {"WERKS": plant, "PARALLEL_LINES": lane_count}
                    for plant in PLANT_CONFIG
                ]
            ),
        )
        self.demand_scenarios()
        self.component_cover = defaultdict(float)
        lead_times = self.purchase_info.groupby("MATNR").APLFZ.max().to_dict()
        for (material, _), quantity in self.demand.items():
            for component, factor in self.boms.get(material, []):
                self.component_cover[component] += (
                    quantity
                    * factor
                    / self.timeframe.days
                    * max(1, lead_times.get(component, 14))
                )
        required = defaultdict(float)
        for request in self.workloads:
            quantity = max(
                request["qty"],
                self.minimum_lots.get(
                    (request["material"], request["plant"]),
                    self.config.moq_finished_min,
                ),
            )
            for component, factor in self.boms[request["material"]]:
                required[component] += quantity * factor
        workload_plants = {self.hub, *(request["plant"] for request in self.workloads)}
        for material, quantity in required.items():
            missing = quantity - sum(
                self.available(material, plant, self.timeframe.start)
                for plant in workload_plants
            )
            if missing > 1e-7:
                self.replenish(material, self.timeframe.start, missing)
        for request in self.workloads:
            self.enqueue(request["day"], 2, "workload", request)
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
        self.opening_blocked = dict(self.blocked)
        for _, end in self.timeframe.periods():
            if (end + timedelta(days=1)).month != end.month:
                self.enqueue(end, 9, "snapshot", None)
        while self.queue:
            day, _, _, kind, data = heapq.heappop(self.queue)
            self.processed += 1
            if kind == "workload":
                self.workload(day, data)
            elif kind == "sale":
                self.sale(day, data)
            elif kind == "purchase":
                self.purchase(day, data)
            elif kind == "inventory_deferred":
                item, plant = data
                self.inventory_scenario(day, item, plant_filter=plant)
            elif kind == "inventory":
                self.inventory_scenario(day, data)
            elif kind == "release":
                for hold in data:
                    source, target, qty, sid, until = hold
                    permitted = self.scenarios.available(
                        max(day, until), source[1], "inventory"
                    )
                    if permitted > day:
                        self.enqueue(permitted, 1, "release", [hold])
                        continue
                    qty = min(qty, self.balances[target])
                    self.movement(day, target, qty, "H", "311", BKTXT=sid)
                    self.movement(day, source, qty, "S", "311", BKTXT=sid)
                    hold[2] = 0
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
                            "SPEME": self.blocked[(material, plant, sloc, batch)],
                        }
                    )
        self.save()

    def save(self):
        self.store.save("tvro", pd.DataFrame(self.routes))
        for name, rows in self.rows.items():
            self.store.save(name, frame(rows, SCHEMAS[name]))

        def stock_frame(balances, blocked):
            return frame(
                [
                    {
                        "MATNR": m,
                        "WERKS": p,
                        "LGORT": s,
                        "CHARG": b,
                        "LABST": q,
                        "SPEME": blocked.get((m, p, s, b), 0),
                    }
                    for (m, p, s, b), q in balances.items()
                ],
                "MATNR WERKS LGORT CHARG LABST SPEME",
            )

        self.store.save(
            "opening_stock", stock_frame(self.opening, self.opening_blocked)
        )
        self.store.save("mard", stock_frame(self.balances, self.blocked))
        unrestricted = defaultdict(float)
        for (material, plant, sloc, batch), quantity in self.balances.items():
            if sloc != "QA01":
                unrestricted[material, plant, batch] += quantity
        blocked_batches = defaultdict(float)
        for (material, plant, _, batch), quantity in self.blocked.items():
            blocked_batches[material, plant, batch] += quantity
        for row in self.plant_batches:
            row["CSPEM"] = blocked_batches[row["MATNR"], row["WERKS"], row["CHARG"]]
            row["CLABS"] = unrestricted[row["MATNR"], row["WERKS"], row["CHARG"]]
            row["CINSM"] = self.balances.get(
                (row["MATNR"], row["WERKS"], "QA01", row["CHARG"]), 0
            )
            row["ZUSTD"] = "X" if row["CINSM"] > 0 or row["CSPEM"] > 0 else ""
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
