"""Generate SAP master data with pandas."""
import pandas as pd
import numpy as np
from faker import Faker
import random
import uuid
from math import radians, sin, cos, sqrt, asin
from datetime import datetime, timedelta

from .common import PLANT_CONFIG, param, seed_all


def dirty_key(value, dirty_rate=0.05):
    """Apply random dirty transformation to a key value."""
    if not GENERATE_DIRTY_DATA or random.random() > dirty_rate:
        return value  # Keep clean

    transformations = [
        lambda v: '0' + str(v),           # Add leading zero
        lambda v: ' ' + str(v),           # Add leading space
        lambda v: str(v) + ' ',           # Add trailing space
        lambda v: str(v).lower(),         # Lowercase
        lambda v: str(v).lstrip('0'),     # Strip leading zeros
        lambda v: '  ' + str(v) + '  ',   # Multiple spaces
    ]
    return random.choice(transformations)(str(value))

def create_orphan_key(prefix='ORPHAN'):
    """Create a key that doesn't exist in the reference set."""
    return f"{prefix}_{random.randint(100000, 999999)}"

def dirty_date(date_str, dirty_rate=0.05):
    """Convert date from YYYYMMDD to random dirty format."""
    if not GENERATE_DIRTY_DATA or random.random() > dirty_rate or not date_str:
        return date_str

    try:
        date_str = str(date_str)
        year = date_str[:4]
        month = date_str[4:6]
        day = date_str[6:8]

        formats = [
            f"{day}/{month}/{year}",      # DD/MM/YYYY
            f"{month}-{day}-{year}",      # MM-DD-YYYY
            f"{year}-{month}-{day}",      # YYYY-MM-DD (ISO)
            f"{day}.{month}.{year}",      # DD.MM.YYYY (European)
        ]
        return random.choice(formats)
    except:
        return date_str

def dirty_dataframe(df, key_columns, dirty_rate=0.05):
    """Apply dirty transformations to specified columns in a DataFrame."""
    if not GENERATE_DIRTY_DATA or dirty_rate <= 0:
        return df

    df_dirty = df.copy()
    for col in key_columns:
        if col in df_dirty.columns:
            mask = np.random.random(len(df_dirty)) < dirty_rate
            df_dirty.loc[mask, col] = df_dirty.loc[mask, col].apply(
                lambda x: dirty_key(x, dirty_rate=1.0)  # Already selected, always dirty
            )
    return df_dirty

def inject_orphan_records(df, fk_column, orphan_rate=0.03, prefix='ORPHAN'):
    """Replace some foreign keys with non-existent values."""
    if not GENERATE_DIRTY_DATA or orphan_rate <= 0:
        return df

    df_dirty = df.copy()
    mask = np.random.random(len(df_dirty)) < orphan_rate
    n_orphans = mask.sum()

    if n_orphans > 0:
        orphan_keys = [f"{prefix}_{i:06d}" for i in range(n_orphans)]
        df_dirty.loc[mask, fk_column] = orphan_keys

    return df_dirty

def inject_duplicates(df, key_column, dup_rate=0.01):
    """Duplicate some rows to create duplicate key issues."""
    if not GENERATE_DIRTY_DATA or dup_rate <= 0:
        return df

    n_dups = max(1, int(len(df) * dup_rate))
    dup_indices = np.random.choice(df.index, size=min(n_dups, len(df)), replace=False)
    duplicates = df.loc[dup_indices].copy()

    return pd.concat([df, duplicates], ignore_index=True)

def inject_nulls(df, columns, null_rate=0.02):
    """Inject NULL values into specified columns."""
    if not GENERATE_DIRTY_DATA or null_rate <= 0:
        return df

    df_dirty = df.copy()
    for col in columns:
        if col in df_dirty.columns:
            mask = np.random.random(len(df_dirty)) < null_rate
            df_dirty.loc[mask, col] = None

    return df_dirty

def apply_dirty_data_masterdata(df, table_name, config):
    """Apply configured dirty-data transformations."""
    if not GENERATE_DIRTY_DATA:
        return df

    np.random.seed(RANDOM_SEED + hash(table_name) % 1000)
    random.seed(RANDOM_SEED + hash(table_name) % 1000)

    df_dirty = df.copy()

    if 'key_columns' in config:
        df_dirty = dirty_dataframe(df_dirty, config['key_columns'], DIRTY_DATA_RATE)

    if 'orphan_config' in config:
        for fk_col, rate, prefix in config['orphan_config']:
            df_dirty = inject_orphan_records(df_dirty, fk_col, rate, prefix)

    if 'pk_column' in config and 'dup_rate' in config:
        df_dirty = inject_duplicates(df_dirty, config['pk_column'], config['dup_rate'])

    if 'null_columns' in config:
        df_dirty = inject_nulls(df_dirty, config['null_columns'], config.get('null_rate', 0.02))

    return df_dirty

def generate_kna1_data():
    data = []
    for kunnr in PREDEFINED_CUSTOMERS:
        country = 'IN' if kunnr == CUST_INDIA else random.choice(['GB', 'US', 'DE', 'FR'])
        data.append({
            'MANDT': '800', 'KUNNR': kunnr, 'NAME1': fake.company(),
            'ORT01': fake.city(), 'PSTLZ': fake.postcode(), 'LAND1': country,
            'KTGRD': '01', 'ERDAT': datetime.now().strftime('%Y%m%d')
        })
    return pd.DataFrame(data)

def generate_mara_data():
    data = []
    for matnr in PREDEFINED_MATERIALS:
        if matnr in FINISHED_GOODS: mtart = 'FERT'
        elif matnr in INTERMEDIATE_GOODS: mtart = 'HALB'
        else: mtart = 'ROH'
        data.append({
            'MANDT': '800', 'MATNR': matnr, 'MTART': mtart,
            'MATKL': '01', 'MEINS': 'PC', 'BRGEW': round(random.uniform(0.1, 100), 2)
        })
    return pd.DataFrame(data)

def generate_makt_data():
    data = []
    languages = ['EN', 'DE', 'FR']

    for matnr in PREDEFINED_MATERIALS:
        if matnr in PARENT_MATERIALS:
            base_name = f"{random.choice(PRODUCT_ADJECTIVES)} {random.choice(PRODUCT_NOUNS)}"
        else:
            base_name = f"Raw Material {matnr}"

        for lang in languages:
            if lang == 'EN':
                desc = base_name
            else:
                desc = f"{base_name} ({lang})"

            data.append({'MANDT': '800', 'MATNR': matnr, 'SPRAS': lang, 'MAKTX': desc})

    return pd.DataFrame(data)

