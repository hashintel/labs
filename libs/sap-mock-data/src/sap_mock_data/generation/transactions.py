"""Generate SAP transaction data with pandas."""
import pandas as pd
import numpy as np
import math
import uuid
from math import radians, sin, cos, sqrt, asin
from faker import Faker
import random
from datetime import datetime, timedelta

from .common import param, seed_all

PREDEFINED_USERS = ['USER_A', 'USER_B', 'ADMIN', 'JOHNDOE', 'AUTO_JOB']

START_STOCK_MULTI = 1.2

MAT_CONTAMINATED = "MAT-A0005"
MAT_INDIA_PRODUCT = "MAT-A0020"
CUST_INDIA = "CUST00020"

BATCH_COUNTER = 1000000

def generate_production_batch(matnr, werks, year=2025):
    """Generate a new batch ID for production output."""
    global BATCH_COUNTER
    BATCH_COUNTER += 1
    mat_suffix = matnr.replace('MAT-', '').replace('-', '')[:4]
    return f"B{year}{mat_suffix}{BATCH_COUNTER % 1000:03d}"

def add_stock(matnr, werks, lgort, qty, batch_id=''):
    """Add stock from goods receipt (production, purchase, transfer in)."""
    key = (matnr, werks, lgort)
    if key not in AVAILABLE_STOCK:
        AVAILABLE_STOCK[key] = 0
    AVAILABLE_STOCK[key] += qty

    if key not in BATCH_INVENTORY:
        BATCH_INVENTORY[key] = []
    if batch_id:
        BATCH_INVENTORY[key].append({'batch': batch_id, 'qty': qty})

def get_available_stock(matnr, werks, lgort):
    """Return available stock for a material, plant, and storage location."""
    key = (matnr, werks, lgort)
    return AVAILABLE_STOCK.get(key, 0)

def consume_stock(matnr, werks, lgort, qty_requested):
    """
    Consume stock for goods issue. Returns actual qty that can be issued.
    Never allows consumption to exceed available stock.
    """
    key = (matnr, werks, lgort)
    available = AVAILABLE_STOCK.get(key, 0)
    actual_qty = min(qty_requested, max(0, available))

    if actual_qty > 0:
        AVAILABLE_STOCK[key] = available - actual_qty

    return actual_qty

def select_batch_for_issue(matnr, werks, lgort, qty_needed):
    """
    Select batch(es) for goods issue using FIFO.
    Returns a list of (batch_id, qty) tuples.

    NOTE: Quantity is LIMITED to available stock to prevent negative inventory.
    """
    key = (matnr, werks, lgort)

    available = AVAILABLE_STOCK.get(key, 0)
    actual_qty = min(qty_needed, max(0, available))

    if actual_qty <= 0:
        return [('', 0)]  # No stock available

    AVAILABLE_STOCK[key] = available - actual_qty

    if key not in BATCH_INVENTORY or not BATCH_INVENTORY[key]:
        return [('', actual_qty)]

    for batch_info in BATCH_INVENTORY[key]:
        if batch_info['qty'] > 0:
            deduct = min(batch_info['qty'], actual_qty)
            batch_info['qty'] -= deduct
            return [(batch_info['batch'], actual_qty)]

    return [('', actual_qty)]  # Fallback

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

