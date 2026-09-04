# Databricks notebook source
!pip install faker

import pandas as pd
import numpy as np
import math
import uuid
from math import radians, sin, cos, sqrt, asin
from faker import Faker
import random
from datetime import datetime, timedelta
import pyspark.sql.functions as F
from pyspark.sql.types import *

# COMMAND ----------

# Configuration & Seeding
dbutils.widgets.text("CATALOG", "sample_synthetic_sap", "Catalog Name")
dbutils.widgets.text("SCHEMA", "sap", "Schema Name")
dbutils.widgets.text("RANDOM_SEED", "42", "Random Seed")
dbutils.widgets.text("NUM_ORDERS", "5000", "Number of Sales Orders")
dbutils.widgets.text("HUB_PLANT", "1000", "Hub Plant (Production)")
dbutils.widgets.text("DELIVERY_FILL_RATE", "0.8", "Delivery Fill Rate (0-1)")
dbutils.widgets.text("SAFETY_STOCK_WEEKS", "6", "Safety Stock Weeks Coverage")
dbutils.widgets.text("SUPPLIER_RELIABILITY_RATE", "1.0", "Supplier Reliability (0.0-1.0)")
dbutils.widgets.text("UNRELIABLE_MATERIALS", "", "Specific unreliable materials (comma-separated)")
dbutils.widgets.text("DATASET_CURRENCY", "EUR", "Dataset Currency")

CATALOG = dbutils.widgets.get("CATALOG")
SCHEMA = dbutils.widgets.get("SCHEMA")
RANDOM_SEED = int(dbutils.widgets.get("RANDOM_SEED"))
NUMBER_OF_ORDERS = int(dbutils.widgets.get("NUM_ORDERS"))
HUB_PLANT = dbutils.widgets.get("HUB_PLANT")
DELIVERY_FILL_RATE = float(dbutils.widgets.get("DELIVERY_FILL_RATE"))
SAFETY_STOCK_WEEKS = int(dbutils.widgets.get("SAFETY_STOCK_WEEKS"))
SUPPLIER_RELIABILITY_RATE = float(dbutils.widgets.get("SUPPLIER_RELIABILITY_RATE"))
UNRELIABLE_MATERIALS_STR = dbutils.widgets.get("UNRELIABLE_MATERIALS")
DATASET_CURRENCY = dbutils.widgets.get("DATASET_CURRENCY").upper()

Faker.seed(RANDOM_SEED)
random.seed(RANDOM_SEED)
np.random.seed(RANDOM_SEED)
fake = Faker('en_GB')

print(f"Target: {CATALOG}.{SCHEMA} | Seed: {RANDOM_SEED}")

# Predefined users for document creation
PREDEFINED_USERS = ['USER_A', 'USER_B', 'ADMIN', 'JOHNDOE', 'AUTO_JOB']
print(f"Config: {NUMBER_OF_ORDERS} orders, Hub={HUB_PLANT}, Fill Rate={DELIVERY_FILL_RATE}, Safety Stock={SAFETY_STOCK_WEEKS} weeks")
print(f"Supplier Reliability: {SUPPLIER_RELIABILITY_RATE} (unreliable materials: {UNRELIABLE_MATERIALS_STR or 'random selection'})")

START_STOCK_MULTI = 1.2


# READ MASTER DATA
# (Necessary for the Simulation to know what materials exist)
df_mara = spark.table(f"{CATALOG}.{SCHEMA}.mara")
df_stpo = spark.table(f"{CATALOG}.{SCHEMA}.stpo")
df_mast = spark.table(f"{CATALOG}.{SCHEMA}.mast")
df_mbew = spark.table(f"{CATALOG}.{SCHEMA}.mbew")

FINISHED_PRODUCTS = [row['MATNR'] for row in df_mara.filter("MTART = 'FERT'").select('MATNR').distinct().collect()]
ALL_CUSTOMERS = [row['KUNNR'] for row in spark.table(f"{CATALOG}.{SCHEMA}.kna1").select('KUNNR').distinct().collect()]
PLANT_CONFIG = {
    '1000': {'city': 'Stuttgart', 'country': 'DE', 'xpos': 9.1829, 'ypos': 48.7758},
    '2000': {'city': 'Frankfurt', 'country': 'DE', 'xpos': 8.6821, 'ypos': 50.1109},
    '3000': {'city': 'Newark', 'country': 'US', 'xpos': -74.1724, 'ypos': 40.7357},
    '4000': {'city': 'Singapore', 'country': 'SG', 'xpos': 103.8198, 'ypos': 1.3521},
    '5000': {'city': 'Cork', 'country': 'IE', 'xpos': -8.4756, 'ypos': 51.8985},
}
PLANTS = list(PLANT_CONFIG)

# PRICING CONFIG
# Build pricing lookup from MBEW (standard cost) with sales markup
SALES_MARKUP = 0.35  # 35% markup on cost for selling price
price_rows = df_mbew.select('MATNR', 'BWKEY', 'STPRS').collect()
# BWKEY is the plant in MBEW
PRICE_LOOKUP = {}
for row in price_rows:
    if row['STPRS'] is not None and row['MATNR'] is not None and row['BWKEY'] is not None:
        PRICE_LOOKUP[(row['MATNR'], row['BWKEY'])] = float(row['STPRS']) * (1 + SALES_MARKUP)
# Fallback: average price by material if plant-specific not found
material_prices = {}
for (matnr, _), price in PRICE_LOOKUP.items():
    if matnr not in material_prices:
        material_prices[matnr] = []
    material_prices[matnr].append(price)
PRICE_FALLBACK = {m: sum(p)/len(p) for m, p in material_prices.items()} if material_prices else {}
print(f"Pricing loaded: {len(PRICE_LOOKUP)} plant-specific prices, {len(PRICE_FALLBACK)} material averages")

# Build BOM Lookup
print("Building BOM Lookup...")
bom_map = {}
mast_dict = {row['MATNR']: row['STLNR'] for row in df_mast.select('MATNR', 'STLNR').collect()} 
stpo_rows = df_stpo.select('STLNR', 'IDNRK', 'MENGE', 'MEINS').collect()
stpo_dict = {}
for row in stpo_rows:
    if row['STLNR'] not in stpo_dict: stpo_dict[row['STLNR']] = []
    stpo_dict[row['STLNR']].append({'child_mat': row['IDNRK'], 'qty': row['MENGE'], 'uom': row['MEINS']})

for parent, stlnr in mast_dict.items():
    if stlnr in stpo_dict:
        bom_map[parent] = {'stlnr': stlnr, 'components': stpo_dict[stlnr]}

# Scenario IDs
MAT_CONTAMINATED = "MAT-A0005"
MAT_INDIA_PRODUCT = "MAT-A0020"
CUST_INDIA = "CUST00020"

# COMMAND ----------