def generate_marc_data():
    """
    MOQ Logic (Industry Standard):
    - Finished Goods: MOQ from parameters (default 250-1000), driven by production batch economics
    - Intermediate Goods: Larger batches for efficiency (2x finished goods range)
    - Raw Materials: Supplier-driven MOQ from parameters (default 1000-10000)
    """
    data = []

    fg_moq_options = [MOQ_FINISHED_MIN, int((MOQ_FINISHED_MIN + MOQ_FINISHED_MAX) / 2), MOQ_FINISHED_MAX]
    raw_moq_options = [MOQ_RAW_MIN, int((MOQ_RAW_MIN + MOQ_RAW_MAX) / 2), MOQ_RAW_MAX]
    int_moq_options = [x * 2 for x in fg_moq_options]

    for matnr in PREDEFINED_MATERIALS:
        for werks in PREDEFINED_PLANTS:
            if matnr in FINISHED_GOODS:
                min_lot = random.choice(fg_moq_options)
                max_lot = min_lot * random.choice([10, 20, 50])
                rounding = min_lot // 5 if min_lot >= 50 else 10
            elif matnr in INTERMEDIATE_GOODS:
                min_lot = random.choice(int_moq_options)
                max_lot = min_lot * random.choice([10, 20])
                rounding = min_lot // 5 if min_lot >= 100 else 50
            else:  # Raw materials - supplier MOQ
                min_lot = random.choice(raw_moq_options)
                max_lot = min_lot * random.choice([5, 10, 20])
                rounding = min_lot // 4 if min_lot >= 500 else 100

            data.append({
                'MANDT': '800', 'MATNR': matnr, 'WERKS': werks,
                'BESKZ': 'E' if matnr in FINISHED_GOODS else 'F',
                'EISBE': 0,
                'BSTMI': min_lot,  # Minimum Lot Size (MOQ)
                'BSTMA': max_lot,  # Maximum Lot Size
                'BSTFE': min_lot,  # Fixed Lot Size
                'BSTRF': rounding, # Rounding Value
                'LGPRO': 'RM01' if matnr in RAW_MATERIALS else 'FG01',
                'DISPO': 'D01'
            })
    return pd.DataFrame(data)

def generate_batch_id(matnr, werks, batch_num, year=2025):
    """Generate a batch ID in SAP format: BATCH-YYYY-MMMNNN (material prefix + sequence)"""
    mat_suffix = matnr.replace('MAT-', '').replace('-', '')[:4]
    return f"B{year}{mat_suffix}{batch_num:03d}"

def generate_mch1_data(batch_records):
    """
    Generate MCH1 (Batch Master - Cross Plant) table.
    Contains batch header information at material level.
    """
    data = []
    seen_batches = set()

    for rec in batch_records:
        batch_key = (rec['MATNR'], rec['CHARG'])
        if batch_key in seen_batches:
            continue
        seen_batches.add(batch_key)

        prod_date = datetime.now() - timedelta(days=random.randint(1, 180))
        shelf_life_days = random.choice([365, 730, 1095])  # 1, 2, or 3 years
        expiry_date = prod_date + timedelta(days=shelf_life_days)

        data.append({
            'MANDT': '800',
            'MATNR': rec['MATNR'],
            'CHARG': rec['CHARG'],
            'ZZ_BATCH_VERSION': str(random.randint(1, 5)),
            'HSDAT': prod_date.strftime('%Y%m%d'),  # Production date
            'VFDAT': expiry_date.strftime('%Y%m%d'),  # Expiry date
            'LWEDT': prod_date.strftime('%Y%m%d'),
            'ZZ_LAST_GI_DATE': '',
            'ZUSTD': '',
            'ZZ_RESTRICTION_REASON': '',
            'ZZ_ORIGIN_PLANT': rec['WERKS'],
            'LOBM_LIFNR': '',  # Vendor (if externally sourced)
        })

    return pd.DataFrame(data)

def generate_mcha_data(batch_records):
    """
    Generate MCHA (Batch Master - Plant Level) table.
    Contains batch data at material-plant level.
    """
    data = []
    seen_batches = set()

    for rec in batch_records:
        batch_key = (rec['MATNR'], rec['WERKS'], rec['CHARG'])
        if batch_key in seen_batches:
            continue
        seen_batches.add(batch_key)

        prod_date = datetime.now() - timedelta(days=random.randint(1, 180))
        expiry_date = prod_date + timedelta(days=random.choice([365, 730, 1095]))

        data.append({
            'MANDT': '800',
            'MATNR': rec['MATNR'],
            'WERKS': rec['WERKS'],
            'CHARG': rec['CHARG'],
            'LVORM': '',  # Deletion flag
            'ERSDA': prod_date.strftime('%Y%m%d'),  # Created on
            'ERNAM': 'SYSTEM',  # Created by
            'VFDAT': expiry_date.strftime('%Y%m%d'),  # Expiry date
            'ZUSTD': '',
            'CLABS': rec['LABST'],  # Valuated unrestricted stock
            'CUMLM': 0,  # Stock in transfer
            'CINSM': 0,  # Stock in quality inspection
            'CEINM': 0,  # Restricted-use stock
            'CSPEM': 0,  # Blocked stock
        })

    return pd.DataFrame(data)

def generate_mard_data():
    """
    Generate MARD (Storage Location Data) with batch-level inventory.
    Each material-plant-location combination can have multiple batches.
    """
    data = []

    for matnr in PREDEFINED_MATERIALS:
        for werks in PREDEFINED_PLANTS:
            lgort = 'RM01' if matnr in RAW_MATERIALS else 'FG01'
            if matnr == MAT_VEGGIE_CAPS:
                total_stock = 0.0
                num_batches = 0
            else:
                total_stock = round(random.uniform(100, 5000), 2)
                num_batches = random.randint(1, 4) if total_stock > 0 else 0

            if num_batches == 0:
                data.append({
                    'MANDT': '800',
                    'MATNR': matnr,
                    'WERKS': werks,
                    'LGORT': lgort,
                    'CHARG': '',  # No batch for zero stock
                    'LABST': 0.0
                })
            else:
                remaining_stock = total_stock
                for batch_num in range(1, num_batches + 1):
                    if batch_num == num_batches:
                        batch_stock = remaining_stock
                    else:
                        batch_stock = round(remaining_stock * random.uniform(0.2, 0.6), 2)
                        remaining_stock -= batch_stock

                    batch_id = generate_batch_id(matnr, werks, batch_num)

                    data.append({
                        'MANDT': '800',
                        'MATNR': matnr,
                        'WERKS': werks,
                        'LGORT': lgort,
                        'CHARG': batch_id,
                        'LABST': round(batch_stock, 2)
                    })

    return pd.DataFrame(data)

def generate_mbew_data():
    data = []
    plant_cost_factors = {'1000': 1.0, '2000': 1.15, '3000': 0.85, '4000': 1.25}

    for matnr in PREDEFINED_MATERIALS:
        if matnr in FINISHED_GOODS:
            base_price = round(random.uniform(50, 500), 2)
        elif matnr in INTERMEDIATE_GOODS:
            base_price = round(random.uniform(20, 200), 2)
        else:  # Raw materials
            base_price = round(random.uniform(5, 100), 2)

        for werks in PREDEFINED_PLANTS:
            location_factor = plant_cost_factors.get(werks, 1.0)
            std_price = round(base_price * location_factor, 2)
            mov_avg_price = round(std_price * random.uniform(0.95, 1.05), 2)

            stock_qty = round(random.uniform(100, 5000), 2)
            stock_value = round(stock_qty * std_price, 2)

            data.append({
                'MANDT': '800',
                'MATNR': matnr,
                'BWKEY': werks,
                'WAERS': 'GBP',           # Currency
                'VPRSV': 'S',             # Price Control (S=Standard, V=Moving Avg)
                'VERPR': mov_avg_price,   # Moving Average Price
                'STPRS': std_price,       # Standard Price
                'PEINH': 1,               # Price Unit
                'LBKUM': stock_qty,       # Total Valuated Stock
                'SALK3': stock_value,     # Total Stock Value
                'ZKPRS': round(std_price * 0.9, 2),  # Future/Planned Price
                'ZKDAT': (datetime.now() + timedelta(days=90)).strftime('%Y%m%d'),  # Future Price Date
                'BKLAS': '3000' if matnr in FINISHED_GOODS else '3001'  # Valuation Class
            })
    return pd.DataFrame(data)