def dirty_date_column(df, date_columns, dirty_rate=0.05):
    """Apply dirty date transformations to specified date columns."""
    if not GENERATE_DIRTY_DATA or dirty_rate <= 0:
        return df

    df_dirty = df.copy()
    for col in date_columns:
        if col in df_dirty.columns:
            mask = np.random.random(len(df_dirty)) < dirty_rate
            df_dirty.loc[mask, col] = df_dirty.loc[mask, col].apply(
                lambda x: dirty_date(x, dirty_rate=1.0)  # Already selected, always dirty
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

def apply_dirty_data_transactions(df, table_name, config):
    """Apply configured dirty-data transformations."""
    if not GENERATE_DIRTY_DATA:
        return df

    np.random.seed(RANDOM_SEED + hash(table_name) % 1000)
    random.seed(RANDOM_SEED + hash(table_name) % 1000)

    df_dirty = df.copy()

    if 'key_columns' in config:
        df_dirty = dirty_dataframe(df_dirty, config['key_columns'], DIRTY_DATA_RATE)

    if 'date_columns' in config:
        df_dirty = dirty_date_column(df_dirty, config['date_columns'], DIRTY_DATA_RATE)

    if 'orphan_config' in config:
        for fk_col, rate, prefix in config['orphan_config']:
            df_dirty = inject_orphan_records(df_dirty, fk_col, rate, prefix)

    if 'pk_column' in config and 'dup_rate' in config:
        df_dirty = inject_duplicates(df_dirty, config['pk_column'], config['dup_rate'])

    if 'null_columns' in config:
        df_dirty = inject_nulls(df_dirty, config['null_columns'], config.get('null_rate', 0.02))

    return df_dirty


def get_unreliable_materials(all_raw_materials, reliability_rate, specific_materials=""):
    """
    Determine which raw materials have unreliable suppliers.

    Args:
        all_raw_materials: List of all ROH materials
        reliability_rate: Float 0.0-1.0 (1.0 = all reliable)
        specific_materials: Comma-separated string of specific materials

    Returns:
        Set of unreliable material IDs
    """
    if specific_materials.strip():
        return set(m.strip() for m in specific_materials.split(','))
    else:
        unreliable_rate = 1.0 - reliability_rate
        if unreliable_rate <= 0:
            return set()
        rng = random.Random(RANDOM_SEED)
        return set(
            m for m in all_raw_materials
            if rng.random() < unreliable_rate
        )

def generate_sales_orders(finished_goods, all_customers):
    print(f"Generating {NUMBER_OF_ORDERS} Sales Orders...")
    vbak, vbap, vbep = [], [], []
    base_date = datetime.now()

    for i in range(NUMBER_OF_ORDERS):
        vbeln = f'{1000000000 + i:010d}'
        days_offset = random.randint(0, 365)
        order_date_dt = base_date - timedelta(days=days_offset)
        order_date = order_date_dt.strftime('%Y%m%d')
        req_date = (order_date_dt + timedelta(days=7)).strftime('%Y%m%d')

        if i % 100 == 0: kunnr = CUST_INDIA
        else: kunnr = random.choice(all_customers)

        order_total = 0.0
        num_items = random.randint(1, 3)
        order_lines = []

        for j in range(num_items):
            posnr = f'{(j + 1) * 10:06d}'
            matnr = MAT_INDIA_PRODUCT if kunnr == CUST_INDIA else random.choice(finished_goods)
            werks = random.choice(PLANTS)
            qty = random.randint(10, 100)

            unit_price = PRICE_LOOKUP.get((matnr, werks), PRICE_FALLBACK.get(matnr, 100.0))
            line_value = round(qty * unit_price, 2)
            order_total += line_value

            order_lines.append({
                'MANDT': '800', 'VBELN': vbeln, 'POSNR': posnr, 'MATNR': matnr,
                'WERKS': werks, 'LGORT': 'FG01', 'KWMENG': qty, 'MEINS': 'PC',
                'NETPR': round(unit_price, 2), 'NETWR': line_value, 'WAERK': 'GBP'
            })
            vbep.append({
                'MANDT': '800', 'VBELN': vbeln, 'POSNR': posnr, 'ETENR': '0001',
                'EDATU': req_date, 'WMENG': qty, 'BMENG': qty
            })

        vbak.append({
            'MANDT': '800', 'VBELN': vbeln, 'AUART': 'OR', 'KUNNR': kunnr,
            'ERDAT': order_date, 'NETWR': round(order_total, 2), 'VDATU': req_date, 'WAERK': 'GBP'
        })
        vbap.extend(order_lines)

    return pd.DataFrame(vbak), pd.DataFrame(vbap), pd.DataFrame(vbep)

def generate_logistics(df_vbak, df_vbap, df_vbep):
    print("Generating Deliveries (LIKP/LIPS/VBFA)...")

    unique_orders = df_vbap['VBELN'].unique()
    keep_mask = np.random.rand(len(unique_orders)) < DELIVERY_FILL_RATE
    delivered_vbelns = unique_orders[keep_mask]

    df_vbap_del = df_vbap[df_vbap['VBELN'].isin(delivered_vbelns)].copy()

    df_proc = df_vbap_del.merge(df_vbak[['VBELN', 'KUNNR']], on='VBELN')
    df_proc = df_proc.merge(df_vbep[['VBELN', 'EDATU']].drop_duplicates('VBELN'), on='VBELN')

    header_groups = df_proc[['VBELN', 'KUNNR', 'EDATU']].drop_duplicates('VBELN').reset_index(drop=True)
    del_ids = np.random.randint(8000000000, 8999999999, size=len(header_groups))
    header_groups['VBELN_DELIVERY'] = [f'{x:010d}' for x in del_ids]

    likp = pd.DataFrame({
        'MANDT': '800', 'VBELN': header_groups['VBELN_DELIVERY'], 'KUNNR': header_groups['KUNNR'],
        'LFDAT': header_groups['EDATU'], 'LFART': 'LF'
    })

    df_proc = df_proc.merge(header_groups[['VBELN', 'VBELN_DELIVERY']], on='VBELN')

    batch_results = df_proc.apply(
        lambda row: select_batch_for_issue(row['MATNR'], row['WERKS'], 'FG01', row['KWMENG'])[0],
        axis=1
    )
    df_proc['BATCH_ID'] = batch_results.apply(lambda x: x[0])
    df_proc['ACTUAL_QTY'] = batch_results.apply(lambda x: x[1])

    df_proc_with_stock = df_proc[df_proc['ACTUAL_QTY'] > 0].copy()

    if len(df_proc_with_stock) < len(df_proc):
        print(f"  Note: {len(df_proc) - len(df_proc_with_stock)} deliveries skipped due to insufficient stock")

    df_proc_with_stock['POSNR_LIPS'] = (df_proc_with_stock.groupby('VBELN_DELIVERY').cumcount() + 1).apply(lambda x: f'{x*10:06d}')

    lips = pd.DataFrame({
        'MANDT': '800', 'VBELN': df_proc_with_stock['VBELN_DELIVERY'], 'POSNR': df_proc_with_stock['POSNR_LIPS'],
        'MATNR': df_proc_with_stock['MATNR'], 'WERKS': df_proc_with_stock['WERKS'], 'LFIMG': df_proc_with_stock['ACTUAL_QTY']
    })

    matdoc_ids = np.arange(5000000000, 5000000000 + len(df_proc_with_stock))
    matdoc = pd.DataFrame({
        'MANDT': '800',
        'MBLNR': [str(x) for x in matdoc_ids],
        'MJAHR': '2025',
        'ZEILE': '0001',
        'BWART': '601',
        'MATNR': df_proc_with_stock['MATNR'].values,
        'WERKS': df_proc_with_stock['WERKS'].values,
        'LGORT': 'FG01',
        'CHARG': df_proc_with_stock['BATCH_ID'].values,
        'SHKZG': 'H',
        'MENGE': df_proc_with_stock['ACTUAL_QTY'].values,
        'MEINS': 'PC',
        'BUDAT': df_proc_with_stock['EDATU'].values,
        'CPUDT': df_proc_with_stock['EDATU'].values,
        'CPUTM': '120000',
        'KDAUF': df_proc_with_stock['VBELN'].values,
        'KDPOS': df_proc_with_stock['POSNR'].values,
        'KUNNR': df_proc_with_stock['KUNNR'].values,
        'XBLNR': df_proc_with_stock['VBELN_DELIVERY'].values,
        'BKTXT': 'Goods Issue to Customer',
    })

    vbfa = pd.DataFrame({
        'MANDT': '800', 'VBELN': df_proc_with_stock['VBELN'], 'POSNN': df_proc_with_stock['POSNR'],
        'VBELN_N': df_proc_with_stock['VBELN_DELIVERY'], 'POSNN_N': df_proc_with_stock['POSNR_LIPS'],
        'VBTYP_V': 'C', 'VBTYP_N': 'J', 'RFMNG': df_proc_with_stock['ACTUAL_QTY']
    })

    deliveries_with_items = set(df_proc_with_stock['VBELN_DELIVERY'].unique())
    likp = likp[likp['VBELN'].isin(deliveries_with_items)].copy()

    actual_delivered_vbelns = set(df_proc_with_stock['VBELN'].unique())

    return likp, lips, matdoc, vbfa, actual_delivered_vbelns


PLANT_LOCATIONS = {
    '1000': {'name': 'London', 'country': 'GB', 'xpos': -0.1278, 'ypos': 51.5074},
    '2000': {'name': 'Rotterdam', 'country': 'NL', 'xpos': 4.4777, 'ypos': 51.9244},
    '3000': {'name': 'Frankfurt', 'country': 'DE', 'xpos': 8.6821, 'ypos': 50.1109},
    '4000': {'name': 'Warsaw', 'country': 'PL', 'xpos': 21.0122, 'ypos': 52.2297},
}

EU_COUNTRIES = {'NL', 'DE', 'PL', 'FR', 'BE', 'ES', 'IT', 'AT', 'CZ', 'HU', 'SK', 'RO', 'BG', 'GR', 'PT', 'SE', 'DK', 'FI', 'IE'}
PORT_PLANTS = {'1000', '2000'}

TRANSPORT_MODES = {
    'ROAD': {'speed_kmh': 60, 'cost_per_km': 0.50, 'vsart': '01'},
    'SEA': {'speed_kmh': 25, 'cost_per_km': 0.15, 'vsart': '03'},
    'AIR': {'speed_kmh': 800, 'cost_per_km': 3.00, 'vsart': '04'},
}

def haversine_km(lat1, lon1, lat2, lon2):
    """Calculate the great circle distance in kilometers between two points on Earth."""
    R = 6371
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

def get_route_code(from_plant, to_plant):
    """Generate route code in format R{FROM}{TO}."""
    return f"R{from_plant[:2]}{to_plant[:2]}"

def get_best_transport_mode(from_plant, to_plant, distance_km):
    """Determine the best transport mode based on cost."""
    available_modes = ['ROAD', 'AIR']
    if from_plant in PORT_PLANTS and to_plant in PORT_PLANTS and distance_km > 200:
        available_modes.append('SEA')

    min_cost = float('inf')
    best_mode = 'ROAD'
    for mode in available_modes:
        cost = distance_km * TRANSPORT_MODES[mode]['cost_per_km']
        if cost < min_cost:
            min_cost = cost
            best_mode = mode
    return best_mode

def generate_shipments(df_likp, df_lips, df_vbap):
    """
    Generates shipment tables VTTK (Header), VTTP (Items), VTTS (Stages).
    Creates shipments for deliveries, linking them to routes.
    """
    print("Generating Shipments (VTTK/VTTP/VTTS)...")

    vttk_data = []
    vttp_data = []
    vtts_data = []

    df_delivery = df_lips.merge(
        df_likp[['VBELN', 'LFDAT', 'KUNNR']],
        on='VBELN',
        suffixes=('', '_H')
    )

    if 'WERKS' not in df_delivery.columns or df_delivery['WERKS'].isna().all():
        if 'VGBEL' in df_delivery.columns:
            df_delivery = df_delivery.merge(
                df_vbap[['VBELN', 'POSNR', 'WERKS']].rename(columns={'VBELN': 'VGBEL', 'POSNR': 'VGPOS'}),
                on=['VGBEL', 'VGPOS'],
                how='left',
                suffixes=('', '_VBAP')
            )
            if 'WERKS_VBAP' in df_delivery.columns:
                df_delivery['WERKS'] = df_delivery['WERKS_VBAP'].fillna(df_delivery.get('WERKS', '1000'))

    delivery_groups = df_delivery.groupby('VBELN')

    shipment_counter = 7000000000
    forwarding_agents = ['DHL', 'KUEHNE', 'DBSCHENK', 'MAERSK', 'FEDEX']

    for del_vbeln, del_items in delivery_groups:
        tknum = f'{shipment_counter:010d}'
        shipment_counter += 1

        first_item = del_items.iloc[0]
        source_plant = first_item.get('WERKS', '1000')
        if pd.isna(source_plant) or source_plant == '':
            source_plant = '1000'  # Default to hub

        delivery_date_str = first_item.get('LFDAT', datetime.now().strftime('%Y%m%d'))

        dest_plants = [p for p in PLANT_LOCATIONS.keys() if p != source_plant]
        dest_plant = random.choice(dest_plants) if dest_plants else '2000'

        from_info = PLANT_LOCATIONS.get(source_plant, PLANT_LOCATIONS['1000'])
        to_info = PLANT_LOCATIONS.get(dest_plant, PLANT_LOCATIONS['2000'])

        distance_km = haversine_km(
            from_info['ypos'], from_info['xpos'],
            to_info['ypos'], to_info['xpos']
        )

        transport_mode = get_best_transport_mode(source_plant, dest_plant, distance_km)
        mode_info = TRANSPORT_MODES[transport_mode]

        travel_hours = distance_km / mode_info['speed_kmh']
        customs_delay = customs_days(from_info['country'], to_info['country'])

        route = get_route_code(source_plant, dest_plant)

        try:
            del_date = datetime.strptime(str(delivery_date_str), '%Y%m%d')
        except:
            del_date = datetime.now()

        dispatch_date = del_date - timedelta(days=int(travel_hours/24) + customs_delay + 1)

        if transport_mode == 'SEA':
            agent = 'MAERSK'
        elif transport_mode == 'AIR':
            agent = 'FEDEX'
        else:
            agent = random.choice(['DHL', 'KUEHNE', 'DBSCHENK'])

        vttk_data.append({
            'MANDT': '800',
            'TKNUM': tknum,
            'SHTYP': '0001',  # Standard shipment
            'VSART': mode_info['vsart'],
            'ROUTE': route,
            'TDLNR': agent,
            'ERDAT': dispatch_date.strftime('%Y%m%d'),
            'DISTZ': round(distance_km, 2),
            'FAHZT': round(travel_hours, 2),
            'DTTRG': del_date.strftime('%Y%m%d'),  # Planned delivery date
            'DTDIS': dispatch_date.strftime('%Y%m%d'),  # Planned dispatch date
        })

        for idx, (_, item) in enumerate(del_items.iterrows()):
            tpnum = f'{(idx + 1) * 10:06d}'
            vttp_data.append({
                'MANDT': '800',
                'TKNUM': tknum,
                'TPNUM': tpnum,
                'VBELN': del_vbeln,  # Delivery number
                'LAUFK': 'A',  # Leg indicator (A = single leg)
            })

        vtts_data.append({
            'MANDT': '800',
            'TKNUM': tknum,
            'TSNUM': '0001',
            'TSRFO': '0001',  # Stage sequence
            'ROUTE': route,
            'VSART': mode_info['vsart'],
            'KNOTA': source_plant,  # Departure point
            'KNOTB': dest_plant,    # Destination point
            'DISTZ': round(distance_km, 2),
            'FAHZTD': round(travel_hours, 2),
        })

    return pd.DataFrame(vttk_data), pd.DataFrame(vttp_data), pd.DataFrame(vtts_data)

def simulate_hub_spoke_v2(pdf: pd.DataFrame) -> pd.DataFrame:
    if pdf.empty:
        return pd.DataFrame(columns=['TYPE', 'MATNR', 'SUPPLY_PLANT', 'RECEIVE_PLANT', 'QUANTITY', 'DATE', 'ID_REF'])

    mat = pdf['MATNR'].iloc[0]
    plant_states = {}

    plant_groups = pdf.groupby('WERKS', dropna=False).first().reset_index()
    all_plants = plant_groups['WERKS'].tolist()

    hub_rows = plant_groups[plant_groups['WERKS'] == HUB_PLANT]
    if len(hub_rows) > 0 and 'MOQ' in plant_groups.columns:
        moq = hub_rows['MOQ'].iloc[0]
        moq = int(moq) if pd.notna(moq) and moq > 0 else 500
    else:
        moq = 500  # Default MOQ

    for _, row in plant_groups.iterrows():
        plant = row['WERKS']
        safety = row['EISBE'] if pd.notna(row.get('EISBE')) and row.get('EISBE', 0) > 0 else 500
        plant_states[plant] = {'inv': safety * START_STOCK_MULTI, 'safety': safety}

    # Spoke replenishment needs hub state even when this material has no hub demand.
    plant_states.setdefault(
        HUB_PLANT,
        {'inv': 500 * START_STOCK_MULTI, 'safety': 500},
    )

    pdf = pdf.sort_values('Week_Start')
    weeks = pdf['Week_Start'].unique()
    output_rows = []

    for week in weeks:
        week_str = pd.Timestamp(week).strftime('%Y%m%d')
        week_demand = pdf[pdf['Week_Start'] == week]
        hub_outflow = 0

        for plant in all_plants:
            if plant == HUB_PLANT: continue
            sales = week_demand[week_demand['WERKS'] == plant]['PLNMG'].sum()
            plant_states[plant]['inv'] -= sales

            if plant_states[plant]['inv'] < plant_states[plant]['safety']:
                order_qty = plant_states[plant]['safety'] - plant_states[plant]['inv']
                order_qty = math.ceil(order_qty / moq) * moq

                plant_states[plant]['inv'] += order_qty
                hub_outflow += order_qty
                output_rows.append({
                    'TYPE': 'TRNS', 'MATNR': mat, 'SUPPLY_PLANT': HUB_PLANT, 'RECEIVE_PLANT': plant,
                    'QUANTITY': float(order_qty), 'DATE': week_str, 'ID_REF': f"TR{random.randint(10000,99999)}"
                })

        hub_sales = week_demand[week_demand['WERKS'] == HUB_PLANT]['PLNMG'].sum()
        plant_states[HUB_PLANT]['inv'] -= (hub_sales + hub_outflow)

        if plant_states[HUB_PLANT]['inv'] < plant_states[HUB_PLANT]['safety']:
            prod_qty = plant_states[HUB_PLANT]['safety'] - plant_states[HUB_PLANT]['inv']
            prod_qty = math.ceil(prod_qty / moq) * moq

            plant_states[HUB_PLANT]['inv'] += prod_qty
            output_rows.append({
                'TYPE': 'PROD', 'MATNR': mat, 'SUPPLY_PLANT': HUB_PLANT, 'RECEIVE_PLANT': HUB_PLANT,
                'QUANTITY': float(prod_qty), 'DATE': week_str, 'ID_REF': f"PL{random.randint(10000000,99999999)}"
            })

    return pd.DataFrame(output_rows)

def run_network_simulation(df_sim_input, wh):
    print("Running Hub & Spoke Simulation...")
    df_marc_full = wh.read("marc")
    marc_cols = list(df_marc_full.columns)
    if "BSTMI" in marc_cols:
        df_marc = df_marc_full[["MATNR", "WERKS", "EISBE", "BSTMI"]].rename(columns={"BSTMI": "MOQ"})
    elif "BSTMA" in marc_cols:
        df_marc = df_marc_full[["MATNR", "WERKS", "EISBE", "BSTMA"]].rename(columns={"BSTMA": "MOQ"})
    else:
        df_marc = df_marc_full[["MATNR", "WERKS", "EISBE"]].copy()
        df_marc["MOQ"] = 500

    df_input = df_sim_input.copy()
    df_input["Date_Obj"] = pd.to_datetime(df_input["EDATU"], format="%Y%m%d", errors="coerce")
    df_input["Week_Start"] = df_input["Date_Obj"].dt.to_period("W").dt.start_time
    df_input = df_input.groupby(["MATNR", "WERKS", "Week_Start"], as_index=False, dropna=False).agg(PLNMG=("PLNMG", "sum"))
    df_input = df_input.merge(df_marc, on=["MATNR", "WERKS"], how="left")  # Joins EISBE and MOQ

    parts = [simulate_hub_spoke_v2(group) for _, group in df_input.groupby("MATNR", dropna=False)]
    out = pd.concat(parts, ignore_index=True) if parts else pd.DataFrame()
    out = out.reindex(columns=network_schema) if not out.empty else pd.DataFrame(columns=network_schema)
    return out

def convert_plan_to_execution(df_sim_results, bom_map, unreliable_materials=None):
    """Convert simulation results to AFKO, RESB, and MATDOC rows.

    Materials in ``unreliable_materials`` can reduce the quantity produced when
    their delivered component quantity is below the BOM requirement.
    """
    print("Converting Simulation Plan to SAP Execution Data...")

    if unreliable_materials is None:
        unreliable_materials = set()

    df_prod = df_sim_results[df_sim_results["TYPE"] == 'PROD']
    df_trans = df_sim_results[df_sim_results["TYPE"] == 'TRNS']

    afko, resb, matdoc = [], [], []
    matdoc_id = 9000000000
    shortage_doc_id = 7000000000  # Separate counter for shortage docs

    # A separate stream keeps supplier outcomes independent of production draws.
    supplier_rng = random.Random(RANDOM_SEED + 999)

    stats = {'complete': 0, 'partial': 0, 'blocked': 0, 'shortage_docs': 0}

    # Sales orders limit this simulation to FERT materials. BOM movement 261
    # consumes ROH materials instead of producing them.
    print(f"Processing {len(df_prod)} Production Orders...")

    for _, row in df_prod.iterrows():
        matnr = row['MATNR']
        planned_qty = row['QUANTITY']
        plant = row['SUPPLY_PLANT']  # Should be 1000
        date = row['DATE']

        aufnr = f"ORD{random.randint(1000000,9999999)}"

        actual_qty = planned_qty
        shortage_components = []
        status = 'COMP'  # Default: Complete
        shortage_reason = ''

        if matnr in bom_map and unreliable_materials:
            bom = bom_map[matnr]
            for comp in bom['components']:
                comp_mat = comp['child_mat']

                if comp_mat in unreliable_materials:
                    delivery_rate = supplier_rng.uniform(0.3, 0.8)

                    max_from_comp = planned_qty * delivery_rate
                    if max_from_comp < actual_qty:
                        actual_qty = max_from_comp

                    shortage_qty = comp['qty'] * (planned_qty - max_from_comp)
                    shortage_components.append({
                        'material': comp_mat,
                        'needed': comp['qty'] * planned_qty,
                        'available': comp['qty'] * max_from_comp,
                        'shortage': shortage_qty,
                        'delivery_rate': delivery_rate
                    })

        actual_qty = int(actual_qty)

        if actual_qty <= 0:
            status = 'BLCK'  # Blocked - no production possible
            actual_qty = 0
            shortage_reason = f"Blocked: insufficient {', '.join(s['material'] for s in shortage_components)}"
            stats['blocked'] += 1
        elif actual_qty < planned_qty:
            status = 'PART'  # Partial production
            shortage_parts = [s['material'] + '(' + str(int(s['delivery_rate']*100)) + '%)' for s in shortage_components]
            shortage_reason = 'Partial: ' + ', '.join(shortage_parts)
            stats['partial'] += 1
        else:
            stats['complete'] += 1

        afko.append({
            'MANDT': '800',
            'AUFNR': aufnr,
            'PLNBEZ': matnr,
            'GAMNG': planned_qty,      # Planned/target quantity
            'IGMNG': actual_qty,       # Actual produced quantity
            'GSTRP': date,
            'WERKS': plant,
            'STAT': status,            # Status: COMP/PART/BLCK
            'RUESSION': shortage_reason  # Reason for shortage/block
        })

        if actual_qty > 0:
            new_batch = generate_production_batch(matnr, plant)
            matdoc.append({
                'MANDT': '800',
                'MBLNR': str(matdoc_id),
                'MJAHR': '2025',
                'ZEILE': '0001',
                'BWART': '101',
                'MATNR': matnr,
                'WERKS': plant,
                'LGORT': 'FG01',
                'CHARG': new_batch,
                'SHKZG': 'S',
                'MENGE': actual_qty,
                'MEINS': 'PC',
                'BUDAT': date,
                'CPUDT': date,
                'CPUTM': '080000',
                'AUFNR': aufnr,
                'BKTXT': 'GR from Production',
            })
            matdoc_id += 1

        if matnr in bom_map:
            bom = bom_map[matnr]
            for i, comp in enumerate(bom['components']):
                actual_consumption = comp['qty'] * actual_qty

                if actual_consumption > 0:
                    comp_batch, consumed_qty = select_batch_for_issue(comp['child_mat'], plant, 'RM01', actual_consumption)[0]

                    if consumed_qty > 0:
                        resb.append({
                            'MANDT': '800', 'RSNUM': aufnr, 'RSPOS': f"{i+1:04d}",
                            'MATNR': comp['child_mat'],
                            'BDMNG': comp['qty'] * planned_qty,  # Planned requirement
                            'ENMNG': consumed_qty,                # Actual withdrawal (limited to stock)
                            'WERKS': plant, 'LGORT': 'RM01'
                        })
                        matdoc.append({
                            'MANDT': '800',
                            'MBLNR': str(matdoc_id),
                            'MJAHR': '2025',
                            'ZEILE': '0001',
                            'BWART': '261',
                            'MATNR': comp['child_mat'],
                            'WERKS': plant,
                            'LGORT': 'RM01',
                            'CHARG': comp_batch,
                            'SHKZG': 'H',
                            'MENGE': consumed_qty,  # Use actual consumed (limited to stock)
                            'MEINS': 'PC',
                            'BUDAT': date,
                            'CPUDT': date,
                            'CPUTM': '070000',
                            'AUFNR': aufnr,
                            'BKTXT': 'GI for Production',
                        })
                        matdoc_id += 1

        for shortage in shortage_components:
            if shortage['shortage'] > 0:
                matdoc.append({
                    'MANDT': '800',
                    'MBLNR': f'SHORT{shortage_doc_id}',
                    'MJAHR': '2025',
                    'ZEILE': '0001',
                    'BWART': '102',  # Reversal/shortage indicator
                    'MATNR': shortage['material'],
                    'WERKS': plant,
                    'LGORT': 'RM01',  # Raw material storage location
                    'CHARG': '',  # No batch for shortage documentation
                    'SHKZG': 'H',  # Would have been credit
                    'MENGE': shortage['shortage'],
                    'MEINS': 'PC',
                    'BUDAT': date,
                    'CPUDT': date,
                    'CPUTM': '080000',
                    'AUFNR': aufnr,
                    'BKTXT': f"Supplier shortage - {shortage['delivery_rate']*100:.0f}% delivered",
                })
                shortage_doc_id += 1
                stats['shortage_docs'] += 1

        if matnr not in bom_map and actual_qty > 0:
            print(f"(!) Notice: Produced {matnr} at {plant} without BOM. 101 created, consumption skipped.")

    print(f"Processing {len(df_trans)} Stock Transport Orders...")

    for _, row in df_trans.iterrows():
        date = row['DATE']

        transfer_batch = select_batch_for_issue(row['MATNR'], row['SUPPLY_PLANT'], 'FG01', row['QUANTITY'])[0][0]

        matdoc.append({
            'MANDT': '800',
            'MBLNR': str(matdoc_id),
            'MJAHR': '2025',
            'ZEILE': '0001',
            'BWART': '641',
            'MATNR': row['MATNR'],
            'WERKS': row['SUPPLY_PLANT'],
            'LGORT': 'FG01',
            'CHARG': transfer_batch,
            'SHKZG': 'H',
            'MENGE': row['QUANTITY'],
            'MEINS': 'PC',
            'BUDAT': date,
            'CPUDT': date,
            'CPUTM': '100000',
            'XBLNR': row['ID_REF'],
            'BKTXT': 'Stock Transfer Outbound',
        })

        matdoc.append({
            'MANDT': '800',
            'MBLNR': str(matdoc_id),
            'MJAHR': '2025',
            'ZEILE': '0002',
            'BWART': '101',
            'MATNR': row['MATNR'],
            'WERKS': row['RECEIVE_PLANT'],
            'LGORT': 'FG01',
            'CHARG': transfer_batch,
            'SHKZG': 'S',
            'MENGE': row['QUANTITY'],
            'MEINS': 'PC',
            'BUDAT': date,
            'CPUDT': date,
            'CPUTM': '140000',
            'XBLNR': row['ID_REF'],
            'BKTXT': 'Stock Transfer Inbound',
        })
        matdoc_id += 1

    if unreliable_materials:
        print(f"Supplier Reliability Impact:")
        print(f"  - Complete orders: {stats['complete']}")
        print(f"  - Partial orders: {stats['partial']}")
        print(f"  - Blocked orders: {stats['blocked']}")
        print(f"  - Shortage documents: {stats['shortage_docs']}")
        print(f"  - Unreliable materials: {len(unreliable_materials)}")

    return pd.DataFrame(afko), pd.DataFrame(resb), pd.DataFrame(matdoc)

def generate_mardh(df_matdoc, df_mard_initial):
    """
    Generate MARDH (Historical Stock) table from MATDOC movements.

    Calculates period-end stock positions by:
    1. Starting with initial MARD stock (by batch)
    2. Applying all MATDOC movements chronologically
    3. Recording stock snapshots at each month-end

    Args:
        df_matdoc: DataFrame with all material movements (including CHARG)
        df_mard_initial: DataFrame with initial MARD stock (from master data, including CHARG)

    Returns:
        DataFrame with MARDH records (monthly stock snapshots by batch)
    """
    print("Generating MARDH (Historical Stock with batch tracking)...")

    if hasattr(df_matdoc, 'toPandas'):
        df_matdoc = df_matdoc.toPandas()
    if hasattr(df_mard_initial, 'toPandas'):
        df_mard_initial = df_mard_initial.toPandas()

    df_movements = df_matdoc.copy()
    df_movements['BUDAT'] = pd.to_datetime(df_movements['BUDAT'], format='%Y%m%d', errors='coerce')
    df_movements = df_movements.dropna(subset=['BUDAT'])
    df_movements['LFGJA'] = df_movements['BUDAT'].dt.year
    df_movements['LFMON'] = df_movements['BUDAT'].dt.month

    df_movements['STOCK_CHANGE'] = df_movements.apply(
        lambda r: r['MENGE'] if r['SHKZG'] == 'S' else -r['MENGE'], axis=1
    )

    if 'LGORT' not in df_movements.columns:
        df_movements['LGORT'] = 'FG01'
    else:
        df_movements['LGORT'] = df_movements['LGORT'].fillna('FG01')

    if 'CHARG' not in df_movements.columns:
        df_movements['CHARG'] = ''
    else:
        df_movements['CHARG'] = df_movements['CHARG'].fillna('')

    movement_agg = df_movements.groupby(
        ['MATNR', 'WERKS', 'LGORT', 'CHARG', 'LFGJA', 'LFMON']
    )['STOCK_CHANGE'].sum().reset_index()

    # CHARG keeps stock calculations separate for each batch.
    mard_cols = ['MATNR', 'WERKS', 'LGORT', 'LABST']
    if 'CHARG' in df_mard_initial.columns:
        mard_cols.insert(3, 'CHARG')
        initial_stock = df_mard_initial[mard_cols].copy()
        initial_stock['CHARG'] = initial_stock['CHARG'].fillna('')
    else:
        initial_stock = df_mard_initial[mard_cols].copy()
        initial_stock['CHARG'] = ''

    initial_stock['LABST'] = pd.to_numeric(initial_stock['LABST'], errors='coerce').fillna(0)

    all_keys = movement_agg[['MATNR', 'WERKS', 'LGORT', 'CHARG']].drop_duplicates()
    all_periods = movement_agg[['LFGJA', 'LFMON']].drop_duplicates().sort_values(['LFGJA', 'LFMON'])

    mardh_records = []

    for _, key in all_keys.iterrows():
        matnr, werks, lgort, charg = key['MATNR'], key['WERKS'], key['LGORT'], key['CHARG']

        init_row = initial_stock[
            (initial_stock['MATNR'] == matnr) &
            (initial_stock['WERKS'] == werks) &
            (initial_stock['LGORT'] == lgort) &
            (initial_stock['CHARG'] == charg)
        ]
        running_stock = init_row['LABST'].values[0] if len(init_row) > 0 else 0

        key_movements = movement_agg[
            (movement_agg['MATNR'] == matnr) &
            (movement_agg['WERKS'] == werks) &
            (movement_agg['LGORT'] == lgort) &
            (movement_agg['CHARG'] == charg)
        ].set_index(['LFGJA', 'LFMON'])['STOCK_CHANGE'].to_dict()

        for _, period in all_periods.iterrows():
            lfgja, lfmon = int(period['LFGJA']), int(period['LFMON'])

            change = key_movements.get((lfgja, lfmon), 0)
            running_stock += change

            if change != 0 or running_stock != 0:
                mardh_records.append({
                    'MANDT': '800',
                    'MATNR': matnr,
                    'WERKS': werks,
                    'LGORT': lgort,
                    'CHARG': charg,  # Batch number
                    'LFGJA': str(lfgja),
                    'LFMON': f'{lfmon:02d}',
                    'LABST': max(0, running_stock),  # Valuated Unrestricted-Use Stock
                    'UMLME': 0,  # Stock in transfer (SLoc to SLoc)
                    'INSME': 0,  # Stock in Quality Inspection
                    'EINME': 0,  # Total Stock of All Restricted Batches
                    'SPEME': 0,  # Blocked Stock
                    'RETME': 0,  # Blocked Stock Returns
                    'VKLAB': 0.0,  # Stock value at sales price (value-only material)
                    'VKUML': 0.0,  # Sales value in stock transfer
                })

    print(f"Generated {len(mardh_records)} MARDH records for {len(all_keys)} material-plant-sloc-batch combinations")
    return pd.DataFrame(mardh_records)


def generate_purchase_orders(df_eina, df_eine, df_matdoc, num_months=12):
    """
    Generate EKKO (Purchase Order Header) and EKPO (Purchase Order Item) tables.

    Creates historical purchase orders for raw materials based on:
    - Consumption from MATDOC (261 movements = production consumption)
    - Info records from EINA/EINE (vendor-material linkages)

    Args:
        df_eina: Purchasing info records (material-vendor links)
        df_eine: Purchasing org-level info (pricing, lead times)
        df_matdoc: Material documents (to calculate consumption)
        num_months: Number of months of history to generate

    Returns:
        Tuple of (df_ekko, df_ekpo)
    """
    print(f"Generating Purchase Orders (EKKO/EKPO) for {num_months} months...")

    if hasattr(df_eina, 'toPandas'):
        df_eina = df_eina.toPandas()
    if hasattr(df_eine, 'toPandas'):
        df_eine = df_eine.toPandas()
    if hasattr(df_matdoc, 'toPandas'):
        df_matdoc = df_matdoc.toPandas()

    ekko_records = []
    ekpo_records = []

    consumption = df_matdoc[df_matdoc['BWART'] == '261'].groupby('MATNR')['MENGE'].sum()

    df_info = df_eina.merge(
        df_eine[df_eine['EKORG'] == '1000'],  # Use primary purchasing org
        on='INFNR',
        how='left'
    )

    po_counter = 4500000000
    po_item_counter = 0

    for _, info in df_info.iterrows():
        matnr = info['MATNR']
        lifnr = info['LIFNR']

        total_consumption = consumption.get(matnr, 1000)  # Default if no consumption

        monthly_qty = total_consumption / num_months

        for month_offset in range(num_months):
            po_date = datetime.now() - timedelta(days=(num_months - month_offset) * 30)

            po_counter += 1
            ebeln = str(po_counter)

            order_qty = max(info.get('MINBM', 100), monthly_qty * random.uniform(0.7, 1.3))
            order_qty = round(order_qty / 100) * 100  # Round to nearest 100

            ekko_records.append({
                'MANDT': '800',
                'EBELN': ebeln,
                'BUKRS': '1000',  # Company code
                'BSTYP': 'F',  # PO document type (F = Standard PO)
                'BSART': 'NB',  # Document type (NB = Standard PO)
                'LIFNR': lifnr,
                'EKORG': '1000',  # Purchasing org
                'EKGRP': 'P01',  # Purchasing group
                'WAERS': 'USD',  # Currency
                'BEDAT': po_date.strftime('%Y%m%d'),  # PO date
                'AEDAT': po_date.strftime('%Y%m%d'),  # Creation date
                'ERNAM': random.choice(PREDEFINED_USERS),
                'KONNR': '',  # Contract number
                'FRGKE': '2',  # Release status (2 = released)
                'FRGZU': 'X',  # Release indicator
                'PROCSTAT': '05',  # Processing status (05 = released)
            })

            po_item_counter += 1
            net_price = info.get('NETPR', 50.0)

            ekpo_records.append({
                'MANDT': '800',
                'EBELN': ebeln,
                'EBELP': '00010',  # Item number
                'MATNR': matnr,
                'TXZ01': f"Raw Material {matnr}",
                'WERKS': '1000',  # Plant
                'LGORT': 'RM01',  # Storage location (raw materials)
                'MENGE': order_qty,  # Order quantity
                'MEINS': 'PC',  # Unit
                'NETPR': net_price,  # Net price
                'PEINH': 1,  # Price unit
                'NETWR': round(order_qty * net_price, 2),  # Net value
                'BPRME': 'PC',  # Order price unit
                'INFNR': info['INFNR'],
                'ELIKZ': '',  # Delivery completed (empty = open)
                'LOEKZ': '',  # Deletion flag
                'EINDT': (po_date + timedelta(days=info.get('APLFZ', 14))).strftime('%Y%m%d'),  # Delivery date
            })

    print(f"  Generated {len(ekko_records)} purchase orders with {len(ekpo_records)} line items")
    return pd.DataFrame(ekko_records), pd.DataFrame(ekpo_records)


def generate_po_delivery_history(df_ekko, df_ekpo, df_eine, supplier_scenarios=None):
    """
    Generate EKBE (Purchase Order History) showing goods receipts.

    Simulates delivery performance including:
    - On-time deliveries
    - Late deliveries
    - Partial deliveries
    - Quantity variances

    Args:
        df_ekko: Purchase order headers
        df_ekpo: Purchase order items
        df_eine: Purchasing info for lead times
        supplier_scenarios: Dict of {vendor: scenario_params} for injecting poor performance

    Returns:
        DataFrame with EKBE records
    """
    print("Generating Purchase Order History (EKBE)...")

    if hasattr(df_ekko, 'toPandas'):
        df_ekko = df_ekko.toPandas()
    if hasattr(df_ekpo, 'toPandas'):
        df_ekpo = df_ekpo.toPandas()

    supplier_scenarios = supplier_scenarios or {}
    ekbe_records = []

    df_po = df_ekpo.merge(df_ekko[['EBELN', 'LIFNR', 'BEDAT']], on='EBELN')

    for _, po in df_po.iterrows():
        ebeln = po['EBELN']
        lifnr = po['LIFNR']
        matnr = po['MATNR']
        order_qty = po['MENGE']
        planned_date = datetime.strptime(po['EINDT'], '%Y%m%d')
        po_date = datetime.strptime(po['BEDAT'], '%Y%m%d')

        on_time_rate = 0.95
        full_qty_rate = 0.98

        if lifnr in supplier_scenarios:
            scenario = supplier_scenarios[lifnr]
            on_time_rate = scenario.get('on_time_rate', 0.95)
            full_qty_rate = scenario.get('full_qty_rate', 0.98)

        is_on_time = random.random() < on_time_rate
        is_full_qty = random.random() < full_qty_rate

        if is_on_time:
            actual_date = planned_date + timedelta(days=random.randint(-2, 1))
        else:
            actual_date = planned_date + timedelta(days=random.randint(3, 14))

        if is_full_qty:
            actual_qty = order_qty
        else:
            actual_qty = round(order_qty * random.uniform(0.6, 0.95))

        ekbe_records.append({
            'MANDT': '800',
            'EBELN': ebeln,
            'EBELP': po['EBELP'],
            'ZEESSION': '0001',  # Sequential number
            'VGABE': '1',  # Transaction type (1 = GR)
            'BEWTP': 'E',  # History category (E = Goods receipt)
            'BWART': '101',  # Movement type
            'BUDAT': actual_date.strftime('%Y%m%d'),  # Posting date
            'MENGE': actual_qty,  # Quantity
            'BPMNG': actual_qty,  # Quantity in PO unit
            'DMBTR': round(actual_qty * po['NETPR'], 2),  # Amount in local currency
            'WRBTR': round(actual_qty * po['NETPR'], 2),  # Amount in doc currency
            'WAERS': 'USD',
            'SHKZG': 'S',  # Debit/Credit (S = credit/increase)
            'MATNR': matnr,
            'WERKS': po['WERKS'],
            'LIFNR': lifnr,
            'XBLNR': f"GR{ebeln}",  # Reference document
            'LFBNR': f"DELV{random.randint(1000000, 9999999)}",  # Delivery note
            'CPUDT': actual_date.strftime('%Y%m%d'),
            'CPUTM': f"{random.randint(8,17):02d}{random.randint(0,59):02d}00",
            'ERNAM': random.choice(PREDEFINED_USERS),
            'EINDT_PLAN': po['EINDT'],  # Planned delivery date
            'OTIF_ONTIME': 'X' if is_on_time else '',
            'OTIF_INFULL': 'X' if is_full_qty else '',
        })

    print(f"  Generated {len(ekbe_records)} goods receipt records")

    df_ekbe = pd.DataFrame(ekbe_records)
    total_deliveries = len(df_ekbe)
    on_time_count = len(df_ekbe[df_ekbe['OTIF_ONTIME'] == 'X'])
    in_full_count = len(df_ekbe[df_ekbe['OTIF_INFULL'] == 'X'])
    otif_count = len(df_ekbe[(df_ekbe['OTIF_ONTIME'] == 'X') & (df_ekbe['OTIF_INFULL'] == 'X')])

    print(f"  Delivery Performance:")
    print(f"    On-Time: {on_time_count}/{total_deliveries} ({100*on_time_count/total_deliveries:.1f}%)")
    print(f"    In-Full: {in_full_count}/{total_deliveries} ({100*in_full_count/total_deliveries:.1f}%)")
    print(f"    OTIF:    {otif_count}/{total_deliveries} ({100*otif_count/total_deliveries:.1f}%)")

    return df_ekbe

def generate_plaf(df_sim_results):
    """
    Generate PLAF (Planned Orders) from simulation results.

    PLAF is the SAP standard table for MRP planned orders including:
    - In-house production (BESKZ='E')
    - Stock transfers (BESKZ='U')
    """
    plaf_records = []
    plnum_counter = 1000000

    sim_df = df_sim_results

    for _, row in sim_df.iterrows():
        plnum_counter += 1

        if row['TYPE'] == 'PROD':
            plaf_records.append({
                'MANDT': '800',
                'PLNUM': f'PLN{plnum_counter}',      # Planned order number
                'MATNR': row['MATNR'],               # Material
                'WERKS': row['SUPPLY_PLANT'],        # Plant (hub)
                'LWERK': '',                          # No supplying plant for production
                'GSMNG': row['QUANTITY'],            # Total planned quantity
                'MEINS': 'PC',                       # Unit of measure
                'PEDTR': row['DATE'],                # Planned finish date
                'PSTTR': row['DATE'],                # Planned start date
                'BESKZ': 'E',                        # Procurement type: E = In-house production
                'PLSCN': '000',                      # Planning scenario
                'DISPO': 'MRP',                      # MRP controller
                'SOBSL': '',                         # Special procurement type
                'ID_REF': row['ID_REF']              # Reference to simulation ID
            })
        elif row['TYPE'] == 'TRNS':
            plaf_records.append({
                'MANDT': '800',
                'PLNUM': f'PLN{plnum_counter}',      # Planned order number
                'MATNR': row['MATNR'],               # Material
                'WERKS': row['RECEIVE_PLANT'],       # Plant (receiving spoke)
                'LWERK': row['SUPPLY_PLANT'],        # Supplying plant (hub)
                'GSMNG': row['QUANTITY'],            # Total planned quantity
                'MEINS': 'PC',                       # Unit of measure
                'PEDTR': row['DATE'],                # Planned receipt date
                'PSTTR': row['DATE'],                # Planned start/ship date
                'BESKZ': 'U',                        # Procurement type: U = Stock transfer
                'PLSCN': '000',                      # Planning scenario
                'DISPO': 'MRP',                      # MRP controller
                'SOBSL': '40',                       # Special procurement: stock transfer
                'ID_REF': row['ID_REF']              # Reference to simulation ID
            })

    return pd.DataFrame(plaf_records)


def generate(wh):
    global RANDOM_SEED, NUMBER_OF_ORDERS, HUB_PLANT, DELIVERY_FILL_RATE, SAFETY_STOCK_WEEKS
    global GENERATE_DIRTY_DATA, DIRTY_DATA_RATE, SUPPLIER_RELIABILITY_RATE, UNRELIABLE_MATERIALS_STR
    global PLANTS, PRICE_LOOKUP, PRICE_FALLBACK, BATCH_INVENTORY, AVAILABLE_STOCK, network_schema

    RANDOM_SEED = int(param("RANDOM_SEED"))
    NUMBER_OF_ORDERS = int(param("NUM_ORDERS"))
    HUB_PLANT = param("HUB_PLANT")
    DELIVERY_FILL_RATE = float(param("DELIVERY_FILL_RATE"))
    SAFETY_STOCK_WEEKS = int(param("SAFETY_STOCK_WEEKS"))
    GENERATE_DIRTY_DATA = param("GENERATE_DIRTY_DATA").lower() == "true"
    DIRTY_DATA_RATE = float(param("DIRTY_DATA_RATE"))
    SUPPLIER_RELIABILITY_RATE = float(param("SUPPLIER_RELIABILITY_RATE"))
    UNRELIABLE_MATERIALS_STR = param("UNRELIABLE_MATERIALS")

    seed_all(RANDOM_SEED)
    fake = Faker('en_GB')

    print(f"Config: {NUMBER_OF_ORDERS} orders, Hub={HUB_PLANT}, Fill Rate={DELIVERY_FILL_RATE}, Safety Stock={SAFETY_STOCK_WEEKS} weeks")
    print(f"Dirty Data: {'ENABLED' if GENERATE_DIRTY_DATA else 'disabled'} (rate={DIRTY_DATA_RATE})")
    print(f"Supplier Reliability: {SUPPLIER_RELIABILITY_RATE} (unreliable materials: {UNRELIABLE_MATERIALS_STR or 'random selection'})")

    df_mara = wh.read("mara")
    df_stpo = wh.read("stpo")
    df_mast = wh.read("mast")
    df_mbew = wh.read("mbew")

    FINISHED_PRODUCTS = [row['MATNR'] for row in df_mara[df_mara["MTART"] == "FERT"][['MATNR']].drop_duplicates().to_dict("records")]
    ALL_CUSTOMERS = [row['KUNNR'] for row in wh.read("kna1")[['KUNNR']].drop_duplicates().to_dict("records")]
    PLANTS = ['1000', '2000', '3000', '4000']

    SALES_MARKUP = 0.35  # 35% markup on cost for selling price
    price_rows = df_mbew[['MATNR', 'BWKEY', 'STPRS']].to_dict("records")
    PRICE_LOOKUP = {}
    for row in price_rows:
        if row['STPRS'] is not None and row['MATNR'] is not None and row['BWKEY'] is not None:
            PRICE_LOOKUP[(row['MATNR'], row['BWKEY'])] = float(row['STPRS']) * (1 + SALES_MARKUP)
    material_prices = {}
    for (matnr, _), price in PRICE_LOOKUP.items():
        if matnr not in material_prices:
            material_prices[matnr] = []
        material_prices[matnr].append(price)
    PRICE_FALLBACK = {m: sum(p)/len(p) for m, p in material_prices.items()} if material_prices else {}
    print(f"Pricing loaded: {len(PRICE_LOOKUP)} plant-specific prices, {len(PRICE_FALLBACK)} material averages")

    print("Building BOM Lookup...")
    bom_map = {}
    mast_dict = {row['MATNR']: row['STLNR'] for row in df_mast[['MATNR', 'STLNR']].to_dict("records")}
    stpo_rows = df_stpo[['STLNR', 'IDNRK', 'MENGE', 'MEINS']].to_dict("records")
    stpo_dict = {}
    for row in stpo_rows:
        if row['STLNR'] not in stpo_dict: stpo_dict[row['STLNR']] = []
        stpo_dict[row['STLNR']].append({'child_mat': row['IDNRK'], 'qty': row['MENGE'], 'uom': row['MEINS']})

    for parent, stlnr in mast_dict.items():
        if stlnr in stpo_dict:
            bom_map[parent] = {'stlnr': stlnr, 'components': stpo_dict[stlnr]}

    print("Loading batch inventory from MARD...")
    df_mard = wh.read("mard")

    mard_columns = list(df_mard.columns)
    if 'CHARG' in mard_columns:
        mard_rows = df_mard[['MATNR', 'WERKS', 'LGORT', 'CHARG', 'LABST']].to_dict("records")
        has_batch_column = True
    else:
        print("Warning: MARD table does not have CHARG column. Batch tracking will be limited.")
        mard_rows = df_mard[['MATNR', 'WERKS', 'LGORT', 'LABST']].to_dict("records")
        has_batch_column = False

    BATCH_INVENTORY = {}
    for row in mard_rows:
        key = (row['MATNR'], row['WERKS'], row['LGORT'])
        if key not in BATCH_INVENTORY:
            BATCH_INVENTORY[key] = []
        charg = row['CHARG'] if has_batch_column else ''
        if charg and row['LABST'] and float(row['LABST']) > 0:
            BATCH_INVENTORY[key].append({'batch': charg, 'qty': float(row['LABST'])})

    # Batch IDs increase with age, so this order approximates FIFO selection.
    for key in BATCH_INVENTORY:
        BATCH_INVENTORY[key].sort(key=lambda x: x['batch'])

    print(f"Batch inventory loaded: {len(BATCH_INVENTORY)} location combinations with batches")

    AVAILABLE_STOCK = {}
    for row in mard_rows:
        key = (row['MATNR'], row['WERKS'], row['LGORT'])
        stock = float(row['LABST']) if row['LABST'] else 0
        if stock > 0:
            if key not in AVAILABLE_STOCK:
                AVAILABLE_STOCK[key] = 0
            AVAILABLE_STOCK[key] += stock

    print(f"Available stock loaded: {len(AVAILABLE_STOCK)} material/plant/location combinations")

    network_schema = ["TYPE", "MATNR", "SUPPLY_PLANT", "RECEIVE_PLANT", "QUANTITY", "DATE", "ID_REF"]

    df_mara = wh.read("mara")
    df_kna1 = wh.read("kna1")

    FINISHED_PRODUCTS = [row['MATNR'] for row in df_mara[df_mara["MTART"] == "FERT"][['MATNR']].drop_duplicates().to_dict("records")]
    ALL_CUSTOMERS = [row['KUNNR'] for row in df_kna1[['KUNNR']].drop_duplicates().to_dict("records")]

    df_vbak, df_vbap, df_vbep = generate_sales_orders(FINISHED_PRODUCTS, ALL_CUSTOMERS)

    wh.save("vbak", df_vbak)
    wh.save("vbap", df_vbap)
    wh.save("vbep", df_vbep)

    print("Running pre-simulation to determine production quantities...")

    df_demand_presim = df_vbep.merge(df_vbap[['VBELN', 'POSNR', 'MATNR', 'WERKS']], on=['VBELN', 'POSNR'], how='left')
    df_sim_presim = (
        df_demand_presim[['MATNR', 'WERKS', 'BMENG', 'EDATU']].rename(columns={'BMENG': 'PLNMG'})
    )
    # Production enters inventory before allocation so deliveries cannot exceed stock.
    df_presim_results = run_network_simulation(df_sim_presim, wh)

    print("Pre-populating inventory with planned production...")
    df_prod_presim = df_presim_results[df_presim_results["TYPE"] == 'PROD']
    for _, row in df_prod_presim.iterrows():
        add_stock(row['MATNR'], row['SUPPLY_PLANT'], 'FG01', row['QUANTITY'])

    df_trans_presim = df_presim_results[df_presim_results["TYPE"] == 'TRNS']
    for _, row in df_trans_presim.iterrows():
        add_stock(row['MATNR'], row['RECEIVE_PLANT'], 'FG01', row['QUANTITY'])

    print(f"Pre-populated {len(df_prod_presim)} production orders and {len(df_trans_presim)} transfers")

    df_likp, df_lips, df_matdoc_sales, df_vbfa, delivered_vbelns = generate_logistics(df_vbak, df_vbap, df_vbep)

    wh.save("likp", df_likp)
    wh.save("lips", df_lips)
    wh.save("vbfa", df_vbfa)

    df_vttk, df_vttp, df_vtts = generate_shipments(df_likp, df_lips, df_vbap)

    wh.save("vttk", df_vttk)
    wh.save("vttp", df_vttp)
    wh.save("vtts", df_vtts)

    print("Syncing Safety Stock to MARC...")
    df_demand_source = df_vbep.merge(df_vbap[['VBELN', 'POSNR', 'MATNR', 'WERKS']], on=['VBELN', 'POSNR'], how='left')
    df_demand_source = df_demand_source[df_demand_source['VBELN'].isin(delivered_vbelns)]  # Filter to delivered only

    df_demand_agg = df_demand_source.groupby(['MATNR', 'WERKS'])['BMENG'].sum().reset_index()
    df_demand_agg['EISBE'] = (df_demand_agg['BMENG'] / 52 * SAFETY_STOCK_WEEKS).astype(int)

    df_marc_current = wh.read("marc")
    merged = df_marc_current.merge(
        df_demand_agg[["MATNR", "WERKS", "EISBE"]],
        on=["MATNR", "WERKS"], how="left", suffixes=("_m", "_d"),
    )
    df_marc_updated = merged[[c for c in df_marc_current.columns if c != "EISBE"]].copy()
    df_marc_updated["EISBE"] = merged["EISBE_d"].fillna(merged["EISBE_m"])
    wh.save("marc", df_marc_updated)

    df_sim_input = (
        df_demand_source[['MATNR', 'WERKS', 'BMENG', 'EDATU']]
        .rename(columns={'BMENG': 'PLNMG'})
    )
    df_sim_results = run_network_simulation(df_sim_input, wh)

    print("Generating PLAF (Planned Orders)...")

    df_plaf = generate_plaf(df_sim_results)
    wh.save("plaf", df_plaf)
    print(f"  Created {len(df_plaf)} planned orders")
    print(f"    - Production (BESKZ=E): {len(df_plaf[df_plaf['BESKZ']=='E'])}")
    print(f"    - Transfers (BESKZ=U):  {len(df_plaf[df_plaf['BESKZ']=='U'])}")

    print("Building BOM Map for Execution...")
    df_mast = wh.read("mast")
    df_stpo = wh.read("stpo")

    bom_map = {}
    mast_dict = {row['MATNR']: row['STLNR'] for row in df_mast[['MATNR', 'STLNR']].to_dict("records")}
    stpo_rows = df_stpo[['STLNR', 'IDNRK', 'MENGE', 'MEINS']].to_dict("records")
    stpo_dict = {}
    for row in stpo_rows:
        if row['STLNR'] not in stpo_dict: stpo_dict[row['STLNR']] = []
        stpo_dict[row['STLNR']].append({'child_mat': row['IDNRK'], 'qty': row['MENGE'], 'uom': row['MEINS']})

    for parent, stlnr in mast_dict.items():
        if stlnr in stpo_dict:
            bom_map[parent] = {'stlnr': stlnr, 'components': stpo_dict[stlnr]}

    ALL_RAW_MATERIALS = [row['MATNR'] for row in df_mara[df_mara["MTART"] == "ROH"][['MATNR']].drop_duplicates().to_dict("records")]
    unreliable_materials = get_unreliable_materials(ALL_RAW_MATERIALS, SUPPLIER_RELIABILITY_RATE, UNRELIABLE_MATERIALS_STR)

    if unreliable_materials:
        print(f"Supplier Reliability: {len(unreliable_materials)} of {len(ALL_RAW_MATERIALS)} raw materials have unreliable suppliers")
        if UNRELIABLE_MATERIALS_STR:
            print(f"  Specified materials: {UNRELIABLE_MATERIALS_STR}")
        else:
            print(f"  Random selection at {(1-SUPPLIER_RELIABILITY_RATE)*100:.0f}% unreliability rate")
    else:
        print("Supplier Reliability: All suppliers are reliable (100%)")

    df_afko, df_resb, df_matdoc_prod = convert_plan_to_execution(df_sim_results, bom_map, unreliable_materials)
    wh.save("afko", df_afko)

    if len(df_resb) > 0:
        wh.save("resb", df_resb)
        print(f"  Saved RESB with {len(df_resb)} records")
    else:
        print("  Warning: No RESB records created (no raw material consumption)")

    df_matdoc_final = pd.concat([df_matdoc_sales, df_matdoc_prod], ignore_index=True)

    wh.save("matdoc", df_matdoc_final)

    df_mard_initial = wh.read("mard")
    df_mardh = generate_mardh(df_matdoc_final, df_mard_initial)
    wh.save("mardh", df_mardh)

    print("\n--- Generating Purchase Order Data ---")

    eina_exists = False
    eine_exists = False
    try:
        wh.read("eina")
        eina_exists = True
        print("  EINA table found")
    except:
        print("  WARNING: EINA table not found - run Masterdata generation first")

    try:
        wh.read("eine")
        eine_exists = True
        print("  EINE table found")
    except:
        print("  WARNING: EINE table not found - run Masterdata generation first")

    if eina_exists and eine_exists:
        try:
            df_eina = wh.read("eina")
            df_eine = wh.read("eine")

            df_ekko, df_ekpo = generate_purchase_orders(df_eina, df_eine, df_matdoc_final)
            wh.save("ekko", df_ekko)
            wh.save("ekpo", df_ekpo)
            print(f"  Saved EKKO with {len(df_ekko)} records")
            print(f"  Saved EKPO with {len(df_ekpo)} records")

            df_ekbe = generate_po_delivery_history(df_ekko, df_ekpo, df_eine)
            wh.save("ekbe", df_ekbe)
            print(f"  Saved EKBE with {len(df_ekbe)} records")

        except Exception as e:
            import traceback
            print(f"ERROR: Purchase order generation failed:")
            print(f"  {type(e).__name__}: {e}")
            traceback.print_exc()
    else:
        print("  Skipping purchase order generation (missing prerequisite tables)")

    print("Clean data generation complete.")

    print("\nTransaction Generation Complete.")