# Helper: Safe Save (with Schema Evolution)
def save_sap_table(df_spark, table_name):
    full_table_name = f"{CATALOG}.{SCHEMA}.{table_name}"

    for col in df_spark.columns: df_spark = df_spark.withColumnRenamed(col, col.upper())

    if not spark.catalog.tableExists(full_table_name):
        print(f"Creating {table_name}...")
        df_spark.write.format("delta").saveAsTable(full_table_name)
    else:
        print(f"Updating {table_name}...")
        # Use overwriteSchema for full table replacement with potential schema changes
        df_spark.write.format("delta").mode("overwrite").option("overwriteSchema", "true").saveAsTable(full_table_name)

# COMMAND ----------

# BATCH TRACKING
# Global batch counter for production-created batches
BATCH_COUNTER = 1000000

def generate_production_batch(matnr, werks, year=2025):
    """Generate a new batch ID for production output."""
    global BATCH_COUNTER
    BATCH_COUNTER += 1
    mat_suffix = matnr.replace('MAT-', '').replace('-', '')[:4]
    return f"B{year}{mat_suffix}{BATCH_COUNTER % 1000:03d}"

# Load initial batch inventory from MARD for batch selection
print("Loading batch inventory from MARD...")
df_mard = spark.table(f"{CATALOG}.{SCHEMA}.mard")

mard_columns = df_mard.columns
if 'CHARG' in mard_columns:
    mard_rows = df_mard.select('MATNR', 'WERKS', 'LGORT', 'CHARG', 'LABST').collect()
    has_batch_column = True
else:
    print("Warning: MARD table does not have CHARG column. Batch tracking will be limited.")
    mard_rows = df_mard.select('MATNR', 'WERKS', 'LGORT', 'LABST').collect()
    has_batch_column = False

# Build batch inventory lookup: (MATNR, WERKS, LGORT) -> [(CHARG, LABST), ...]
BATCH_INVENTORY = {}
for row in mard_rows:
    key = (row['MATNR'], row['WERKS'], row['LGORT'])
    if key not in BATCH_INVENTORY:
        BATCH_INVENTORY[key] = []
    charg = row['CHARG'] if has_batch_column else ''
    if charg and row['LABST'] and float(row['LABST']) > 0:
        BATCH_INVENTORY[key].append({'batch': charg, 'qty': float(row['LABST'])})

# Sort batches by batch ID (FIFO approximation - older batches first)
for key in BATCH_INVENTORY:
    BATCH_INVENTORY[key].sort(key=lambda x: x['batch'])

print(f"Batch inventory loaded: {len(BATCH_INVENTORY)} location combinations with batches")

# INVENTORY TRACKING
# Track total available stock by material/plant/location (aggregated across batches)
# This is used to prevent goods issues from exceeding available stock
# NOTE: Include ALL stock from MARD, not just batched stock (raw materials may not have batches)
AVAILABLE_STOCK = {}
for row in mard_rows:
    key = (row['MATNR'], row['WERKS'], row['LGORT'])
    stock = float(row['LABST']) if row['LABST'] else 0
    if stock > 0:
        if key not in AVAILABLE_STOCK:
            AVAILABLE_STOCK[key] = 0
        AVAILABLE_STOCK[key] += stock

print(f"Available stock loaded: {len(AVAILABLE_STOCK)} material/plant/location combinations")

def add_stock(matnr, werks, lgort, qty, batch_id=''):
    """Add stock from goods receipt (production, purchase, transfer in)."""
    key = (matnr, werks, lgort)
    if key not in AVAILABLE_STOCK:
        AVAILABLE_STOCK[key] = 0
    AVAILABLE_STOCK[key] += qty

    # Also add to batch inventory for FIFO tracking
    if key not in BATCH_INVENTORY:
        BATCH_INVENTORY[key] = []
    if batch_id:
        BATCH_INVENTORY[key].append({'batch': batch_id, 'qty': qty})

def get_available_stock(matnr, werks, lgort):
    """Get current available stock for a material/plant/location."""
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

    # Limit to available stock
    available = AVAILABLE_STOCK.get(key, 0)
    actual_qty = min(qty_needed, max(0, available))

    if actual_qty <= 0:
        return [('', 0)]  # No stock available

    # Consume from available stock
    AVAILABLE_STOCK[key] = available - actual_qty

    # Select batch for FIFO
    if key not in BATCH_INVENTORY or not BATCH_INVENTORY[key]:
        return [('', actual_qty)]

    for batch_info in BATCH_INVENTORY[key]:
        if batch_info['qty'] > 0:
            # Deduct from batch
            deduct = min(batch_info['qty'], actual_qty)
            batch_info['qty'] -= deduct
            return [(batch_info['batch'], actual_qty)]

    return [('', actual_qty)]

# COMMAND ----------

# SUPPLIER RELIABILITY HELPER FUNCTIONS
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
        # Use specific materials if provided
        return set(m.strip() for m in specific_materials.split(','))
    else:
        # Random selection: (1 - reliability_rate) of materials are unreliable
        unreliable_rate = 1.0 - reliability_rate
        if unreliable_rate <= 0:
            return set()
        # Use deterministic seed for reproducibility
        rng = random.Random(RANDOM_SEED)
        return set(
            m for m in all_raw_materials
            if rng.random() < unreliable_rate
        )

# COMMAND ----------

# Step 1: Sales Generation (VBEP)
def generate_sales_orders(finished_goods, all_customers):
    print(f"Generating {NUMBER_OF_ORDERS} Sales Orders...")
    vbak, vbap, vbep = [], [], []
    base_date = datetime.now()
    india_customer_exists = CUST_INDIA in all_customers

    for i in range(NUMBER_OF_ORDERS):
        vbeln = f'{1000000000 + i:010d}'
        days_offset = random.randint(0, 365)
        order_date_dt = base_date - timedelta(days=days_offset)
        order_date = order_date_dt.strftime('%Y%m%d')
        req_date = (order_date_dt + timedelta(days=7)).strftime('%Y%m%d')

        # Scenario: India Customer
        if i % 100 == 0 and india_customer_exists: kunnr = CUST_INDIA
        else: kunnr = random.choice(all_customers)

        order_total = 0.0
        num_items = random.randint(1, 3)
        order_lines = []

        for j in range(num_items):
            posnr = f'{(j + 1) * 10:06d}'
            matnr = MAT_INDIA_PRODUCT if kunnr == CUST_INDIA else random.choice(finished_goods)
            werks = random.choice(PLANTS)
            qty = random.randint(10, 100)

            # Get price from MBEW (with markup) - try plant-specific, then material average, then default
            unit_price = PRICE_LOOKUP.get((matnr, werks), PRICE_FALLBACK.get(matnr, 100.0))
            line_value = round(qty * unit_price, 2)
            order_total += line_value

            order_lines.append({
                'MANDT': '800', 'VBELN': vbeln, 'POSNR': posnr, 'MATNR': matnr,
                'WERKS': werks, 'LGORT': 'FG01', 'KWMENG': qty, 'MEINS': 'PC',
                'NETPR': round(unit_price, 2), 'NETWR': line_value, 'WAERK': DATASET_CURRENCY
            })
            vbep.append({
                'MANDT': '800', 'VBELN': vbeln, 'POSNR': posnr, 'ETENR': '0001',
                'EDATU': req_date, 'WMENG': qty, 'BMENG': qty
            })

        vbak.append({
            'MANDT': '800', 'VBELN': vbeln, 'AUART': 'OR', 'KUNNR': kunnr,
            'ERDAT': order_date, 'NETWR': round(order_total, 2), 'VDATU': req_date,
            'WAERK': DATASET_CURRENCY, 'ERNAM': random.choice(PREDEFINED_USERS),
            'BSTNK': f'PO-{vbeln}'
        })
        vbap.extend(order_lines)

    return pd.DataFrame(vbak), pd.DataFrame(vbap), pd.DataFrame(vbep)