def generate_marm_data():
    """
    Generates MARM (Material Units of Measure) table.
    Contains conversion factors between different units:
    - PC (Eaches/Pieces) - Base unit
    - KG (Mass)
    - PAL (Pallets)
    - DOS (Doses/Uses)
    - L (Volume/Liters)
    """
    data = []

    for matnr in PREDEFINED_MATERIALS:
        if matnr in FINISHED_GOODS:
            base_weight_kg = round(random.uniform(0.05, 2.0), 4)
            doses_per_unit = random.choice([1, 7, 14, 28, 30, 60, 90])
            units_per_pallet = random.choice([100, 200, 500, 1000])
            volume_liters = round(base_weight_kg * random.uniform(0.8, 1.2), 4)
        elif matnr in INTERMEDIATE_GOODS:
            base_weight_kg = round(random.uniform(0.5, 10.0), 4)
            doses_per_unit = random.choice([100, 500, 1000])
            units_per_pallet = random.choice([50, 100, 200])
            volume_liters = round(base_weight_kg * random.uniform(0.9, 1.1), 4)
        else:  # Raw materials
            base_weight_kg = round(random.uniform(1.0, 25.0), 4)
            doses_per_unit = 0  # Raw materials don't have doses
            units_per_pallet = random.choice([20, 40, 50, 100])
            volume_liters = round(base_weight_kg * random.uniform(0.7, 1.3), 4)

        data.append({
            'MANDT': '800', 'MATNR': matnr, 'MEINH': 'PC',
            'UMREZ': 1, 'UMREN': 1,  # 1 PC = 1 PC (base)
            'LAENG': 0, 'BREIT': 0, 'HOEHE': 0,
            'VOLUM': volume_liters, 'VOLEH': 'L',
            'BRGEW': base_weight_kg, 'GEWEI': 'KG'
        })

        if base_weight_kg > 0:
            data.append({
                'MANDT': '800', 'MATNR': matnr, 'MEINH': 'KG',
                'UMREZ': 1, 'UMREN': round(1 / base_weight_kg, 4),
                'LAENG': 0, 'BREIT': 0, 'HOEHE': 0,
                'VOLUM': 0, 'VOLEH': 'L',
                'BRGEW': 1, 'GEWEI': 'KG'
            })

        data.append({
            'MANDT': '800', 'MATNR': matnr, 'MEINH': 'PAL',
            'UMREZ': units_per_pallet, 'UMREN': 1,  # X PC = 1 PAL
            'LAENG': 120, 'BREIT': 80, 'HOEHE': 150,  # Standard EUR pallet dims in CM
            'VOLUM': round(units_per_pallet * volume_liters, 2), 'VOLEH': 'L',
            'BRGEW': round(units_per_pallet * base_weight_kg, 2), 'GEWEI': 'KG'
        })

        if volume_liters > 0:
            data.append({
                'MANDT': '800', 'MATNR': matnr, 'MEINH': 'L',
                'UMREZ': 1, 'UMREN': round(1 / volume_liters, 4),
                'LAENG': 0, 'BREIT': 0, 'HOEHE': 0,
                'VOLUM': 1, 'VOLEH': 'L',
                'BRGEW': round(base_weight_kg / volume_liters, 4), 'GEWEI': 'KG'
            })

        if doses_per_unit > 0:
            data.append({
                'MANDT': '800', 'MATNR': matnr, 'MEINH': 'DOS',
                'UMREZ': 1, 'UMREN': doses_per_unit,  # 1 PC = X DOS
                'LAENG': 0, 'BREIT': 0, 'HOEHE': 0,
                'VOLUM': round(volume_liters / doses_per_unit, 6), 'VOLEH': 'L',
                'BRGEW': round(base_weight_kg / doses_per_unit, 6), 'GEWEI': 'KG'
            })

    return pd.DataFrame(data)



EU_COUNTRIES = {'NL', 'DE', 'PL', 'FR', 'BE', 'ES', 'IT', 'AT', 'CZ', 'HU', 'SK', 'RO', 'BG', 'GR', 'PT', 'SE', 'DK', 'FI', 'IE'}

TRANSPORT_MODES = {
    'ROAD': {'speed_kmh': 60, 'cost_per_km': 0.50},
    'SEA': {'speed_kmh': 25, 'cost_per_km': 0.15},
    'AIR': {'speed_kmh': 800, 'cost_per_km': 3.00},
}

PORT_PLANTS = {'3000', '4000'}

def haversine_km(lat1, lon1, lat2, lon2):
    """Calculate the great circle distance in kilometers between two points on Earth."""
    R = 6371  # Earth radius in km
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = sin(dlat/2)**2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon/2)**2
    return R * 2 * asin(sqrt(a))

def customs_days(country_from, country_to):
    """Calculate customs delay days based on border crossing."""
    from_eu = country_from in EU_COUNTRIES
    to_eu = country_to in EU_COUNTRIES
    from_gb = country_from == 'GB'
    to_gb = country_to == 'GB'

    if (from_gb and to_eu) or (from_eu and to_gb):
        return 1
    return 0

def generate_sapapo_loc_data():
    """
    Generates /SAPAPO/LOC - APO Location Master with Geo Coordinates.
    Extends location data with geographical coordinates for distance calculation.
    """
    data = []
    for locno, loc_info in PLANT_CONFIG.items():
        data.append({
            'MANDT': '800',
            'LOCNO': locno,
            'LOCTYPE': '1001',  # Plant
            'XPOS': loc_info['xpos'],
            'YPOS': loc_info['ypos'],
            'COUNTRY': loc_info['country'],
            'CITY': loc_info['city'],
        })
    return pd.DataFrame(data)

def generate_sapapo_tr_data():
    """
    Generates /SAPAPO/TR - APO Transportation Lane Header.
    Creates all plant-to-plant combinations excluding self-loops.
    """
    data = []
    plants = list(PLANT_CONFIG)

    for loc_from in plants:
        for loc_to in plants:
            if loc_from == loc_to:
                continue  # Skip self-loops

            from_info = PLANT_CONFIG[loc_from]
            to_info = PLANT_CONFIG[loc_to]

            trlid = str(uuid.uuid4()).replace('-', '').upper()[:32]
            lane_name = f"{from_info['city']} -> {to_info['city']}"

            data.append({
                'MANDT': '800',
                'TRLID': trlid,
                'LOCFR': loc_from,
                'LOCTO': loc_to,
                'TRNAME': lane_name,
                'MODEL': 'SAPAPO_MODEL',
            })

    return pd.DataFrame(data)