# COMMAND ----------

# Step 2: Deliveries & Goods Issue
def generate_logistics(df_vbak, df_vbap, df_vbep):
    print("Generating Deliveries (LIKP/LIPS/VBFA)...")
    
    unique_orders = df_vbap['VBELN'].unique()
    # 80% Delivery Rate
    keep_mask = np.random.rand(len(unique_orders)) < DELIVERY_FILL_RATE
    delivered_vbelns = unique_orders[keep_mask]
    
    df_vbap_del = df_vbap[df_vbap['VBELN'].isin(delivered_vbelns)].copy()
    
    df_proc = df_vbap_del.merge(df_vbak[['VBELN', 'KUNNR']], on='VBELN')
    # Get Request Date from VBEP (First one per order)
    df_proc = df_proc.merge(df_vbep[['VBELN', 'EDATU']].drop_duplicates('VBELN'), on='VBELN')
    
    header_groups = df_proc[['VBELN', 'KUNNR', 'EDATU']].drop_duplicates('VBELN').reset_index(drop=True)
    del_ids = np.random.randint(8000000000, 8999999999, size=len(header_groups))
    header_groups['VBELN_DELIVERY'] = [f'{x:010d}' for x in del_ids]
    
    likp = pd.DataFrame({
        'MANDT': '800', 'VBELN': header_groups['VBELN_DELIVERY'], 'KUNNR': header_groups['KUNNR'],
        'LFDAT': header_groups['EDATU'], 'LFART': 'LF'
    })
    
    # Map back for LIPS
    df_proc = df_proc.merge(header_groups[['VBELN', 'VBELN_DELIVERY']], on='VBELN')

    # Check inventory availability FIRST - select batch returns (batch_id, actual_qty) limited to available stock
    batch_results = df_proc.apply(
        lambda row: select_batch_for_issue(row['MATNR'], row['WERKS'], 'FG01', row['KWMENG'])[0],
        axis=1
    )
    df_proc['BATCH_ID'] = batch_results.apply(lambda x: x[0])
    df_proc['ACTUAL_QTY'] = batch_results.apply(lambda x: x[1])

    # Filter out zero-quantity issues (no stock available) - inventory cannot go negative
    df_proc_with_stock = df_proc[df_proc['ACTUAL_QTY'] > 0].copy()

    if len(df_proc_with_stock) < len(df_proc):
        print(f"  Note: {len(df_proc) - len(df_proc_with_stock)} deliveries skipped due to insufficient stock")

    # Regenerate POSNR after filtering
    df_proc_with_stock['POSNR_LIPS'] = (df_proc_with_stock.groupby('VBELN_DELIVERY').cumcount() + 1).apply(lambda x: f'{x*10:06d}')

    # LIPS - delivery items with actual shipped quantity
    lips = pd.DataFrame({
        'MANDT': '800', 'VBELN': df_proc_with_stock['VBELN_DELIVERY'], 'POSNR': df_proc_with_stock['POSNR_LIPS'],
        'MATNR': df_proc_with_stock['MATNR'], 'WERKS': df_proc_with_stock['WERKS'], 'LFIMG': df_proc_with_stock['ACTUAL_QTY']
    })

    # MATDOC (Goods Issue 601) - with inventory constraint
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

    # VBFA - document flow with actual quantities
    vbfa = pd.DataFrame({
        'MANDT': '800', 'VBELN': df_proc_with_stock['VBELN'], 'POSNN': df_proc_with_stock['POSNR'],
        'VBELN_N': df_proc_with_stock['VBELN_DELIVERY'], 'POSNN_N': df_proc_with_stock['POSNR_LIPS'],
        'VBTYP_V': 'C', 'VBTYP_N': 'J', 'RFMNG': df_proc_with_stock['ACTUAL_QTY']
    })

    # Filter LIKP to only include deliveries that have items (exclude empty deliveries)
    deliveries_with_items = set(df_proc_with_stock['VBELN_DELIVERY'].unique())
    likp = likp[likp['VBELN'].isin(deliveries_with_items)].copy()

    # Return only sales orders that actually had items shipped
    actual_delivered_vbelns = set(df_proc_with_stock['VBELN'].unique())

    return likp, lips, matdoc, vbfa, actual_delivered_vbelns

# COMMAND ----------

# Step 2b: Shipment Generation (VTTK, VTTP, VTTS)

# Plant location master data with geo coordinates (mirrors Masterdata)
EU_COUNTRIES = {'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK'}
PORT_PLANTS = {'3000', '4000', '5000'}

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
    if country_from == country_to:
        return 0
    if country_from in EU_COUNTRIES and country_to in EU_COUNTRIES:
        return 0
    return 1

def transport_modes_for_lane(loc_from, loc_to, distance_km):
    country_from = PLANT_CONFIG[loc_from]['country']
    country_to = PLANT_CONFIG[loc_to]['country']
    modes = ['AIR']
    if country_from == country_to or (
        country_from in EU_COUNTRIES and country_to in EU_COUNTRIES
    ):
        modes.insert(0, 'ROAD')
    if loc_from in PORT_PLANTS and loc_to in PORT_PLANTS and distance_km > 200:
        modes.append('SEA')
    return modes

def get_route_code(from_plant, to_plant):
    """Generate route code in format R{FROM}{TO}."""
    return f"R{from_plant[:2]}{to_plant[:2]}"

def get_best_transport_mode(from_plant, to_plant, distance_km):
    """Determine the best transport mode based on cost."""
    available_modes = transport_modes_for_lane(from_plant, to_plant, distance_km)
    return min(
        available_modes,
        key=lambda mode: TRANSPORT_MODES[mode]['cost_per_km'],
    )