def generate_sapapo_trm_data(df_tr):
    """
    Generates /SAPAPO/TRM - Means of Transport for Transportation Lanes.
    For each lane, calculates cost/time for each transport mode and marks preferred.
    """
    data = []

    for _, lane in df_tr.iterrows():
        trlid = lane['TRLID']
        loc_from = lane['LOCFR']
        loc_to = lane['LOCTO']

        from_info = PLANT_CONFIG[loc_from]
        to_info = PLANT_CONFIG[loc_to]

        distance_km = haversine_km(
            from_info['ypos'], from_info['xpos'],
            to_info['ypos'], to_info['xpos']
        )

        customs_delay_days = customs_days(from_info['country'], to_info['country'])
        customs_delay_hours = customs_delay_days * 24

        available_modes = ['ROAD', 'AIR']

        if loc_from in PORT_PLANTS and loc_to in PORT_PLANTS and distance_km > 200:
            available_modes.append('SEA')

        mode_costs = {}
        mode_records = []

        for mode in available_modes:
            mode_info = TRANSPORT_MODES[mode]

            travel_hours = distance_km / mode_info['speed_kmh']
            total_hours = travel_hours + customs_delay_hours

            transport_cost = round(distance_km * mode_info['cost_per_km'], 2)

            mode_costs[mode] = transport_cost
            mode_records.append({
                'MANDT': '800',
                'TRLID': trlid,
                'TRMID': mode,
                'TRAESSION': round(total_hours, 2),
                'TRACOST': transport_cost,
                'TRACOSTCUR': mode_info['currency'],
                'PRIFLAG': '',  # Will be set below
            })

        if mode_costs:
            preferred_mode = min(mode_costs, key=mode_costs.get)
            for record in mode_records:
                if record['TRMID'] == preferred_mode:
                    record['PRIFLAG'] = 'X'

        data.extend(mode_records)

    return pd.DataFrame(data)

def generate_tvro_data():
    """
    Generates TVRO - SAP ERP Routes.
    Route naming: R{FROM}{TO} e.g., R1020 = Route from 1000 to 2000
    """
    data = []
    plants = list(PLANT_CONFIG)

    shipping_types = {'ROAD': '01', 'RAIL': '02', 'SEA': '03', 'AIR': '04'}
    forwarding_agents = ['DHL', 'KUEHNE', 'DBSCHENK', 'MAERSK', 'FEDEX']

    for loc_from in plants:
        for loc_to in plants:
            if loc_from == loc_to:
                continue

            from_info = PLANT_CONFIG[loc_from]
            to_info = PLANT_CONFIG[loc_to]

            route = f"R{loc_from[:2]}{loc_to[:2]}"

            distance_km = haversine_km(
                from_info['ypos'], from_info['xpos'],
                to_info['ypos'], to_info['xpos']
            )

            customs_delay = customs_days(from_info['country'], to_info['country'])

            if loc_from in PORT_PLANTS and loc_to in PORT_PLANTS and distance_km > 200:
                vsart = '03'  # Sea (cheapest for port-to-port)
                travel_hours = distance_km / TRANSPORT_MODES['SEA']['speed_kmh']
                agent = 'MAERSK'
            elif distance_km > 1000:
                vsart = '04'  # Air for very long distances
                travel_hours = distance_km / TRANSPORT_MODES['AIR']['speed_kmh']
                agent = 'FEDEX'
            else:
                vsart = '01'  # Road
                travel_hours = distance_km / TRANSPORT_MODES['ROAD']['speed_kmh']
                agent = random.choice(['DHL', 'KUEHNE', 'DBSCHENK'])

            transit_days = round((travel_hours / 24) + customs_delay, 2)

            data.append({
                'MANDT': '800',
                'ROUTE': route,
                'TRAZTD': transit_days,  # Transit duration (calendar days)
                'TDVZTD': transit_days,  # Transportation lead time (days)
                'FAHZTD': round(travel_hours, 2),  # Travel duration (hours)
                'DISTZ': round(distance_km, 2),  # Distance
                'MEDST': 'KM',  # Distance unit
                'VSART': vsart,  # Shipping type
                'TDLNR': agent,  # Forwarding agent
            })

    return pd.DataFrame(data)

def generate_tvrot_data(df_tvro):
    """
    Generates TVROT - Route Texts.
    Provides descriptions for routes in multiple languages.
    """
    data = []
    plants = list(PLANT_CONFIG)
    languages = ['E', 'D', 'F']  # English, German, French

    for _, route in df_tvro.iterrows():
        route_code = route['ROUTE']

        from_plant = route_code[1:3] + '00'
        to_plant = route_code[3:5] + '00'

        from_name = PLANT_CONFIG.get(from_plant, {}).get('city', from_plant)
        to_name = PLANT_CONFIG.get(to_plant, {}).get('city', to_plant)

        for lang in languages:
            if lang == 'E':
                desc = f"Route {from_name} to {to_name}"
            elif lang == 'D':
                desc = f"Route {from_name} nach {to_name}"
            else:  # French
                desc = f"Route {from_name} vers {to_name}"

            data.append({
                'MANDT': '800',
                'SPRAS': lang,
                'ROUTE': route_code,
                'BEZEI': desc,
            })

    return pd.DataFrame(data)


def generate_lfa1_data():
    """
    Generates LFA1 - Vendor Master General Data.
    Creates vendor records for suppliers of raw materials.
    """
    data = []

    vendor_categories = {
        'API': ['API Supplier', 'Active Ingredient Co', 'Pharma API Ltd'],
        'EXCIPIENT': ['Excipient Corp', 'Formulation Supplies', 'Chemical Ingredients'],
        'PACKAGING': ['Packaging Solutions', 'Carton & Label Co', 'Blister Pack Inc'],
        'CMO': ['Contract Mfg Org', 'Sterile Fill Services', 'Biotech CMO'],
        'LOGISTICS': ['Cold Chain Logistics', 'Pharma Transport', 'Distribution Services']
    }

    countries = ['DE', 'US', 'IN', 'CN', 'CH', 'IE', 'GB', 'FR']

    num_vendors = 20
    for i in range(1, num_vendors + 1):
        lifnr = f"VEND-{i:04d}"

        if i <= 5:
            v_type = 'API'
        elif i <= 10:
            v_type = 'EXCIPIENT'
        elif i <= 15:
            v_type = 'PACKAGING'
        elif i <= 18:
            v_type = 'CMO'
        else:
            v_type = 'LOGISTICS'

        country = random.choice(countries)
        name_base = random.choice(vendor_categories[v_type])

        data.append({
            'MANDT': '800',
            'LIFNR': lifnr,
            'NAME1': f"{name_base} {i}",
            'NAME2': v_type,
            'LAND1': country,
            'ORT01': fake.city() if country in ['DE', 'GB', 'FR'] else fake_US.city(),
            'PSTLZ': fake.postcode() if country in ['DE', 'GB', 'FR'] else fake_US.zipcode(),
            'STRAS': fake.street_address(),
            'TELF1': fake.phone_number()[:20],
            'KTOKK': 'KRED',  # Vendor account group
            'ERDAT': (datetime.now() - timedelta(days=random.randint(365, 1500))).strftime('%Y%m%d'),
            'ERNAM': random.choice(PREDEFINED_USERS),
            'LOEVM': '',  # Deletion flag (empty = active)
            'SPERR': '',  # Block flag (empty = not blocked)
        })

    return pd.DataFrame(data)