def generate_shipments(df_likp, df_lips, df_vbap):
    """
    Generates shipment tables VTTK (Header), VTTP (Items), VTTS (Stages).
    Creates shipments for deliveries, linking them to routes.
    """
    print("Generating Shipments (VTTK/VTTP/VTTS)...")

    vttk_data = []
    vttp_data = []
    vtts_data = []

    # Merge delivery data with order data to get plant info
    df_delivery = df_lips.merge(
        df_likp[['VBELN', 'LFDAT', 'KUNNR']],
        on='VBELN',
        suffixes=('', '_H')
    )

    # Get plant from VBAP for each delivery
    if 'WERKS' not in df_delivery.columns or df_delivery['WERKS'].isna().all():
        # If no WERKS in LIPS, try to get from VBAP via VGBEL/VGPOS
        if 'VGBEL' in df_delivery.columns:
            df_delivery = df_delivery.merge(
                df_vbap[['VBELN', 'POSNR', 'WERKS']].rename(columns={'VBELN': 'VGBEL', 'POSNR': 'VGPOS'}),
                on=['VGBEL', 'VGPOS'],
                how='left',
                suffixes=('', '_VBAP')
            )
            if 'WERKS_VBAP' in df_delivery.columns:
                df_delivery['WERKS'] = df_delivery['WERKS_VBAP'].fillna(df_delivery.get('WERKS', '1000'))

    # Group deliveries by delivery number
    delivery_groups = df_delivery.groupby('VBELN')

    shipment_counter = 7000000000
    forwarding_agents = ['DHL', 'KUEHNE', 'DBSCHENK', 'MAERSK', 'FEDEX']

    for del_vbeln, del_items in delivery_groups:
        # Create shipment for this delivery
        tknum = f'{shipment_counter:010d}'
        shipment_counter += 1

        # Get source plant (supplying plant) and destination
        first_item = del_items.iloc[0]
        source_plant = first_item.get('WERKS', '1000')
        if pd.isna(source_plant) or source_plant == '':
            source_plant = '1000'  # Hub plant

        delivery_date_str = first_item.get('LFDAT', datetime.now().strftime('%Y%m%d'))

        # For simplicity, assume customer is in a different location (random destination plant)
        # In reality this would be determined by customer address
        dest_plants = [p for p in PLANT_CONFIG if p != source_plant]
        dest_plant = random.choice(dest_plants) if dest_plants else '2000'

        # Calculate route
        from_info = PLANT_CONFIG.get(source_plant, PLANT_CONFIG['1000'])
        to_info = PLANT_CONFIG.get(dest_plant, PLANT_CONFIG['2000'])

        distance_km = haversine_km(
            from_info['ypos'], from_info['xpos'],
            to_info['ypos'], to_info['xpos']
        )

        # Get best transport mode
        transport_mode = get_best_transport_mode(source_plant, dest_plant, distance_km)
        mode_info = TRANSPORT_MODES[transport_mode]

        # Calculate travel time
        travel_hours = distance_km / mode_info['speed_kmh']
        customs_delay = customs_days(from_info['country'], to_info['country'])

        # Route code
        route = get_route_code(source_plant, dest_plant)

        # Parse delivery date and calculate dispatch/delivery dates
        try:
            del_date = datetime.strptime(str(delivery_date_str), '%Y%m%d')
        except:
            del_date = datetime.now()

        dispatch_date = del_date - timedelta(days=int(travel_hours/24) + customs_delay + 1)

        # Forwarding agent based on transport mode
        if transport_mode == 'SEA':
            agent = 'MAERSK'
        elif transport_mode == 'AIR':
            agent = 'FEDEX'
        else:
            agent = random.choice(['DHL', 'KUEHNE', 'DBSCHENK'])

        # VTTK - Shipment Header
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

        # VTTP - Shipment Items
        for idx, (_, item) in enumerate(del_items.iterrows()):
            tpnum = f'{(idx + 1) * 10:06d}'
            vttp_data.append({
                'MANDT': '800',
                'TKNUM': tknum,
                'TPNUM': tpnum,
                'VBELN': del_vbeln,  # Delivery number
                'LAUFK': 'A',  # Leg indicator (A = single leg)
            })

        # VTTS - Stage of Shipment (single stage for simple shipments)
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

# COMMAND ----------

# Step 3: Hub & Spoke Simulation - Schema Definition
network_schema = StructType([
    StructField("TYPE", StringType(), True), StructField("MATNR", StringType(), True),
    StructField("SUPPLY_PLANT", StringType(), True), StructField("RECEIVE_PLANT", StringType(), True), 
    StructField("QUANTITY", DoubleType(), True), StructField("DATE", StringType(), True),
    StructField("ID_REF", StringType(), True)
])

# COMMAND ----------

# Hub & Spoke Simulation Function
def simulate_hub_spoke_v2(pdf: pd.DataFrame) -> pd.DataFrame:
    if pdf.empty:
        return pd.DataFrame(columns=['TYPE', 'MATNR', 'SUPPLY_PLANT', 'RECEIVE_PLANT', 'QUANTITY', 'DATE', 'ID_REF'])

    mat = pdf['MATNR'].iloc[0]
    plant_states = {}

    # Get unique plants by grouping to avoid type/matching issues
    plant_groups = pdf.groupby('WERKS', dropna=False).first().reset_index()
    all_plants = plant_groups['WERKS'].tolist()

    # Get MOQ from hub plant row
    hub_rows = plant_groups[plant_groups['WERKS'] == HUB_PLANT]
    if len(hub_rows) > 0 and 'MOQ' in plant_groups.columns:
        moq = hub_rows['MOQ'].iloc[0]
        moq = int(moq) if pd.notna(moq) and moq > 0 else 500
    else:
        moq = 500

    # Initialize Stock (Default to enough coverage to start)
    for _, row in plant_groups.iterrows():
        plant = row['WERKS']
        safety = row['EISBE'] if pd.notna(row.get('EISBE')) and row.get('EISBE', 0) > 0 else 500
        plant_states[plant] = {'inv': safety * START_STOCK_MULTI, 'safety': safety}

    pdf = pdf.sort_values('Week_Start')
    weeks = pdf['Week_Start'].unique()
    output_rows = []

    for week in weeks:
        week_str = pd.Timestamp(week).strftime('%Y%m%d')
        week_demand = pdf[pdf['Week_Start'] == week]
        hub_outflow = 0

        # SPOKES
        for plant in all_plants:
            if plant == HUB_PLANT: continue
            sales = week_demand[week_demand['WERKS'] == plant]['PLNMG'].sum()
            plant_states[plant]['inv'] -= sales

            # Reorder Logic - restore to safety stock level with MOQ rounding for lumpy replenishments
            if plant_states[plant]['inv'] < plant_states[plant]['safety']:
                order_qty = plant_states[plant]['safety'] - plant_states[plant]['inv']
                # Round up to MOQ for realistic lumpy replenishments
                order_qty = math.ceil(order_qty / moq) * moq

                plant_states[plant]['inv'] += order_qty
                hub_outflow += order_qty
                output_rows.append({
                    'TYPE': 'TRNS', 'MATNR': mat, 'SUPPLY_PLANT': HUB_PLANT, 'RECEIVE_PLANT': plant,
                    'QUANTITY': float(order_qty), 'DATE': week_str, 'ID_REF': f"TR{random.randint(10000,99999)}"
                })

        # HUB Logic - Production uses MOQ
        hub_sales = week_demand[week_demand['WERKS'] == HUB_PLANT]['PLNMG'].sum()
        plant_states[HUB_PLANT]['inv'] -= (hub_sales + hub_outflow)

        if plant_states[HUB_PLANT]['inv'] < plant_states[HUB_PLANT]['safety']:
            prod_qty = plant_states[HUB_PLANT]['safety'] - plant_states[HUB_PLANT]['inv']
            # Round up to MOQ for realistic lumpy production batches
            prod_qty = math.ceil(prod_qty / moq) * moq

            plant_states[HUB_PLANT]['inv'] += prod_qty
            output_rows.append({
                'TYPE': 'PROD', 'MATNR': mat, 'SUPPLY_PLANT': HUB_PLANT, 'RECEIVE_PLANT': HUB_PLANT,
                'QUANTITY': float(prod_qty), 'DATE': week_str, 'ID_REF': f"PL{random.randint(10000000,99999999)}"
            })

    return pd.DataFrame(output_rows)