def generate_eina_data(df_mara, df_lfa1):
    """
    Generates EINA - Purchasing Info Record General Data.
    Links materials to vendors (which vendor supplies which material).
    """
    data = []

    raw_materials = df_mara[df_mara['MTART'] == 'ROH']['MATNR'].tolist()
    vendors = df_lfa1['LIFNR'].tolist()

    vendor_pools = {
        'API': [v for v in vendors if int(v.split('-')[1]) <= 5],
        'EXCIPIENT': [v for v in vendors if 6 <= int(v.split('-')[1]) <= 10],
        'PACKAGING': [v for v in vendors if 11 <= int(v.split('-')[1]) <= 15],
        'OTHER': [v for v in vendors if int(v.split('-')[1]) >= 16],
    }

    materials_by_category = {category: [] for category in vendor_pools}
    for matnr in raw_materials:
        if matnr == 'API1':
            category = 'API'
        elif matnr == 'EXC1':
            category = 'EXCIPIENT'
        else:
            material_number = int(matnr.removeprefix('MAT-R'))
            if material_number <= 8:
                category = 'API'
            elif material_number <= 16:
                category = 'EXCIPIENT'
            elif material_number <= 24:
                category = 'PACKAGING'
            else:
                category = 'OTHER'
        materials_by_category[category].append(matnr)

    infnr_counter = 5300000000

    def append_info_record(matnr, lifnr):
        nonlocal infnr_counter
        infnr_counter += 1
        data.append({
            'MANDT': '800',
            'INFNR': str(infnr_counter),
            'MATNR': matnr,
            'LIFNR': lifnr,
            'LOEKZ': '',
            'ERDAT': (datetime.now() - timedelta(days=random.randint(180, 720))).strftime('%Y%m%d'),
            'ERNAM': random.choice(PREDEFINED_USERS),
        })

    for category, materials in materials_by_category.items():
        vendor_pool = vendor_pools[category]
        for material_index, matnr in enumerate(materials):
            primary_vendor = vendor_pool[material_index % len(vendor_pool)]
            additional_count = random.randint(0, min(2, len(vendor_pool) - 1))
            additional_vendors = random.sample(
                [vendor for vendor in vendor_pool if vendor != primary_vendor],
                additional_count,
            )
            assigned_vendors = [primary_vendor, *additional_vendors]

            for lifnr in assigned_vendors:
                append_info_record(matnr, lifnr)

    assigned_vendors = {record['LIFNR'] for record in data}
    for vendor_index, lifnr in enumerate(vendors):
        if lifnr not in assigned_vendors:
            append_info_record(raw_materials[vendor_index % len(raw_materials)], lifnr)

    return pd.DataFrame(data)


def generate_eine_data(df_eina):
    """
    Generates EINE - Purchasing Info Record Purchasing Org Data.
    Contains pricing and lead time info per purchasing organization.
    """
    data = []

    purchasing_orgs = ['1000', '2000']  # Align with plant purchasing orgs

    for _, info_rec in df_eina.iterrows():
        for ekorg in purchasing_orgs:
            vendor_num = int(info_rec['LIFNR'].split('-')[1])

            base_price = random.uniform(10, 100) * (1 + vendor_num * 0.02)

            lead_time = random.randint(7, 45)

            min_qty = random.choice([100, 250, 500, 1000, 2500])

            data.append({
                'MANDT': '800',
                'INFNR': info_rec['INFNR'],
                'EKORG': ekorg,
                'ESOKZ': '0',  # Standard info record
                'WERKS': '',   # Plant (blank for cross-plant)
                'LOEKZ': '',   # Deletion indicator
                'APLFZ': lead_time,  # Planned delivery time (days)
                'NETPR': round(base_price, 2),  # Net price
                'WAERS': 'USD',  # Currency
                'PEINH': 1,  # Price unit
                'BPRME': 'PC',  # Order price unit
                'MINBM': min_qty,  # Minimum order qty
                'NORBM': min_qty * 2,  # Standard order qty
                'MWSKZ': 'V0',  # Tax code
                'INCO1': 'FOB',  # Incoterms
                'INCO2': 'Supplier Dock',
                'WEBRE': 'X',  # GR-based invoice verification
            })

    return pd.DataFrame(data)


def generate_t001w_data():
    """
    Generates T001W - Plant/Branch Master Data.
    SAP standard table for plant configuration.
    """
    data = []

    for werks, config in PLANT_CONFIG.items():
        data.append({
            'MANDT': '800',
            'WERKS': werks,
            'NAME1': config['name'],
            'NAME2': config['name2'],
            'LAND1': config['country'],
            'REGIO': config['region'],
            'ORT01': config['city'],
            'STRAS': config['street'],
            'PSTLZ': config['postal'],
            'SPRAS': 'E',  # Language key
            'FABKL': config['calendar'],  # Factory calendar
            'TXJCD': '',  # Tax jurisdiction (blank for non-US)
            'BEDPL': 'X',  # MRP relevance
            'LIFNR': '',  # Vendor number of plant (for external plants)
            'KUNNR': '',  # Customer number of plant
            'IWERK': werks,  # Maintenance planning plant
            'EKORG': werks[:2] + '00',  # Purchasing organization
            'VKORG': werks[:2] + '00',  # Sales organization
            'VTWEG': '10',  # Distribution channel
            'SPART': '00',  # Division
            'AWSLS': '',  # Variance key
            'CHAZV': '',  # Batch status management
            'KKOWK': '',  # Conditions at plant level
            'KORDB': '',  # Indicator: plant-related sourcing
            'VLFKZ': 'A',  # Plant category (A = Standard)
        })

    return pd.DataFrame(data)