def run_network_simulation(df_sim_input_spark):
    print("Running Hub & Spoke Simulation...")
    # Include MOQ from MARC for production planning
    # Use BSTMI if available, otherwise fall back to BSTMA (for backward compatibility)
    df_marc_full = spark.table(f"{CATALOG}.{SCHEMA}.marc")
    marc_cols = df_marc_full.columns
    if "BSTMI" in marc_cols:
        df_marc_spark = df_marc_full.select("MATNR", "WERKS", "EISBE", F.col("BSTMI").alias("MOQ"))
    elif "BSTMA" in marc_cols:
        df_marc_spark = df_marc_full.select("MATNR", "WERKS", "EISBE", F.col("BSTMA").alias("MOQ"))
    else:
        df_marc_spark = df_marc_full.select("MATNR", "WERKS", "EISBE", F.lit(500).alias("MOQ"))

    df_input = (
        df_sim_input_spark
        .withColumn("Date_Obj", F.to_date(F.col("EDATU"), "yyyyMMdd"))
        .withColumn("Week_Start", F.date_trunc("week", F.col("Date_Obj")))
        .groupBy("MATNR", "WERKS", "Week_Start")
        .agg(F.sum("PLNMG").alias("PLNMG"))
        .join(df_marc_spark, on=["MATNR", "WERKS"], how="left")  # Joins EISBE and MOQ
    )
    return df_input.groupBy("MATNR").applyInPandas(simulate_hub_spoke_v2, schema=network_schema)

def convert_plan_to_execution(df_sim_results, bom_map, unreliable_materials=None):
    """
    Convert simulation results to SAP execution tables.
    Now handles supplier unreliability causing partial production.

    Args:
        df_sim_results: Spark DataFrame with simulation results
        bom_map: Dictionary mapping finished goods to their BOM components
        unreliable_materials: Set of raw materials with unreliable suppliers
    """
    print("Converting Simulation Plan to SAP Execution Data...")

    if unreliable_materials is None:
        unreliable_materials = set()

    # Materialize Spark DF to Pandas for iteration
    # (Safe here because simulation output is aggregated/small compared to raw transactions)
    df_prod = df_sim_results.filter(F.col("TYPE") == 'PROD').toPandas()
    df_trans = df_sim_results.filter(F.col("TYPE") == 'TRNS').toPandas()

    afko, resb, matdoc = [], [], []
    matdoc_id = 9000000000
    shortage_doc_id = 7000000000  # Separate counter for shortage docs
    reservation_number_counter = 5000000000

    # Use a deterministic RNG for supplier delivery rates
    supplier_rng = random.Random(RANDOM_SEED + 999)

    # Track statistics
    stats = {'complete': 0, 'partial': 0, 'blocked': 0, 'shortage_docs': 0}

    # 1. PROCESS PRODUCTION (Hub 1000)
    # NOTE: Only FERT (finished goods) materials reach this point because:
    # 1. Sales orders only contain FINISHED_PRODUCTS (MTART='FERT')
    # 2. Hub & Spoke simulation only runs for those sold materials
    # 3. Raw materials (ROH) are NEVER produced - they are only consumed via BOM (261 movements)
    print(f"Processing {len(df_prod)} Production Orders...")

    for _, row in df_prod.iterrows():
        matnr = row['MATNR']
        planned_qty = row['QUANTITY']
        plant = row['SUPPLY_PLANT']
        date = row['DATE']

        aufnr = f"ORD{random.randint(1000000,9999999)}"
        reservation_number = ''
        if matnr in bom_map:
            reservation_number_counter += 1
            reservation_number = str(reservation_number_counter)

        # Check component availability if BOM exists
        actual_qty = planned_qty
        shortage_components = []
        status = 'CNF'
        shortage_reason = ''

        if matnr in bom_map and unreliable_materials:
            bom = bom_map[matnr]
            for comp in bom['components']:
                comp_mat = comp['child_mat']

                # Check if this component has unreliable supplier
                if comp_mat in unreliable_materials:
                    # Simulate partial delivery (30-80% delivered)
                    delivery_rate = supplier_rng.uniform(0.3, 0.8)

                    # Calculate max producible based on this component
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
            status = 'CRTD'
            actual_qty = 0
            shortage_reason = f"Blocked: insufficient {', '.join(s['material'] for s in shortage_components)}"
            stats['blocked'] += 1
        elif actual_qty < planned_qty:
            status = 'PCNF'
            shortage_parts = [s['material'] + '(' + str(int(s['delivery_rate']*100)) + '%)' for s in shortage_components]
            shortage_reason = 'Partial: ' + ', '.join(shortage_parts)
            stats['partial'] += 1
        else:
            stats['complete'] += 1

        # A. Create Header (AFKO) with status tracking
        afko.append({
            'MANDT': '800',
            'AUFNR': aufnr,
            'PLNBEZ': matnr,
            'GAMNG': planned_qty,      # Planned/target quantity
            'IGMNG': actual_qty,       # Actual produced quantity
            'GSTRP': date,
            'WERKS': plant,
            'RSNUM': reservation_number,
            'STAT': status,
            'ZZ_SHORTAGE_REASON': shortage_reason  # Reason for shortage/block
        })

        # B. Create Goods Receipt (101) only for actual production - creates new batch
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
                # Calculate actual consumption based on actual production
                actual_consumption = comp['qty'] * actual_qty

                comp_batch, consumed_qty = select_batch_for_issue(
                    comp['child_mat'], plant, 'RM01', actual_consumption
                )[0]
                resb.append({
                    'MANDT': '800', 'RSNUM': reservation_number, 'RSPOS': f"{i+1:04d}",
                    'AUFNR': aufnr,
                    'MATNR': comp['child_mat'],
                    'BDMNG': comp['qty'] * planned_qty,
                    'ENMNG': consumed_qty,
                    'WERKS': plant, 'LGORT': 'RM01'
                })

                if consumed_qty > 0:
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
                        'MENGE': consumed_qty,
                        'MEINS': 'PC',
                        'BUDAT': date,
                        'CPUDT': date,
                        'CPUTM': '070000',
                        'AUFNR': aufnr,
                        'BKTXT': 'GI for Production',
                    })
                    matdoc_id += 1

        # D. Create shortage documentation (102 movements) for failed deliveries
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

    # 2. PROCESS TRANSFERS (Hub -> Spoke)
    print(f"Processing {len(df_trans)} Stock Transport Orders...")
    
    for _, row in df_trans.iterrows():
        date = row['DATE']

        # Select batch for transfer from hub inventory
        transfer_batch = select_batch_for_issue(row['MATNR'], row['SUPPLY_PLANT'], 'FG01', row['QUANTITY'])[0][0]

        # Outbound from Hub (641) - with batch
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

        # Inbound at Spoke (101) - same batch carried through
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

    # Print supplier reliability statistics
    if unreliable_materials:
        print(f"Supplier Reliability Impact:")
        print(f"  - Complete orders: {stats['complete']}")
        print(f"  - Partial orders: {stats['partial']}")
        print(f"  - Blocked orders: {stats['blocked']}")
        print(f"  - Shortage documents: {stats['shortage_docs']}")
        print(f"  - Unreliable materials: {len(unreliable_materials)}")

    return pd.DataFrame(afko), pd.DataFrame(resb), pd.DataFrame(matdoc)

# COMMAND ----------

# Step 4: Generate MARDH (Historical Stock)
# Scenario injection runs in the 'Inject Scenarios' notebook.

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

    # Parse dates and extract year-month
    df_movements = df_matdoc.copy()
    df_movements['BUDAT'] = pd.to_datetime(df_movements['BUDAT'], format='%Y%m%d', errors='coerce')
    df_movements = df_movements.dropna(subset=['BUDAT'])
    df_movements['LFGJA'] = df_movements['BUDAT'].dt.year
    df_movements['LFMON'] = df_movements['BUDAT'].dt.month

    # Calculate movement impact: S = increase stock, H = decrease stock
    df_movements['STOCK_CHANGE'] = df_movements.apply(
        lambda r: r['MENGE'] if r['SHKZG'] == 'S' else -r['MENGE'], axis=1
    )

    # Default storage location and batch if not specified
    if 'LGORT' not in df_movements.columns:
        df_movements['LGORT'] = 'FG01'
    else:
        df_movements['LGORT'] = df_movements['LGORT'].fillna('FG01')

    if 'CHARG' not in df_movements.columns:
        df_movements['CHARG'] = ''
    else:
        df_movements['CHARG'] = df_movements['CHARG'].fillna('')

    # Aggregate movements by material, plant, storage location, BATCH, and period
    movement_agg = df_movements.groupby(
        ['MATNR', 'WERKS', 'LGORT', 'CHARG', 'LFGJA', 'LFMON']
    )['STOCK_CHANGE'].sum().reset_index()

    # Get initial stock from MARD
    mard_cols = ['MATNR', 'WERKS', 'LGORT', 'LABST']
    if 'CHARG' in df_mard_initial.columns:
        mard_cols.insert(3, 'CHARG')
        initial_stock = df_mard_initial[mard_cols].copy()
        initial_stock['CHARG'] = initial_stock['CHARG'].fillna('')
    else:
        initial_stock = df_mard_initial[mard_cols].copy()
        initial_stock['CHARG'] = ''

    initial_stock['LABST'] = pd.to_numeric(initial_stock['LABST'], errors='coerce').fillna(0)

    # Get all unique combinations (including batch) and periods
    all_keys = movement_agg[['MATNR', 'WERKS', 'LGORT', 'CHARG']].drop_duplicates()
    all_periods = movement_agg[['LFGJA', 'LFMON']].drop_duplicates().sort_values(['LFGJA', 'LFMON'])

    mardh_records = []

    # For each material-plant-sloc-batch combination, calculate running stock
    for _, key in all_keys.iterrows():
        matnr, werks, lgort, charg = key['MATNR'], key['WERKS'], key['LGORT'], key['CHARG']

        # Get initial stock for this combination
        init_row = initial_stock[
            (initial_stock['MATNR'] == matnr) &
            (initial_stock['WERKS'] == werks) &
            (initial_stock['LGORT'] == lgort) &
            (initial_stock['CHARG'] == charg)
        ]
        running_stock = init_row['LABST'].values[0] if len(init_row) > 0 else 0

        # Get movements for this combination
        key_movements = movement_agg[
            (movement_agg['MATNR'] == matnr) &
            (movement_agg['WERKS'] == werks) &
            (movement_agg['LGORT'] == lgort) &
            (movement_agg['CHARG'] == charg)
        ].set_index(['LFGJA', 'LFMON'])['STOCK_CHANGE'].to_dict()

        # Calculate stock for each period
        for _, period in all_periods.iterrows():
            lfgja, lfmon = int(period['LFGJA']), int(period['LFMON'])

            # Apply movement for this period
            change = key_movements.get((lfgja, lfmon), 0)
            running_stock += change

            # Record period-end stock (only if there was activity or stock exists)
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

    # Get consumption by material (261 = goods issue for production)
    consumption = df_matdoc[df_matdoc['BWART'] == '261'].groupby('MATNR')['MENGE'].sum()

    # Join EINA with EINE to get complete info
    df_info = df_eina.merge(
        df_eine[df_eine['EKORG'] == '1000'],  # Use primary purchasing org
        on='INFNR',
        how='left'
    )

    po_counter = 4500000000
    po_item_counter = 0

    # Generate POs for each material-vendor combination
    for _, info in df_info.iterrows():
        matnr = info['MATNR']
        lifnr = info['LIFNR']

        # Get consumption for this material
        total_consumption = consumption.get(matnr, 1000)  # Default if no consumption

        # Calculate monthly order quantity (with some variation)
        monthly_qty = total_consumption / num_months

        for month_offset in range(num_months):
            # Create PO for each month
            po_date = datetime.now() - timedelta(days=(num_months - month_offset) * 30)

            po_counter += 1
            ebeln = str(po_counter)

            # Vary the quantity ±30%
            order_qty = max(info.get('MINBM', 100), monthly_qty * random.uniform(0.7, 1.3))
            order_qty = round(order_qty / 100) * 100  # Round to nearest 100

            # PO Header (EKKO)
            ekko_records.append({
                'MANDT': '800',
                'EBELN': ebeln,
                'BUKRS': '1000',  # Company code
                'BSTYP': 'F',  # PO document type (F = Standard PO)
                'BSART': 'NB',  # Document type (NB = Standard PO)
                'LIFNR': lifnr,
                'EKORG': '1000',  # Purchasing org
                'EKGRP': 'P01',  # Purchasing group
                'WAERS': DATASET_CURRENCY,
                'BEDAT': po_date.strftime('%Y%m%d'),  # PO date
                'AEDAT': po_date.strftime('%Y%m%d'),  # Creation date
                'ERNAM': random.choice(PREDEFINED_USERS),
                'KONNR': '',  # Contract number
                'FRGKE': '2',  # Release status (2 = released)
                'FRGZU': 'X',  # Release indicator
                'PROCSTAT': '05',  # Processing status (05 = released)
            })

            # PO Item (EKPO)
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

        # Determine supplier reliability
        # Default: 95% on-time, 98% full quantity
        on_time_rate = 0.95
        full_qty_rate = 0.98

        # Check if this vendor has scenario-based poor performance
        if lifnr in supplier_scenarios:
            scenario = supplier_scenarios[lifnr]
            on_time_rate = scenario.get('on_time_rate', 0.95)
            full_qty_rate = scenario.get('full_qty_rate', 0.98)

        # Simulate delivery
        is_on_time = random.random() < on_time_rate
        is_full_qty = random.random() < full_qty_rate

        # Calculate actual delivery date
        if is_on_time:
            # On time: -2 to +1 days from planned
            actual_date = planned_date + timedelta(days=random.randint(-2, 1))
        else:
            # Late: 3-14 days late
            actual_date = planned_date + timedelta(days=random.randint(3, 14))

        # Calculate actual quantity
        if is_full_qty:
            actual_qty = order_qty
        else:
            # Partial: 60-95% of order
            actual_qty = round(order_qty * random.uniform(0.6, 0.95))

        # Goods Receipt entry (BEWTP = 'E')
        ekbe_records.append({
            'MANDT': '800',
            'EBELN': ebeln,
            'EBELP': po['EBELP'],
            'ZEKKN': '0001',  # Sequential number
            'VGABE': '1',  # Transaction type (1 = GR)
            'BEWTP': 'E',  # History category (E = Goods receipt)
            'BWART': '101',  # Movement type
            'BUDAT': actual_date.strftime('%Y%m%d'),  # Posting date
            'MENGE': actual_qty,  # Quantity
            'BPMNG': actual_qty,  # Quantity in PO unit
            'DMBTR': round(actual_qty * po['NETPR'], 2),  # Amount in local currency
            'WRBTR': round(actual_qty * po['NETPR'], 2),  # Amount in doc currency
            'WAERS': DATASET_CURRENCY,
            'SHKZG': 'S',  # Debit/Credit (S = credit/increase)
            'MATNR': matnr,
            'WERKS': po['WERKS'],
            'LIFNR': lifnr,
            'XBLNR': f"GR{ebeln}",  # Reference document
            'LFBNR': f"DELV{random.randint(1000000, 9999999)}",  # Delivery note
            'CPUDT': actual_date.strftime('%Y%m%d'),
            'CPUTM': f"{random.randint(8,17):02d}{random.randint(0,59):02d}00",
            'ERNAM': random.choice(PREDEFINED_USERS),
            # Custom fields for OTIF analysis
            'EINDT_PLAN': po['EINDT'],  # Planned delivery date
            'OTIF_ONTIME': 'X' if is_on_time else '',
            'OTIF_INFULL': 'X' if is_full_qty else '',
        })

    print(f"  Generated {len(ekbe_records)} goods receipt records")

    # Calculate and print OTIF summary
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