def generate_crhd_data():
    """
    Generates CRHD - Work Center Header Data.
    SAP standard table for production resources and capacity.

    Work centers for pharmaceutical manufacturing include:
    - Dispensing/Weighing
    - Granulation
    - Blending
    - Compression (tablets)
    - Coating
    - Filling (liquids/injectables)
    - Sterile filling
    - Packaging
    - Quality Control
    """
    data = []

    work_centers = [
        ('DISP01', 'Dispensing & Weighing 1', '001', 16, 5, 95, ['1000', '5000']),
        ('DISP02', 'Dispensing & Weighing 2', '001', 16, 5, 95, ['1000']),
        ('GRAN01', 'Wet Granulation Line 1', '002', 16, 5, 85, ['1000', '5000']),
        ('GRAN02', 'Dry Granulation Line 1', '002', 16, 5, 88, ['1000']),
        ('BLND01', 'Blending Station 1', '002', 16, 5, 92, ['1000', '5000']),
        ('BLND02', 'Blending Station 2', '002', 16, 5, 92, ['1000']),
        ('COMP01', 'Tablet Press Line 1', '003', 24, 7, 80, ['1000', '5000']),
        ('COMP02', 'Tablet Press Line 2', '003', 24, 7, 82, ['1000']),
        ('COMP03', 'Tablet Press Line 3', '003', 16, 5, 78, ['1000']),
        ('COAT01', 'Film Coating Line 1', '003', 16, 5, 85, ['1000', '5000']),
        ('COAT02', 'Film Coating Line 2', '003', 16, 5, 85, ['1000']),
        ('ENCAP01', 'Encapsulation Line 1', '003', 16, 5, 88, ['1000']),
        ('FILL01', 'Liquid Filling Line 1', '004', 16, 5, 82, ['1000']),
        ('FILL02', 'Liquid Filling Line 2', '004', 16, 5, 82, ['1000', '5000']),
        ('STER01', 'Sterile Filling Line 1', '005', 16, 5, 75, ['1000']),
        ('STER02', 'Sterile Filling Line 2', '005', 16, 5, 75, ['1000']),
        ('PACK01', 'Primary Packaging Line 1', '006', 24, 7, 90, ['1000', '5000']),
        ('PACK02', 'Primary Packaging Line 2', '006', 24, 7, 90, ['1000']),
        ('PACK03', 'Secondary Packaging Line 1', '006', 16, 5, 92, ['1000', '5000']),
        ('PACK04', 'Secondary Packaging Line 2', '006', 16, 5, 92, ['1000']),
        ('QCLAB01', 'Quality Control Lab 1', '007', 16, 5, 85, ['1000', '5000']),
        ('QCLAB02', 'Quality Control Lab 2', '007', 16, 5, 85, ['1000']),
        ('INSP01', 'Incoming Inspection', '008', 8, 5, 95, ['2000', '3000', '4000']),
        ('REPK01', 'Repackaging Station', '006', 8, 5, 90, ['2000', '3000', '4000']),
    ]

    objid_counter = 1000

    for arbpl, ktext, capacity_category, hours_day, days_week, efficiency, plants in work_centers:
        for werks in plants:
            objid_counter += 1

            available_hours = hours_day * days_week

            data.append({
                'MANDT': '800',
                'OBJID': str(objid_counter).zfill(8),  # Object ID (internal)
                'OBJTY': 'A',  # Object type (A = Work Center)
                'ARBPL': arbpl,  # Work center
                'WERKS': werks,  # Plant
                'KTEXT': ktext,  # Short text
                'VERWE': '001',  # Usage (001 = Production)
                'PLANV': 'SAP1',  # Planner group
                'KAPID': str(objid_counter).zfill(8),
                'VERAN': 'PROD_MGR',
                'VGWTS': '0001',
                'ZZ_CAPACITY_CATEGORY': capacity_category,
                'ZZ_CAPACITY_COUNT': 1,
                'ZZ_WORK_HOURS_PER_DAY': hours_day,
                'ZZ_WORK_DAYS_PER_WEEK': days_week,
                'ZZ_UTILIZATION_RATE': efficiency / 100,
                'ZZ_AVAILABLE_HOURS': available_hours,
                'KOSTL': f"CC-{werks}",  # Cost center
                'LVORM': '',
                'OBJST': '',
                'ERDAT': '20200101',  # Created on
                'AEDAT': '20240101',  # Changed on
            })

    return pd.DataFrame(data)


def generate_kako_data(df_crhd):
    """
    Generates KAKO - Capacity Header Data.
    Links to CRHD work centers and provides capacity definition.
    """
    data = []

    for _, wc in df_crhd.iterrows():
        data.append({
            'MANDT': '800',
            'OBJID': wc['OBJID'],
            'OBJTY': wc['OBJTY'],
            'KAPID': wc['KAPID'],
            'KAPAR': wc['ZZ_CAPACITY_CATEGORY'],
            'NAME': wc['KTEXT'],
            'BEGDA': '20200101',  # Valid from
            'ENDDA': '99991231',  # Valid to
            'WERK': wc['WERKS'],
            'ARBPL': wc['ARBPL'],
            'BEGZT': 0,
            'ENDZT': wc['ZZ_WORK_HOURS_PER_DAY'] * 3600,
            'ZZ_WORK_DAYS_PER_WEEK': wc['ZZ_WORK_DAYS_PER_WEEK'],
            'NGRAD': round(wc['ZZ_UTILIZATION_RATE'] * 100),
            'PAUSE': 0,
            'MOSID': '01',
        })

    return pd.DataFrame(data)


def generate_plko_data(df_mara, df_crhd):
    """
    Generates PLKO - Routing Group Header.
    SAP standard table for routing/recipe headers.
    Links materials to the production process.
    """
    data = []

    producible = df_mara[df_mara['MTART'].isin(['FERT', 'HALB'])]['MATNR'].tolist()

    prod_plants = ['1000', '5000']

    plnnr_counter = 1000000

    for matnr in producible:
        for werks in prod_plants:
            plnnr_counter += 1

            if 'INJ' in matnr or 'STER' in matnr:
                routing_type = 'STERILE'
            elif 'LIQ' in matnr or 'SYR' in matnr:
                routing_type = 'LIQUID'
            elif 'TAB' in matnr or 'CAP' in matnr:
                routing_type = 'SOLID'
            else:
                routing_type = 'STANDARD'

            data.append({
                'MANDT': '800',
                'PLNTY': 'N',  # Task list type (N = Routing)
                'PLNNR': str(plnnr_counter).zfill(10),  # Group (routing number)
                'PLNAL': '01',  # Group counter (alternative)
                'WERKS': werks,  # Plant
                'MATNR': matnr,  # Material
                'VERWE': '1',  # Usage (1 = Production)
                'STATU': '4',  # Status (4 = Released)
                'LOEKZ': '',
                'DATUV': '20200101',
                'DATUB': '99991231',
                'VAGRP': 'PROD_MGR',
                'LOSVN': str(random.randint(100, 500)),
                'LOSBS': str(random.randint(5000, 20000)),
                'ZZ_STANDARD_LOT_SIZE': str(random.randint(500, 2000)),
                'KTEXT': f"Routing for {matnr}",  # Description
                'ROUTING_TYPE': routing_type,  # Custom field for routing category
            })

    return pd.DataFrame(data)