# COMMAND ----------

# Main Execution
# SMART CATALOG SETUP
target_catalog = CATALOG 
setup_done = False
print(f"Setup: Checking catalog '{target_catalog}'...")

try:
    spark.sql(f"USE CATALOG {target_catalog}")
    setup_done = True
except Exception:
    pass

if not setup_done:
    try:
        spark.sql(f"CREATE CATALOG IF NOT EXISTS {target_catalog}")
        spark.sql(f"USE CATALOG {target_catalog}")
    except Exception:
        print("Falling back to hive_metastore")
        CATALOG = "hive_metastore"
        spark.sql(f"USE CATALOG {CATALOG}")

spark.sql(f"CREATE SCHEMA IF NOT EXISTS {CATALOG}.{SCHEMA}")
print(f"Active Target: {CATALOG}.{SCHEMA}")

# READ MASTER DATA (Dynamically)
# Ensure we have the lists for generation
df_mara = spark.table(f"{CATALOG}.{SCHEMA}.mara")
df_kna1 = spark.table(f"{CATALOG}.{SCHEMA}.kna1")

FINISHED_PRODUCTS = [row['MATNR'] for row in df_mara.filter("MTART = 'FERT'").select('MATNR').distinct().collect()]
ALL_CUSTOMERS = [row['KUNNR'] for row in df_kna1.select('KUNNR').distinct().collect()]

# 1. SALES
df_vbak, df_vbap, df_vbep = generate_sales_orders(FINISHED_PRODUCTS, ALL_CUSTOMERS)

save_sap_table(spark.createDataFrame(df_vbak), "vbak")
save_sap_table(spark.createDataFrame(df_vbap), "vbap")
save_sap_table(spark.createDataFrame(df_vbep), "vbep")

# 2. PRE-SIMULATION TO DETERMINE PRODUCTION (for inventory constraints)
# We need to know what will be produced BEFORE generating deliveries
# This ensures deliveries don't exceed available stock
print("Running pre-simulation to determine production quantities...")

# All orders are potentially deliverable for simulation purposes
df_demand_presim = df_vbep.merge(df_vbap[['VBELN', 'POSNR', 'MATNR', 'WERKS']], on=['VBELN', 'POSNR'], how='left')
df_sim_presim_spark = spark.createDataFrame(
    df_demand_presim[['MATNR', 'WERKS', 'BMENG', 'EDATU']].rename(columns={'BMENG': 'PLNMG'})
)
df_presim_results = run_network_simulation(df_sim_presim_spark)

# Add production quantities to AVAILABLE_STOCK before generating deliveries
print("Pre-populating inventory with planned production...")
df_prod_presim = df_presim_results.filter(F.col("TYPE") == 'PROD').toPandas()
for _, row in df_prod_presim.iterrows():
    add_stock(row['MATNR'], row['SUPPLY_PLANT'], 'FG01', row['QUANTITY'])

# Also add transfer receipts to spoke plants
df_trans_presim = df_presim_results.filter(F.col("TYPE") == 'TRNS').toPandas()
for _, row in df_trans_presim.iterrows():
    add_stock(row['MATNR'], row['RECEIVE_PLANT'], 'FG01', row['QUANTITY'])

print(f"Pre-populated {len(df_prod_presim)} production orders and {len(df_trans_presim)} transfers")

# 2b. LOGISTICS (constrained by available stock)
df_likp, df_lips, df_matdoc_sales, df_vbfa, delivered_vbelns = generate_logistics(df_vbak, df_vbap, df_vbep)

save_sap_table(spark.createDataFrame(df_likp), "likp")
save_sap_table(spark.createDataFrame(df_lips), "lips")
save_sap_table(spark.createDataFrame(df_vbfa), "vbfa")

# 2c. SHIPMENTS
df_vttk, df_vttp, df_vtts = generate_shipments(df_likp, df_lips, df_vbap)

save_sap_table(spark.createDataFrame(df_vttk), "vttk")
save_sap_table(spark.createDataFrame(df_vttp), "vttp")
save_sap_table(spark.createDataFrame(df_vtts), "vtts")

# 3. MARC SYNC
print("Syncing Safety Stock to MARC...")
# Merge VBEP with VBAP to get MATNR/WERKS - ONLY for delivered orders
# This ensures production matches actual sales, not planned orders
df_demand_source = df_vbep.merge(df_vbap[['VBELN', 'POSNR', 'MATNR', 'WERKS']], on=['VBELN', 'POSNR'], how='left')
df_demand_source = df_demand_source[df_demand_source['VBELN'].isin(delivered_vbelns)]  # Filter to delivered only

df_demand_agg = df_demand_source.groupby(['MATNR', 'WERKS'])['BMENG'].sum().reset_index()
df_demand_agg['EISBE'] = (df_demand_agg['BMENG'] / 52 * SAFETY_STOCK_WEEKS).astype(int)
df_demand_spark = spark.createDataFrame(df_demand_agg)

df_marc_current = spark.table(f"{CATALOG}.{SCHEMA}.marc").alias("m")
df_marc_updated = (
    df_marc_current.join(df_demand_spark.alias("d"), ["MATNR", "WERKS"], "left")
    .select(*[F.col(f"m.{c}") for c in df_marc_current.columns if c != "EISBE"],
            F.coalesce(F.col("d.EISBE"), F.col("m.EISBE")).alias("EISBE"))
)
save_sap_table(df_marc_updated, "marc")

# 4. HUB & SPOKE SIM
# Prepare Input (Rename BMENG -> PLNMG)
df_sim_input_spark = spark.createDataFrame(
    df_demand_source[['MATNR', 'WERKS', 'BMENG', 'EDATU']]
    .rename(columns={'BMENG': 'PLNMG'})
)
df_sim_results = run_network_simulation(df_sim_input_spark)

# 4b. GENERATE PLAF (Planned Orders)
# PLAF captures the MRP output BEFORE execution - both production and transfer plans
print("Generating PLAF (Planned Orders)...")

def generate_plaf(df_sim_results):
    """
    Generate PLAF (Planned Orders) from simulation results.

    PLAF is the SAP standard table for MRP planned orders including:
    - In-house production (BESKZ='E')
    - Stock transfers (BESKZ='U')
    """
    plaf_records = []
    plnum_counter = 1000000

    sim_df = df_sim_results.toPandas()

    for _, row in sim_df.iterrows():
        plnum_counter += 1

        if row['TYPE'] == 'PROD':
            # Production order at hub
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
            # Stock transfer from hub to spoke
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

df_plaf = generate_plaf(df_sim_results)
save_sap_table(spark.createDataFrame(df_plaf), "plaf")
print(f"  Created {len(df_plaf)} planned orders")
print(f"    - Production (BESKZ=E): {len(df_plaf[df_plaf['BESKZ']=='E'])}")
print(f"    - Transfers (BESKZ=U):  {len(df_plaf[df_plaf['BESKZ']=='U'])}")

# 5. PROD EXECUTION (Rebuild BOM Map HERE)
print("Building BOM Map for Execution...")
df_mast = spark.table(f"{CATALOG}.{SCHEMA}.mast")
df_stpo = spark.table(f"{CATALOG}.{SCHEMA}.stpo")

bom_map = {}
mast_dict = {row['MATNR']: row['STLNR'] for row in df_mast.select('MATNR', 'STLNR').collect()} 
stpo_rows = df_stpo.select('STLNR', 'IDNRK', 'MENGE', 'MEINS').collect()
stpo_dict = {}
for row in stpo_rows:
    if row['STLNR'] not in stpo_dict: stpo_dict[row['STLNR']] = []
    stpo_dict[row['STLNR']].append({'child_mat': row['IDNRK'], 'qty': row['MENGE'], 'uom': row['MEINS']})

for parent, stlnr in mast_dict.items():
    if stlnr in stpo_dict:
        bom_map[parent] = {'stlnr': stlnr, 'components': stpo_dict[stlnr]}

# 5b. SUPPLIER RELIABILITY
# Get all raw materials and determine which have unreliable suppliers
ALL_RAW_MATERIALS = [row['MATNR'] for row in df_mara.filter("MTART = 'ROH'").select('MATNR').distinct().collect()]
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
save_sap_table(spark.createDataFrame(df_afko), "afko")

# Handle empty RESB dataframe (can happen if no raw materials consumed due to stock constraints)
if len(df_resb) > 0:
    save_sap_table(spark.createDataFrame(df_resb), "resb")
    print(f"  Saved RESB with {len(df_resb)} records")
else:
    print("  Warning: No RESB records created (no raw material consumption)")

# 5. FINAL MERGE
df_matdoc_final = pd.concat([df_matdoc_sales, df_matdoc_prod], ignore_index=True)

save_sap_table(spark.createDataFrame(df_matdoc_final), "matdoc")

# 6. GENERATE MARDH (Historical Stock)
df_mard_initial = spark.table(f"{CATALOG}.{SCHEMA}.mard")
df_mardh = generate_mardh(df_matdoc_final, df_mard_initial)
save_sap_table(spark.createDataFrame(df_mardh), "mardh")

# 7. GENERATE PURCHASE ORDERS (for supplier scenarios)
print("\n--- Generating Purchase Order Data ---")

# Check if prerequisite tables exist
eina_exists = False
eine_exists = False
try:
    spark.table(f"{CATALOG}.{SCHEMA}.eina")
    eina_exists = True
    print("  EINA table found")
except:
    print("  WARNING: EINA table not found - run Masterdata generation first")

try:
    spark.table(f"{CATALOG}.{SCHEMA}.eine")
    eine_exists = True
    print("  EINE table found")
except:
    print("  WARNING: EINE table not found - run Masterdata generation first")

if eina_exists and eine_exists:
    try:
        df_eina = spark.table(f"{CATALOG}.{SCHEMA}.eina")
        df_eine = spark.table(f"{CATALOG}.{SCHEMA}.eine")

        df_ekko, df_ekpo = generate_purchase_orders(df_eina, df_eine, df_matdoc_final)
        save_sap_table(spark.createDataFrame(df_ekko), "ekko")
        save_sap_table(spark.createDataFrame(df_ekpo), "ekpo")
        print(f"  Saved EKKO with {len(df_ekko)} records")
        print(f"  Saved EKPO with {len(df_ekpo)} records")

        # Generate delivery history with baseline performance
        df_ekbe = generate_po_delivery_history(df_ekko, df_ekpo, df_eine)
        save_sap_table(spark.createDataFrame(df_ekbe), "ekbe")
        print(f"  Saved EKBE with {len(df_ekbe)} records")

    except Exception as e:
        import traceback
        print(f"ERROR: Purchase order generation failed:")
        print(f"  {type(e).__name__}: {e}")
        traceback.print_exc()
else:
    print("  Skipping purchase order generation (missing prerequisite tables)")

print("Clean data generation complete.")

# COMMAND ----------

# Dirty data is applied by the 'Apply Dirty Data' notebook, after scenario injection.

print("\nTransaction Generation Complete.")
print("Next steps: Scenario Injection (optional) -> Dirty Data (optional) -> Smoke Tests")