def generate_plpo_data(df_plko, df_crhd):
    """
    Generates PLPO - Routing Group Operations.
    SAP standard table for routing operations/steps.
    Links routings to specific work centers with times.
    """
    data = []

    wc_by_plant = {}
    for _, wc in df_crhd.iterrows():
        plant = wc['WERKS']
        if plant not in wc_by_plant:
            wc_by_plant[plant] = {}
        wc_by_plant[plant][wc['ARBPL']] = wc

    routing_templates = {
        'SOLID': [
            (10, 'DISP', 30, 0.5, 'PP01'),   # Dispensing
            (20, 'GRAN', 60, 1.0, 'PP01'),   # Granulation
            (30, 'BLND', 30, 0.3, 'PP01'),   # Blending
            (40, 'COMP', 45, 0.1, 'PP01'),   # Compression
            (50, 'COAT', 60, 0.2, 'PP01'),   # Coating
            (60, 'PACK', 30, 0.05, 'PP01'),  # Packaging
            (70, 'QCLAB', 120, 5.0, 'PP03'), # QC Testing
        ],
        'LIQUID': [
            (10, 'DISP', 30, 0.5, 'PP01'),   # Dispensing
            (20, 'BLND', 45, 0.4, 'PP01'),   # Mixing
            (30, 'FILL', 60, 0.15, 'PP01'),  # Filling
            (40, 'PACK', 30, 0.05, 'PP01'),  # Packaging
            (50, 'QCLAB', 90, 3.0, 'PP03'),  # QC Testing
        ],
        'STERILE': [
            (10, 'DISP', 45, 0.8, 'PP01'),   # Dispensing (sterile)
            (20, 'BLND', 60, 0.5, 'PP01'),   # Mixing (sterile)
            (30, 'STER', 120, 0.3, 'PP01'),  # Sterile filling
            (40, 'PACK', 45, 0.1, 'PP01'),   # Packaging
            (50, 'QCLAB', 180, 8.0, 'PP03'), # QC Testing (extensive)
        ],
        'STANDARD': [
            (10, 'DISP', 30, 0.5, 'PP01'),   # Dispensing
            (20, 'BLND', 30, 0.3, 'PP01'),   # Processing
            (30, 'PACK', 30, 0.05, 'PP01'),  # Packaging
            (40, 'QCLAB', 60, 2.0, 'PP03'),  # QC Testing
        ],
    }

    for _, routing in df_plko.iterrows():
        plant = routing['WERKS']
        routing_type = routing.get('ROUTING_TYPE', 'STANDARD')

        plant_wcs = wc_by_plant.get(plant, {})

        template = routing_templates.get(routing_type, routing_templates['STANDARD'])

        for vornr, wc_prefix, setup_min, run_min, control_key in template:
            matching_wcs = [k for k in plant_wcs.keys() if k.startswith(wc_prefix)]
            if not matching_wcs:
                continue

            arbpl = random.choice(matching_wcs)
            wc_data = plant_wcs[arbpl]

            setup_time = setup_min + random.uniform(-5, 10)  # Add some variation
            run_time = run_min * (1 + random.uniform(-0.1, 0.2))  # ±10-20% variation

            data.append({
                'MANDT': '800',
                'PLNTY': routing['PLNTY'],
                'PLNNR': routing['PLNNR'],
                'PLNAL': routing['PLNAL'],
                'PLNKN': str(vornr).zfill(8),  # Node number (internal)
                'VORNR': str(vornr).zfill(4),  # Operation number
                'WERKS': plant,
                'ARBPL': arbpl,  # Work center
                'OBJID': wc_data['OBJID'],  # Work center object ID
                'LTXA1': f"Operation {vornr}: {wc_data['KTEXT']}",  # Operation text
                'STEUS': control_key,
                'LOEKZ': '',
                'RUEST': round(setup_time, 2),
                'RUESTE': 'MIN',
                'VGW01': round(run_time, 4),  # Standard value 1 (machine time)
                'VGE01': 'MIN',  # Unit for standard value 1
                'VGW02': round(run_time * 0.8, 4),  # Standard value 2 (labor)
                'VGE02': 'MIN',
                'BMSCH': 1,  # Base quantity for times
                'MEINH': 'PC',
                'ZZ_OVERLAP_HOURS': random.randint(0, 2),
                'MINWE': random.choice([0, 1, 2]),
                'MAXWE': random.choice([0, 4, 8, 24]),
                'LAR01': random.choice(['0001', '0002', '0003']),
            })

    return pd.DataFrame(data)


def generate_bom_structure():
    mast, stko, stpo = [], [], []
    bom_map = {}
    for row in BOM_CONFIG:
        if row['parent'] not in bom_map: bom_map[row['parent']] = []
        bom_map[row['parent']].append(row)

    for idx, matnr in enumerate(PARENT_MATERIALS):
        bom_id = f"BOM{idx+10000}"

        for werks in PREDEFINED_PLANTS:
            mast.append({'MANDT': '800', 'MATNR': matnr, 'WERKS': werks, 'STLAN': '1', 'STLNR': bom_id, 'STLAL': '01'})
        stko.append({'MANDT': '800', 'STLTY': 'M', 'STLNR': bom_id, 'STLAL': '01', 'BMENG': 1, 'BMEIN': 'PC', 'DATUV': '20230101'})
        comps = bom_map.get(matnr, [])
        if not comps:
            for i in range(2):
                comps.append({'child': random.choice(RAW_MATERIALS), 'qty': 1, 'uom': 'PC'})

        for i, comp in enumerate(comps):
            stpo.append({
                'MANDT': '800', 'STLTY': 'M', 'STLNR': bom_id, 'STLAL': '01',
                'STLKN': i+1, 'IDNRK': comp['child'], 'MENGE': comp['qty'], 'MEINS': comp['uom']
            })

    return pd.DataFrame(mast), pd.DataFrame(stko), pd.DataFrame(stpo)


def generate(wh):
    global RANDOM_SEED, NUM_CUSTOMERS, NUM_FINISHED_GOODS, NUM_RAW_MATERIALS
    global MOQ_FINISHED_MIN, MOQ_FINISHED_MAX, MOQ_RAW_MIN, MOQ_RAW_MAX
    global GENERATE_DIRTY_DATA, DIRTY_DATA_RATE
    global fake, fake_US
    global PREDEFINED_PLANTS, PREDEFINED_STORAGE_LOCATIONS, PREDEFINED_CUSTOMERS, PREDEFINED_USERS
    global MAT_VEGGIE_CAPS, MAT_INDIA_PRODUCT, CUST_INDIA
    global PRODUCT_ADJECTIVES, PRODUCT_NOUNS, BOM_CONFIG
    global FINISHED_GOODS, INTERMEDIATE_GOODS, RAW_MATERIALS, PREDEFINED_MATERIALS, PARENT_MATERIALS

    RANDOM_SEED = int(param("RANDOM_SEED"))
    NUM_CUSTOMERS = int(param("NUM_CUSTOMERS"))
    NUM_FINISHED_GOODS = int(param("NUM_FINISHED_GOODS"))
    NUM_RAW_MATERIALS = int(param("NUM_RAW_MATERIALS"))
    MOQ_FINISHED_MIN = int(param("MOQ_FINISHED_MIN"))
    MOQ_FINISHED_MAX = int(param("MOQ_FINISHED_MAX"))
    MOQ_RAW_MIN = int(param("MOQ_RAW_MIN"))
    MOQ_RAW_MAX = int(param("MOQ_RAW_MAX"))
    GENERATE_DIRTY_DATA = param("GENERATE_DIRTY_DATA").lower() == "true"
    DIRTY_DATA_RATE = float(param("DIRTY_DATA_RATE"))

    seed_all(RANDOM_SEED)
    fake = Faker('en_GB')
    fake_US = Faker('en-US')

    print(f"Seed: {RANDOM_SEED}")
    print(f"Universe: {NUM_CUSTOMERS} customers, {NUM_FINISHED_GOODS} finished goods, {NUM_RAW_MATERIALS} raw materials")
    print(f"Dirty Data: {'ENABLED' if GENERATE_DIRTY_DATA else 'disabled'} (rate={DIRTY_DATA_RATE})")

    PREDEFINED_PLANTS = list(PLANT_CONFIG)
    PREDEFINED_STORAGE_LOCATIONS = ['0001', 'FG01', 'RM01', 'WH01', 'QA01', 'ALT1']
    PREDEFINED_CUSTOMERS = [f'CUST{i:05d}' for i in range(1, NUM_CUSTOMERS + 1)]
    PREDEFINED_USERS = ['USER_A', 'USER_B', 'ADMIN', 'JOHNDOE', 'AUTO_JOB']

    MAT_VEGGIE_CAPS = "MAT-R0025"
    MAT_INDIA_PRODUCT = "MAT-A0020"
    CUST_INDIA = "CUST00020"

    PRODUCT_ADJECTIVES = ['Active', 'Smart', 'Turbo', 'Quick', 'Fast', 'Power', 'Hyper', 'Stealth', 'Sonic', 'Aero', 'Fusion', 'Digital', 'Core', 'Quantum', 'Rapid', 'Dynamic']
    PRODUCT_NOUNS = ['Drive', 'Flow', 'Spark', 'Link', 'Core', 'Max', 'Pro', 'Genius', 'Master', 'Stream', 'Shift', 'Bolt', 'Edge', 'Connect', 'Sync']

    BOM_CONFIG = [
        {'parent': 'B1_TAB1', 'child': 'API1', 'qty': 500, 'uom': 'GRM', 'scrap': 0.5, 'type': 'API'},
        {'parent': 'B1_TAB1', 'child': 'EXC1', 'qty': 300, 'uom': 'GRM', 'scrap': 2.0, 'type': 'Excipient'},
    ]

    BOM_CONFIG.append({'parent': MAT_INDIA_PRODUCT, 'child': MAT_VEGGIE_CAPS, 'qty': 50, 'uom': 'PC', 'scrap': 0.0, 'type': 'Excipient'})
    BOM_CONFIG.append({'parent': MAT_INDIA_PRODUCT, 'child': 'API1', 'qty': 100, 'uom': 'GRM', 'scrap': 0.5, 'type': 'API'})

    FINISHED_GOODS = sorted(list(set([row['parent'] for row in BOM_CONFIG] + [f'MAT-A{i:04d}' for i in range(1, NUM_FINISHED_GOODS + 1)])))
    INTERMEDIATE_GOODS = sorted(list(set([row['parent'] for row in BOM_CONFIG if row['parent'] in [r['child'] for r in BOM_CONFIG]] + [f'MAT-H{i:04d}' for i in range(1, 11)])))
    RAW_MATERIALS = sorted(list(set([row['child'] for row in BOM_CONFIG] + [f'MAT-R{i:04d}' for i in range(1, NUM_RAW_MATERIALS + 1)])))

    PREDEFINED_MATERIALS = sorted(list(set(FINISHED_GOODS + INTERMEDIATE_GOODS + RAW_MATERIALS)))
    PARENT_MATERIALS = FINISHED_GOODS + INTERMEDIATE_GOODS

    valid_matnr_set = set(PREDEFINED_MATERIALS)
    valid_kunnr_set = set(PREDEFINED_CUSTOMERS)

    print("Generating KNA1...")
    df_kna1 = generate_kna1_data()
    df_kna1 = apply_dirty_data_masterdata(df_kna1, "kna1", {
        'key_columns': ['KUNNR'],
        'pk_column': 'KUNNR',
        'dup_rate': 0.01,
        'null_columns': ['NAME1'],
        'null_rate': 0.02
    })
    wh.save("kna1", df_kna1)

    print("Generating MARA...")
    df_mara = generate_mara_data()
    df_mara = apply_dirty_data_masterdata(df_mara, "mara", {
        'key_columns': ['MATNR'],
        'pk_column': 'MATNR',
        'dup_rate': 0.01,
        'null_columns': ['MTART'],
        'null_rate': 0.02
    })
    wh.save("mara", df_mara)

    print("Generating MAKT...")
    df_makt = generate_makt_data()
    df_makt = apply_dirty_data_masterdata(df_makt, "makt", {
        'key_columns': ['MATNR'],
        'orphan_config': [('MATNR', 0.03, 'ORPHAN_MAT')]
    })
    wh.save("makt", df_makt)

    print("Generating MARC...")
    df_marc = generate_marc_data()
    df_marc = apply_dirty_data_masterdata(df_marc, "marc", {
        'orphan_config': [('MATNR', 0.02, 'ORPHAN_MAT')]
    })
    wh.save("marc", df_marc)

    print("Generating MARD (with batch tracking)...")
    df_mard = generate_mard_data()
    df_mard = apply_dirty_data_masterdata(df_mard, "mard", {
        'key_columns': ['LGORT'],
        'orphan_config': [('MATNR', 0.02, 'ORPHAN_MAT')]
    })
    wh.save("mard", df_mard)

    batch_records = df_mard[df_mard['CHARG'] != ''].to_dict('records')

    print("Generating MCH1 (Batch Master - Cross Plant)...")
    df_mch1 = generate_mch1_data(batch_records)
    wh.save("mch1", df_mch1)

    print("Generating MCHA (Batch Master - Plant Level)...")
    df_mcha = generate_mcha_data(batch_records)
    wh.save("mcha", df_mcha)

    print("Generating MBEW...")
    df_mbew = generate_mbew_data()
    df_mbew = apply_dirty_data_masterdata(df_mbew, "mbew", {
        'orphan_config': [('MATNR', 0.02, 'ORPHAN_MAT')]
    })
    wh.save("mbew", df_mbew)

    print("Generating MARM (Unit Conversions)...")
    df_marm = generate_marm_data()
    df_marm = apply_dirty_data_masterdata(df_marm, "marm", {
        'orphan_config': [('MATNR', 0.02, 'ORPHAN_MAT')]
    })
    wh.save("marm", df_marm)

    print("Generating BOM Structures...")
    df_mast, df_stko, df_stpo = generate_bom_structure()

    df_mast = apply_dirty_data_masterdata(df_mast, "mast", {})
    df_stko = apply_dirty_data_masterdata(df_stko, "stko", {})
    df_stpo = apply_dirty_data_masterdata(df_stpo, "stpo", {
        'orphan_config': [('IDNRK', 0.02, 'ORPHAN_COMP')]
    })

    wh.save("mast", df_mast)
    wh.save("stko", df_stko)
    wh.save("stpo", df_stpo)

    print("Generating APO Location Master (/SAPAPO/LOC)...")
    df_sapapo_loc = generate_sapapo_loc_data()
    wh.save("sapapo_loc", df_sapapo_loc)

    print("Generating APO Transportation Lanes (/SAPAPO/TR)...")
    df_sapapo_tr = generate_sapapo_tr_data()
    wh.save("sapapo_tr", df_sapapo_tr)

    print("Generating APO Means of Transport (/SAPAPO/TRM)...")
    df_sapapo_trm = generate_sapapo_trm_data(df_sapapo_tr)
    wh.save("sapapo_trm", df_sapapo_trm)

    print("Generating ERP Routes (TVRO)...")
    df_tvro = generate_tvro_data()
    wh.save("tvro", df_tvro)

    print("Generating ERP Route Texts (TVROT)...")
    df_tvrot = generate_tvrot_data(df_tvro)
    wh.save("tvrot", df_tvrot)

    print("Generating Vendor Master (LFA1)...")
    df_lfa1 = generate_lfa1_data()
    wh.save("lfa1", df_lfa1)

    print("Generating Purchasing Info Records (EINA)...")
    df_eina = generate_eina_data(df_mara, df_lfa1)
    wh.save("eina", df_eina)

    print("Generating Purchasing Info Record Org Data (EINE)...")
    df_eine = generate_eine_data(df_eina)
    wh.save("eine", df_eine)

    print("Generating Plant Master (T001W)...")
    df_t001w = generate_t001w_data()
    wh.save("t001w", df_t001w)

    print("Generating Work Center Master (CRHD)...")
    df_crhd = generate_crhd_data()
    wh.save("crhd", df_crhd)

    print("Generating Capacity Headers (KAKO)...")
    df_kako = generate_kako_data(df_crhd)
    wh.save("kako", df_kako)

    print("Generating Routing Headers (PLKO)...")
    df_plko = generate_plko_data(df_mara, df_crhd)
    wh.save("plko", df_plko)

    print("Generating Routing Operations (PLPO)...")
    df_plpo = generate_plpo_data(df_plko, df_crhd)
    wh.save("plpo", df_plpo)

    if GENERATE_DIRTY_DATA:
        print(f"Dirty data applied at rate {DIRTY_DATA_RATE} (seed={RANDOM_SEED})")
    print("Full Master Data Generated & Saved.")
