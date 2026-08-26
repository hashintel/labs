"""Inject inventory, production, and supplier scenarios."""
import pandas as pd
import numpy as np
import random
from datetime import datetime, timedelta

from ..generation.common import param, widget, seed_all


INVENTORY_SCENARIO_DEFINITIONS = {
    "SCN001": {
        "name": "Stock Deviation",
        "mvmt_type": "344",
        "description": "Quality deviation found - inventory adjustment",
        "shkzg": "H"  # Decrease stock
    },
    "SCN002": {
        "name": "Contamination",
        "mvmt_type": "551",
        "description": "Product contaminated - scrapping",
        "shkzg": "H"  # Decrease stock
    },
    "SCN003": {
        "name": "Fire Damage",
        "mvmt_type": "551",
        "description": "Warehouse fire - all stock destroyed at location",
        "shkzg": "H"  # Decrease stock
    },
    "SCN004": {
        "name": "Production Shutdown",
        "mvmt_type": "N/A",  # No material movement - node offline only
        "description": "Production shutdown - node offline but inventory accessible",
        "shkzg": "N/A"
    },
    "SCN005": {
        "name": "Batch Quarantine (Single)",
        "mvmt_type": "311",
        "description": "Batch quarantine - moved to QA storage location",
        "shkzg": "S"  # Transfer posting
    },
    "SCN006": {
        "name": "Batch Quarantine (All Locations)",
        "mvmt_type": "311",
        "description": "Product quarantine - all batches moved to QA storage across all locations",
        "shkzg": "S"  # Transfer posting
    },
    "SCN007": {
        "name": "Product Write-off",
        "mvmt_type": "551",
        "description": "Product write-off - batch permanently removed from inventory",
        "shkzg": "H"  # Decrease stock (permanent removal)
    },
    "SCN008": {
        "name": "Temperature Issue",
        "mvmt_type": "551",
        "description": "Temperature issue - all inventory destroyed at location",
        "shkzg": "H"  # Destruction decreases stock.
    },
    "SCN009": {
        "name": "Re-route (Warehouse Offline)",
        "mvmt_type": "311",
        "description": "Warehouse offline - all inventory quarantined and rerouting required",
        "shkzg": "S"  # Transfer to QA01
    },
    "SCN010": {
        "name": "Partial Shutdown (50%)",
        "mvmt_type": "N/A",  # No material movement - reduced capacity only
        "description": "Production line down - alternative line at 50% capacity",
        "shkzg": "N/A"
    }
}

SUPPLIER_SCENARIO_DEFINITIONS = {
    "SCN021": {
        "name": "Supplier Drift",
        "issue_type": "SLA_DRIFT",
        "description": "Supplier drifting from agreed SLA - declining OTIF",
        "default_target_otif": 0.72,
        "trend": "DECLINE"
    },
    "SCN022": {
        "name": "CMO Deviation Increase",
        "issue_type": "DEVIATION_INCREASE",
        "description": "CMO showing rapid deviation increase and slower responses",
        "default_target_otif": 0.65,
        "trend": "DECLINE"
    },
    "SCN023": {
        "name": "FDA 483",
        "issue_type": "FDA_483",
        "description": "Supplier received FDA 483 - review required but no immediate impact",
        "default_target_otif": 0.95,
        "trend": "STABLE"
    },
    "SCN024": {
        "name": "Vendor OTIF Decline",
        "issue_type": "OTIF_DECLINE",
        "description": "Vendor OTIF dropping due to capacity constraints",
        "default_target_otif": 0.68,
        "trend": "DECLINE"
    },
    "SCN025": {
        "name": "CAPA Failures",
        "issue_type": "CAPA_FAILURE",
        "description": "API supplier with CAPA failures - quality issues",
        "default_target_otif": 0.60,
        "trend": "DECLINE"
    },
    "SCN026": {
        "name": "CAPA Improvement",
        "issue_type": "CAPA_IMPROVEMENT",
        "description": "Supplier CAPA situation improving - reliability increasing",
        "default_target_otif": 0.85,
        "trend": "IMPROVE"
    }
}

SCENARIO_DEFINITIONS = INVENTORY_SCENARIO_DEFINITIONS

PRODUCTION_SCENARIO_DEFINITIONS = {
    "SCN011": {
        "name": "Demand Increase",
        "demand_type": "PERMANENT",
        "description": "Permanent increase in demand for a product",
        "default_increase_pct": 25
    },
    "SCN012": {
        "name": "New Product Introduction",
        "demand_type": "NEW_PRODUCT",
        "description": "New product introduction requiring BOM setup and initial orders",
        "default_increase_pct": 0
    },
    "SCN013": {
        "name": "Batch Expedition",
        "demand_type": "EMERGENCY",
        "description": "Emergency customer order requiring expedited production",
        "default_increase_pct": 50
    },
    "SCN015": {
        "name": "Equipment Failure",
        "demand_type": "DISRUPTION",
        "description": "Production line failure causing order cancellations and rescheduling",
        "default_increase_pct": 0
    },
    "SCN017": {
        "name": "Regulatory Inspection",
        "demand_type": "FREEZE",
        "description": "Regulatory freeze period blocking all shipments from plant",
        "default_increase_pct": 0
    },
    "SCN018": {
        "name": "New Production Facility",
        "demand_type": "CAPACITY_RAMP",
        "description": "New facility ramping up production capacity over time",
        "default_increase_pct": 0
    },
    "SCN019": {
        "name": "Product Shortage",
        "demand_type": "EMERGENCY",
        "description": "Critical therapy shortage requiring rapid production increase",
        "default_increase_pct": 100
    },
    "SCN014": {
        "name": "Limited Capacity",
        "demand_type": "CAPACITY_CONSTRAINT",
        "description": "Production line operating at 95% capacity saturation",
        "default_capacity_pct": 95
    },
    "SCN016": {
        "name": "Competing Production",
        "demand_type": "RESOURCE_CONTENTION",
        "description": "Multiple products competing for shared production line capacity",
        "default_contention_pct": 30
    },
    "SCN020": {
        "name": "High Volatility",
        "demand_type": "VOLATILITY",
        "description": "Network-wide demand volatility with unpredictable order patterns",
        "default_volatility_pct": 40
    }
}



def parse_config(config_str, scenario_type="standard"):
    """
    Parse scenario configuration string.

    Args:
        config_str: Comma-separated config
        scenario_type: "standard" (material,plant,sloc,qty),
                      "transfer" (material,plant,from_sloc,to_sloc,qty),
                      "fire" (plant,sloc,fire_date,downtime_days),
                      "shutdown" (plant,shutdown_date,downtime_days),
                      "quarantine_single" (material,plant,sloc,batch,qty,quarantine_days),
                      "quarantine_all" (material,quarantine_days)

    Returns:
        Dict with parsed config or None if invalid
    """
    if not config_str.strip():
        return None

    parts = [p.strip() for p in config_str.split(',')]

    if scenario_type == "transfer":
        if len(parts) != 5:
            print(f"Warning: Transfer config requires 5 parts (material,plant,from_sloc,to_sloc,qty), got {len(parts)}")
            return None
        return {
            "material": parts[0],
            "plant": parts[1],
            "from_sloc": parts[2],
            "to_sloc": parts[3],
            "qty": float(parts[4])
        }
    elif scenario_type == "fire":
        if len(parts) != 4:
            print(f"Warning: Fire config requires 4 parts (plant,sloc,fire_date,downtime_days), got {len(parts)}")
            return None
        return {
            "plant": parts[0],
            "sloc": parts[1],
            "fire_date": parts[2],  # YYYYMMDD format
            "downtime_days": int(parts[3])
        }
    elif scenario_type == "shutdown":
        if len(parts) != 3:
            print(f"Warning: Shutdown config requires 3 parts (plant,shutdown_date,downtime_days), got {len(parts)}")
            return None
        return {
            "plant": parts[0],
            "shutdown_date": parts[1],  # YYYYMMDD format
            "downtime_days": int(parts[2])
        }
    elif scenario_type == "quarantine_single":
        if len(parts) != 6:
            print(f"Warning: Quarantine config requires 6 parts (material,plant,sloc,batch,qty,quarantine_days), got {len(parts)}")
            return None
        return {
            "material": parts[0],
            "plant": parts[1],
            "sloc": parts[2],
            "batch": parts[3],
            "qty": float(parts[4]),
            "quarantine_days": int(parts[5])
        }
    elif scenario_type == "quarantine_all":
        if len(parts) != 2:
            print(f"Warning: Quarantine-all config requires 2 parts (material,quarantine_days), got {len(parts)}")
            return None
        return {
            "material": parts[0],
            "quarantine_days": int(parts[1])
        }
    elif scenario_type == "writeoff":
        if len(parts) != 5:
            print(f"Warning: Write-off config requires 5 parts (material,plant,sloc,batch,qty), got {len(parts)}")
            return None
        return {
            "material": parts[0],
            "plant": parts[1],
            "sloc": parts[2],
            "batch": parts[3],
            "qty": float(parts[4])
        }
    elif scenario_type == "reroute":
        if len(parts) != 4:
            print(f"Warning: Reroute config requires 4 parts (plant,sloc,reroute_date,downtime_days), got {len(parts)}")
            return None
        return {
            "plant": parts[0],
            "sloc": parts[1],
            "reroute_date": parts[2],  # YYYYMMDD format
            "downtime_days": int(parts[3])
        }
    else:  # standard
        if len(parts) != 4:
            print(f"Warning: Config requires 4 parts (material,plant,sloc,qty), got {len(parts)}")
            return None
        return {
            "material": parts[0],
            "plant": parts[1],
            "sloc": parts[2],
            "qty": float(parts[3])
        }


def generate_doc_number():
    """Generate a unique document number."""
    return f"{random.randint(5000000000, 5999999999):010d}"


def inject_scenario(scenario_id, config, scenario_def, is_transfer=False):
    """
    Create MATDOC record(s) for a scenario injection.

    Args:
        scenario_id: SCN001, SCN002, etc.
        config: Parsed configuration dict
        scenario_def: Scenario definition from SCENARIO_DEFINITIONS
        is_transfer: If True, creates transfer posting (two records)

    Returns:
        List of MATDOC record dicts
    """
    records = []
    doc_num = f"{scenario_id}_{generate_doc_number()}"
    posting_date = datetime.now().strftime('%Y%m%d')

    base_record = {
        'MANDT': '800',
        'MBLNR': doc_num,
        'MJAHR': str(datetime.now().year),
        'ZEILE': '0001',
        'BWART': scenario_def['mvmt_type'],
        'MATNR': config['material'],
        'WERKS': config['plant'],
        'LGORT': config.get('sloc', config.get('from_sloc', 'FG01')),
        'UMLGO': '',
        'SHKZG': scenario_def['shkzg'],
        'MENGE': config['qty'],
        'MEINS': 'PC',
        'BUDAT': posting_date,
        'CPUDT': posting_date,
        'BKTXT': f"{scenario_id}: {scenario_def['description']}",
    }

    if is_transfer:

        source_record = base_record.copy()
        source_record['ZEILE'] = '0001'
        source_record['LGORT'] = config['from_sloc']
        source_record['UMLGO'] = config['to_sloc']
        source_record['SHKZG'] = 'H'  # Decrease at source
        records.append(source_record)

        dest_record = base_record.copy()
        dest_record['ZEILE'] = '0002'
        dest_record['LGORT'] = config['to_sloc']
        dest_record['UMLGO'] = config['from_sloc']
        dest_record['SHKZG'] = 'S'  # Increase at destination
        records.append(dest_record)
    else:
        records.append(base_record)

    return records


def inject_fire_scenario(config, df_mard, df_matdoc):
    """
    Inject fire scenario that affects ALL products at a location.

    This scenario:
    1. Scraps ALL inventory at the specified plant/storage location(s)
    2. Blocks all receipts and issues during the downtime period

    Args:
        config: Dict with plant, sloc (or "ALL"), fire_date (YYYYMMDD), downtime_days
        df_mard: MARD inventory DataFrame
        df_matdoc: MATDOC DataFrame

    Returns:
        Tuple of (scrap_records, blocked_doc_ids, recovery_date)
    """
    plant = config['plant']
    sloc = config['sloc']
    fire_date_str = config['fire_date']
    downtime_days = config['downtime_days']

    affect_all_slocs = sloc.upper() == 'ALL'

    fire_date = datetime.strptime(fire_date_str, '%Y%m%d')
    recovery_date = fire_date + timedelta(days=downtime_days)

    sloc_display = "ALL storage locations" if affect_all_slocs else f"Storage Location {sloc}"
    print(f"\n  Fire Scenario Details:")
    print(f"    Location: Plant {plant}, {sloc_display}")
    print(f"    Fire Date: {fire_date_str}")
    print(f"    Downtime: {downtime_days} days")
    print(f"    Recovery Date: {recovery_date.strftime('%Y%m%d')}")

    scrap_records = []
    blocked_doc_ids = []

    if affect_all_slocs:
        location_stock = df_mard[
            (df_mard['WERKS'] == plant) &
            (pd.to_numeric(df_mard['LABST'], errors='coerce').fillna(0) > 0)
        ]
    else:
        location_stock = df_mard[
            (df_mard['WERKS'] == plant) &
            (df_mard['LGORT'] == sloc) &
            (pd.to_numeric(df_mard['LABST'], errors='coerce').fillna(0) > 0)
        ]

    affected_slocs = location_stock['LGORT'].unique().tolist() if len(location_stock) > 0 else []
    print(f"    Storage locations affected: {affected_slocs if affected_slocs else 'None'}")
    print(f"    Materials at location: {len(location_stock)}")

    line_num = 1
    total_scrapped = 0
    for _, row in location_stock.iterrows():
        matnr = row['MATNR']
        row_sloc = row['LGORT']  # Use actual storage location from MARD
        qty = float(row['LABST'])

        if qty > 0:
            scrap_records.append({
                'MANDT': '800',
                'MBLNR': f"SCN003_{generate_doc_number()}",
                'MJAHR': str(fire_date.year),
                'ZEILE': f'{line_num:04d}',
                'BWART': '551',  # Scrapping
                'MATNR': matnr,
                'WERKS': plant,
                'LGORT': row_sloc,
                'UMLGO': '',
                'SHKZG': 'H',  # Decrease stock
                'MENGE': qty,
                'MEINS': 'PC',
                'BUDAT': fire_date_str,
                'CPUDT': fire_date_str,
                'BKTXT': f"SCN003: Fire damage - complete loss at {plant}/{row_sloc}",
            })
            line_num += 1
            total_scrapped += qty

    print(f"    Total quantity scrapped: {total_scrapped:,.0f} units across {len(scrap_records)} materials")

    df_matdoc_copy = df_matdoc.copy()
    df_matdoc_copy['BUDAT_DT'] = pd.to_datetime(df_matdoc_copy['BUDAT'], format='%Y%m%d', errors='coerce')

    blocked_mvmt_types = ['101', '102', '601', '261', '311']

    if affect_all_slocs:
        block_mask = (
            (df_matdoc_copy['WERKS'] == plant) &
            (df_matdoc_copy['BUDAT_DT'] >= fire_date) &
            (df_matdoc_copy['BUDAT_DT'] < recovery_date) &
            (df_matdoc_copy['BWART'].isin(blocked_mvmt_types))
        )
    else:
        block_mask = (
            (df_matdoc_copy['WERKS'] == plant) &
            (df_matdoc_copy['LGORT'] == sloc) &
            (df_matdoc_copy['BUDAT_DT'] >= fire_date) &
            (df_matdoc_copy['BUDAT_DT'] < recovery_date) &
            (df_matdoc_copy['BWART'].isin(blocked_mvmt_types))
        )

    blocked_docs = df_matdoc_copy[block_mask]
    blocked_doc_ids = blocked_docs['MBLNR'].unique().tolist()

    print(f"    Blocked transactions during downtime: {len(blocked_doc_ids)}")

    return scrap_records, blocked_doc_ids, recovery_date


def inject_shutdown_scenario(scenario_id, config, df_matdoc, capacity_pct=0):
    """
    Inject production shutdown scenario (no material movement, just node offline).

    This scenario:
    1. Marks the node as offline (no inventory is moved)
    2. Blocks transactions during downtime period
    3. Returns metadata for the scenario_metadata table

    Args:
        scenario_id: SCN004 or SCN010
        config: Dict with plant, shutdown_date (YYYYMMDD), downtime_days
        df_matdoc: MATDOC DataFrame
        capacity_pct: Remaining capacity (0 for full shutdown, 50 for SCN010)

    Returns:
        Tuple of (blocked_doc_ids, recovery_date, metadata_dict)
    """
    plant = config['plant']
    shutdown_date_str = config['shutdown_date']
    downtime_days = config['downtime_days']

    shutdown_date = datetime.strptime(shutdown_date_str, '%Y%m%d')
    recovery_date = shutdown_date + timedelta(days=downtime_days)

    scenario_name = "Production Shutdown" if capacity_pct == 0 else f"Partial Shutdown ({capacity_pct}%)"
    print(f"\n  {scenario_name} Scenario Details:")
    print(f"    Location: Plant {plant}")
    print(f"    Shutdown Date: {shutdown_date_str}")
    print(f"    Downtime: {downtime_days} days")
    print(f"    Recovery Date: {recovery_date.strftime('%Y%m%d')}")
    print(f"    Remaining Capacity: {capacity_pct}%")

    blocked_doc_ids = []

    df_matdoc_copy = df_matdoc.copy()
    df_matdoc_copy['BUDAT_DT'] = pd.to_datetime(df_matdoc_copy['BUDAT'], format='%Y%m%d', errors='coerce')

    if capacity_pct == 0:
        blocked_mvmt_types = ['101', '102', '601', '261', '311']
        block_mask = (
            (df_matdoc_copy['WERKS'] == plant) &
            (df_matdoc_copy['BUDAT_DT'] >= shutdown_date) &
            (df_matdoc_copy['BUDAT_DT'] < recovery_date) &
            (df_matdoc_copy['BWART'].isin(blocked_mvmt_types))
        )
        blocked_docs = df_matdoc_copy[block_mask]
        blocked_doc_ids = blocked_docs['MBLNR'].unique().tolist()
        print(f"    Blocked transactions during downtime: {len(blocked_doc_ids)}")
    else:
        print(f"    Partial shutdown - no transactions blocked (reduced capacity only)")

    return blocked_doc_ids, recovery_date


def inject_quarantine_scenario(scenario_id, config, df_mard, is_all_locations=False):
    """
    Inject quarantine scenario - moves stock to QA01 storage location.

    This scenario:
    1. Creates 311 transfer posting from source sloc to QA01
    2. Stock is not usable until release date

    Args:
        scenario_id: SCN005 or SCN006
        config: Parsed configuration dict
        df_mard: MARD inventory DataFrame
        is_all_locations: If True, affects all plants (SCN006)

    Returns:
        Tuple of (transfer_records, recovery_date)
    """
    material = config['material']
    quarantine_days = config['quarantine_days']
    quarantine_date = datetime.now()
    release_date = quarantine_date + timedelta(days=quarantine_days)

    transfer_records = []
    total_qty_quarantined = 0

    if is_all_locations:
        print(f"\n  Quarantine Scenario (All Locations) Details:")
        print(f"    Material: {material}")
        print(f"    Quarantine Date: {quarantine_date.strftime('%Y%m%d')}")
        print(f"    Quarantine Duration: {quarantine_days} days")
        print(f"    Release Date: {release_date.strftime('%Y%m%d')}")

        material_stock = df_mard[
            (df_mard['MATNR'] == material) &
            (df_mard['LGORT'] != 'QA01') &  # Not already in quarantine
            (pd.to_numeric(df_mard['LABST'], errors='coerce').fillna(0) > 0)
        ]

        print(f"    Locations with stock: {len(material_stock)}")

        line_num = 1
        for _, row in material_stock.iterrows():
            werks = row['WERKS']
            lgort = row['LGORT']
            qty = float(row['LABST'])

            if qty > 0:
                doc_num = f"{scenario_id}_{generate_doc_number()}"
                posting_date = quarantine_date.strftime('%Y%m%d')

                transfer_records.append({
                    'MANDT': '800',
                    'MBLNR': doc_num,
                    'MJAHR': str(quarantine_date.year),
                    'ZEILE': f'{line_num:04d}',
                    'BWART': '311',
                    'MATNR': material,
                    'WERKS': werks,
                    'LGORT': lgort,
                    'UMLGO': 'QA01',
                    'SHKZG': 'H',  # Decrease at source
                    'MENGE': qty,
                    'MEINS': 'PC',
                    'BUDAT': posting_date,
                    'CPUDT': posting_date,
                    'BKTXT': f"{scenario_id}: Quarantine transfer - pending release {release_date.strftime('%Y%m%d')}",
                })
                line_num += 1

                transfer_records.append({
                    'MANDT': '800',
                    'MBLNR': doc_num,
                    'MJAHR': str(quarantine_date.year),
                    'ZEILE': f'{line_num:04d}',
                    'BWART': '311',
                    'MATNR': material,
                    'WERKS': werks,
                    'LGORT': 'QA01',
                    'UMLGO': lgort,
                    'SHKZG': 'S',  # Increase at destination
                    'MENGE': qty,
                    'MEINS': 'PC',
                    'BUDAT': posting_date,
                    'CPUDT': posting_date,
                    'BKTXT': f"{scenario_id}: Quarantine transfer - pending release {release_date.strftime('%Y%m%d')}",
                })
                line_num += 1
                total_qty_quarantined += qty

    else:
        plant = config['plant']
        sloc = config['sloc']
        batch = config['batch']
        qty = config['qty']

        print(f"\n  Quarantine Scenario (Single Batch) Details:")
        print(f"    Material: {material}")
        print(f"    Plant: {plant}")
        print(f"    Storage Location: {sloc}")
        print(f"    Batch: {batch}")
        print(f"    Quantity: {qty}")
        print(f"    Quarantine Date: {quarantine_date.strftime('%Y%m%d')}")
        print(f"    Quarantine Duration: {quarantine_days} days")
        print(f"    Release Date: {release_date.strftime('%Y%m%d')}")

        doc_num = f"{scenario_id}_{generate_doc_number()}"
        posting_date = quarantine_date.strftime('%Y%m%d')

        transfer_records.append({
            'MANDT': '800',
            'MBLNR': doc_num,
            'MJAHR': str(quarantine_date.year),
            'ZEILE': '0001',
            'BWART': '311',
            'MATNR': material,
            'WERKS': plant,
            'LGORT': sloc,
            'UMLGO': 'QA01',
            'CHARG': batch,
            'SHKZG': 'H',  # Decrease at source
            'MENGE': qty,
            'MEINS': 'PC',
            'BUDAT': posting_date,
            'CPUDT': posting_date,
            'BKTXT': f"{scenario_id}: Batch {batch} quarantine - release {release_date.strftime('%Y%m%d')}",
        })

        transfer_records.append({
            'MANDT': '800',
            'MBLNR': doc_num,
            'MJAHR': str(quarantine_date.year),
            'ZEILE': '0002',
            'BWART': '311',
            'MATNR': material,
            'WERKS': plant,
            'LGORT': 'QA01',
            'UMLGO': sloc,
            'CHARG': batch,
            'SHKZG': 'S',  # Increase at destination
            'MENGE': qty,
            'MEINS': 'PC',
            'BUDAT': posting_date,
            'CPUDT': posting_date,
            'BKTXT': f"{scenario_id}: Batch {batch} quarantine - release {release_date.strftime('%Y%m%d')}",
        })
        total_qty_quarantined = qty

    print(f"    Total quantity quarantined: {total_qty_quarantined:,.0f} units")
    print(f"    Transfer records created: {len(transfer_records)}")

    return transfer_records, release_date


def inject_temperature_scenario(config, df_mard):
    """
    Inject temperature issue scenario that destroys ALL inventory at a location.

    This scenario scraps all stock at the affected location (similar to fire
    but without node offline status).

    Args:
        config: Dict with material (can be "ALL"), plant, from_sloc, to_sloc (ignored), qty (ignored)
        df_mard: MARD inventory DataFrame

    Returns:
        List of scrap MATDOC records
    """
    plant = config['plant']
    sloc = config.get('from_sloc', 'FG01')

    print(f"\n  Temperature Issue Scenario Details:")
    print(f"    Location: Plant {plant}, Storage Location {sloc}")

    scrap_records = []

    location_stock = df_mard[
        (df_mard['WERKS'] == plant) &
        (df_mard['LGORT'] == sloc) &
        (pd.to_numeric(df_mard['LABST'], errors='coerce').fillna(0) > 0)
    ]

    print(f"    Materials at location: {len(location_stock)}")

    total_scrapped = 0
    posting_date = datetime.now().strftime('%Y%m%d')

    for idx, row in location_stock.iterrows():
        matnr = row['MATNR']
        qty = float(row['LABST'])

        if qty > 0:
            scrap_records.append({
                'MANDT': '800',
                'MBLNR': f"SCN008_{generate_doc_number()}",
                'MJAHR': str(datetime.now().year),
                'ZEILE': f'{len(scrap_records)+1:04d}',
                'BWART': '551',  # Scrapping
                'MATNR': matnr,
                'WERKS': plant,
                'LGORT': sloc,
                'UMLGO': '',
                'SHKZG': 'H',  # Decrease stock
                'MENGE': qty,
                'MEINS': 'PC',
                'BUDAT': posting_date,
                'CPUDT': posting_date,
                'BKTXT': f"SCN008: Temperature damage - complete loss at {plant}/{sloc}",
            })
            total_scrapped += qty

    print(f"    Total quantity scrapped: {total_scrapped:,.0f} units across {len(scrap_records)} materials")

    return scrap_records


def inject_reroute_scenario(config, df_mard, df_matdoc):
    """
    Inject re-route scenario - warehouse goes offline and all inventory is quarantined.

    This scenario:
    1. Transfers ALL inventory at the location to QA01 (quarantine)
    2. Marks the node as offline
    3. Blocks transactions during downtime period

    Args:
        config: Dict with plant, sloc, reroute_date (YYYYMMDD), downtime_days
        df_mard: MARD inventory DataFrame
        df_matdoc: MATDOC DataFrame

    Returns:
        Tuple of (transfer_records, blocked_doc_ids, recovery_date)
    """
    plant = config['plant']
    sloc = config.get('sloc', 'ALL')
    reroute_date_str = config.get('reroute_date', datetime.now().strftime('%Y%m%d'))
    downtime_days = config.get('downtime_days', 14)

    affect_all_slocs = sloc.upper() == 'ALL'

    reroute_date = datetime.strptime(reroute_date_str, '%Y%m%d')
    recovery_date = reroute_date + timedelta(days=downtime_days)

    sloc_display = "ALL storage locations" if affect_all_slocs else f"Storage Location {sloc}"
    print(f"\n  Re-route Scenario Details:")
    print(f"    Location: Plant {plant}, {sloc_display}")
    print(f"    Reroute Date: {reroute_date_str}")
    print(f"    Downtime: {downtime_days} days")
    print(f"    Recovery Date: {recovery_date.strftime('%Y%m%d')}")

    transfer_records = []
    blocked_doc_ids = []

    if affect_all_slocs:
        location_stock = df_mard[
            (df_mard['WERKS'] == plant) &
            (df_mard['LGORT'] != 'QA01') &  # Not already in quarantine
            (pd.to_numeric(df_mard['LABST'], errors='coerce').fillna(0) > 0)
        ]
    else:
        location_stock = df_mard[
            (df_mard['WERKS'] == plant) &
            (df_mard['LGORT'] == sloc) &
            (pd.to_numeric(df_mard['LABST'], errors='coerce').fillna(0) > 0)
        ]

    affected_slocs = location_stock['LGORT'].unique().tolist() if len(location_stock) > 0 else []
    print(f"    Storage locations affected: {affected_slocs if affected_slocs else 'None'}")
    print(f"    Materials at location: {len(location_stock)}")

    total_quarantined = 0
    line_num = 1

    for _, row in location_stock.iterrows():
        matnr = row['MATNR']
        row_sloc = row['LGORT']
        qty = float(row['LABST'])

        if qty > 0:
            doc_num = f"SCN009_{generate_doc_number()}"
            posting_date = reroute_date_str

            transfer_records.append({
                'MANDT': '800',
                'MBLNR': doc_num,
                'MJAHR': str(reroute_date.year),
                'ZEILE': f'{line_num:04d}',
                'BWART': '311',
                'MATNR': matnr,
                'WERKS': plant,
                'LGORT': row_sloc,
                'UMLGO': 'QA01',
                'SHKZG': 'H',  # Decrease at source
                'MENGE': qty,
                'MEINS': 'PC',
                'BUDAT': posting_date,
                'CPUDT': posting_date,
                'BKTXT': f"SCN009: Warehouse offline - quarantine until {recovery_date.strftime('%Y%m%d')}",
            })
            line_num += 1

            transfer_records.append({
                'MANDT': '800',
                'MBLNR': doc_num,
                'MJAHR': str(reroute_date.year),
                'ZEILE': f'{line_num:04d}',
                'BWART': '311',
                'MATNR': matnr,
                'WERKS': plant,
                'LGORT': 'QA01',
                'UMLGO': row_sloc,
                'SHKZG': 'S',  # Increase at destination
                'MENGE': qty,
                'MEINS': 'PC',
                'BUDAT': posting_date,
                'CPUDT': posting_date,
                'BKTXT': f"SCN009: Warehouse offline - quarantine until {recovery_date.strftime('%Y%m%d')}",
            })
            line_num += 1
            total_quarantined += qty

    print(f"    Total quantity quarantined: {total_quarantined:,.0f} units")

    df_matdoc_copy = df_matdoc.copy()
    df_matdoc_copy['BUDAT_DT'] = pd.to_datetime(df_matdoc_copy['BUDAT'], format='%Y%m%d', errors='coerce')

    blocked_mvmt_types = ['101', '102', '601', '261', '311']

    if affect_all_slocs:
        block_mask = (
            (df_matdoc_copy['WERKS'] == plant) &
            (df_matdoc_copy['BUDAT_DT'] >= reroute_date) &
            (df_matdoc_copy['BUDAT_DT'] < recovery_date) &
            (df_matdoc_copy['BWART'].isin(blocked_mvmt_types))
        )
    else:
        block_mask = (
            (df_matdoc_copy['WERKS'] == plant) &
            (df_matdoc_copy['LGORT'] == sloc) &
            (df_matdoc_copy['BUDAT_DT'] >= reroute_date) &
            (df_matdoc_copy['BUDAT_DT'] < recovery_date) &
            (df_matdoc_copy['BWART'].isin(blocked_mvmt_types))
        )

    blocked_docs = df_matdoc_copy[block_mask]
    blocked_doc_ids = blocked_docs['MBLNR'].unique().tolist()

    print(f"    Blocked transactions during downtime: {len(blocked_doc_ids)}")

    return transfer_records, blocked_doc_ids, recovery_date, total_quarantined


def update_mard_for_scenario(df_mard, matdoc_records):
    """Apply scenario MATDOC quantities to MARD stock levels."""
    df_mard = df_mard.copy()

    for record in matdoc_records:
        matnr = record['MATNR']
        werks = record['WERKS']
        lgort = record['LGORT']
        qty = float(record['MENGE'])
        shkzg = record['SHKZG']

        mask = (df_mard['MATNR'] == matnr) & (df_mard['WERKS'] == werks) & (df_mard['LGORT'] == lgort)

        if mask.any():
            if shkzg == 'S':
                df_mard.loc[mask, 'LABST'] = df_mard.loc[mask, 'LABST'].astype(float) + qty
            else:
                df_mard.loc[mask, 'LABST'] = df_mard.loc[mask, 'LABST'].astype(float) - qty
                df_mard.loc[mask, 'LABST'] = df_mard.loc[mask, 'LABST'].clip(lower=0)
        else:
            print(f"Warning: No MARD record found for {matnr}/{werks}/{lgort}")

    return df_mard


def adjust_goods_issues_for_scenario(df_matdoc, scenario_records, df_mard, df_lips=None, df_likp=None, df_vbfa=None):
    """Keep inventory nonnegative after scenario records reduce stock.

    The function reduces or removes movement 601 records and applies the same
    changes to LIPS, LIKP, and VBFA.
    """
    df_matdoc = df_matdoc.copy()
    if df_lips is not None:
        df_lips = df_lips.copy()
    if df_likp is not None:
        df_likp = df_likp.copy()
    if df_vbfa is not None:
        df_vbfa = df_vbfa.copy()

    reducing_scenarios = [r for r in scenario_records if r['SHKZG'] == 'H']

    if not reducing_scenarios:
        return df_matdoc, df_lips, df_likp, df_vbfa

    print(f"  Checking {len(reducing_scenarios)} inventory-reducing scenarios for 601 adjustment...")

    total_removed = 0
    total_reduced = 0
    removed_deliveries = []  # Track (delivery_vbeln, matnr) pairs for cascade
    reduced_deliveries = []  # Track (delivery_vbeln, matnr, new_qty) for cascade

    for scenario in reducing_scenarios:
        matnr = scenario['MATNR']
        werks = scenario['WERKS']
        lgort = scenario['LGORT']
        scenario_date = scenario['BUDAT']
        scenario_id = scenario['MBLNR'].split('_')[0]  # e.g., "SCN001"

        mard_mask = (df_mard['MATNR'] == matnr) & (df_mard['WERKS'] == werks) & (df_mard['LGORT'] == lgort)
        if not mard_mask.any():
            continue

        current_stock = float(df_mard.loc[mard_mask, 'LABST'].iloc[0])

        issue_mask = (
            (df_matdoc['BWART'] == '601') &
            (df_matdoc['MATNR'] == matnr) &
            (df_matdoc['WERKS'] == werks) &
            (df_matdoc['LGORT'] == lgort) &
            (df_matdoc['BUDAT'] >= scenario_date) &
            (~df_matdoc['MBLNR'].str.startswith('SCN'))  # Don't touch scenario records
        )

        if not issue_mask.any():
            continue

        future_issues = df_matdoc[issue_mask].sort_values('BUDAT').copy()

        receipt_mask = (
            (df_matdoc['BWART'].isin(['101', '311'])) &
            (df_matdoc['SHKZG'] == 'S') &
            (df_matdoc['MATNR'] == matnr) &
            (df_matdoc['WERKS'] == werks) &
            (df_matdoc['LGORT'] == lgort) &
            (df_matdoc['BUDAT'] >= scenario_date)
        )
        future_receipts = df_matdoc[receipt_mask].copy() if receipt_mask.any() else pd.DataFrame()

        simulated_stock = current_stock
        indices_to_remove = []
        indices_to_reduce = {}

        all_movements = pd.concat([
            future_issues.assign(is_issue=True),
            future_receipts.assign(is_issue=False) if len(future_receipts) > 0 else pd.DataFrame()
        ]).sort_values('BUDAT')

        for idx, row in all_movements.iterrows():
            qty = float(row['MENGE'])

            if row.get('is_issue', False):
                if simulated_stock <= 0:
                    indices_to_remove.append(idx)
                    total_removed += 1
                    if 'XBLNR' in row and row['XBLNR']:
                        removed_deliveries.append((row['XBLNR'], row['MATNR']))
                elif qty > simulated_stock:
                    indices_to_reduce[idx] = simulated_stock
                    simulated_stock = 0
                    total_reduced += 1
                    if 'XBLNR' in row and row['XBLNR']:
                        reduced_deliveries.append((row['XBLNR'], row['MATNR'], simulated_stock))
                else:
                    simulated_stock -= qty
            else:
                simulated_stock += qty

        if indices_to_remove:
            df_matdoc = df_matdoc.drop(indices_to_remove)

        for idx, new_qty in indices_to_reduce.items():
            if idx in df_matdoc.index:
                df_matdoc.loc[idx, 'MENGE'] = new_qty

        if indices_to_remove or indices_to_reduce:
            print(f"    {scenario_id}: {matnr}/{werks}/{lgort} - removed {len(indices_to_remove)}, reduced {len(indices_to_reduce)} goods issues")

    print(f"  Total: {total_removed} removed, {total_reduced} reduced to prevent negative inventory")

    if (removed_deliveries or reduced_deliveries) and df_lips is not None:
        print("  Cascading changes to LIPS, LIKP, VBFA...")

        for delivery_vbeln, matnr in removed_deliveries:
            lips_mask = (df_lips['VBELN'] == delivery_vbeln) & (df_lips['MATNR'] == matnr)
            df_lips = df_lips[~lips_mask]

        for delivery_vbeln, matnr, new_qty in reduced_deliveries:
            lips_mask = (df_lips['VBELN'] == delivery_vbeln) & (df_lips['MATNR'] == matnr)
            if lips_mask.any():
                df_lips.loc[lips_mask, 'LFIMG'] = new_qty

        if df_likp is not None and len(df_lips) > 0:
            deliveries_with_items = set(df_lips['VBELN'].unique())
            original_likp_count = len(df_likp)
            df_likp = df_likp[df_likp['VBELN'].isin(deliveries_with_items)]
            removed_headers = original_likp_count - len(df_likp)
            if removed_headers > 0:
                print(f"    Removed {removed_headers} empty delivery headers from LIKP")

        if df_vbfa is not None:
            for delivery_vbeln, matnr in removed_deliveries:
                vbfa_mask = (df_vbfa['VBELN_N'] == delivery_vbeln)
                df_vbfa = df_vbfa[~vbfa_mask]

            for delivery_vbeln, matnr, new_qty in reduced_deliveries:
                vbfa_mask = (df_vbfa['VBELN_N'] == delivery_vbeln)
                if vbfa_mask.any():
                    df_vbfa.loc[vbfa_mask, 'RFMNG'] = new_qty

        print(f"    Removed {len(removed_deliveries)} delivery items from LIPS")

    return df_matdoc, df_lips, df_likp, df_vbfa


def generate_mardh(df_matdoc, df_mard_initial):
    """
    Generate MARDH (Historical Stock) table from MATDOC movements.

    Calculates period-end stock positions by:
    1. Starting with initial MARD stock
    2. Applying all MATDOC movements chronologically
    3. Recording stock snapshots at each month-end
    """
    print("Regenerating MARDH (Historical Stock)...")

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
        lambda r: float(r['MENGE']) if r['SHKZG'] == 'S' else -float(r['MENGE']), axis=1
    )

    df_movements['LGORT'] = df_movements['LGORT'].fillna('FG01')

    movement_agg = df_movements.groupby(
        ['MATNR', 'WERKS', 'LGORT', 'LFGJA', 'LFMON']
    )['STOCK_CHANGE'].sum().reset_index()

    initial_stock = df_mard_initial[['MATNR', 'WERKS', 'LGORT', 'LABST']].copy()
    initial_stock['LABST'] = pd.to_numeric(initial_stock['LABST'], errors='coerce').fillna(0)

    all_keys = movement_agg[['MATNR', 'WERKS', 'LGORT']].drop_duplicates()
    all_periods = movement_agg[['LFGJA', 'LFMON']].drop_duplicates().sort_values(['LFGJA', 'LFMON'])

    mardh_records = []

    for _, key in all_keys.iterrows():
        matnr, werks, lgort = key['MATNR'], key['WERKS'], key['LGORT']

        init_row = initial_stock[
            (initial_stock['MATNR'] == matnr) &
            (initial_stock['WERKS'] == werks) &
            (initial_stock['LGORT'] == lgort)
        ]
        running_stock = float(init_row['LABST'].values[0]) if len(init_row) > 0 else 0

        key_movements = movement_agg[
            (movement_agg['MATNR'] == matnr) &
            (movement_agg['WERKS'] == werks) &
            (movement_agg['LGORT'] == lgort)
        ].sort_values(['LFGJA', 'LFMON'])

        for _, period in all_periods.iterrows():
            year, month = int(period['LFGJA']), int(period['LFMON'])

            period_movement = key_movements[
                (key_movements['LFGJA'] == year) &
                (key_movements['LFMON'] == month)
            ]

            if len(period_movement) > 0:
                running_stock += float(period_movement['STOCK_CHANGE'].values[0])

            running_stock = max(0, running_stock)

            mardh_records.append({
                'MANDT': '800',
                'MATNR': matnr,
                'WERKS': werks,
                'LGORT': lgort,
                'LFGJA': str(year),
                'LFMON': f'{month:02d}',
                'LABST': running_stock,
                'INSME': 0,
                'SPEME': 0,
                'EINME': 0,
                'RETME': 0,
                'UMLME': 0
            })

    print(f"Regenerated {len(mardh_records)} MARDH records for {len(all_keys)} material-plant-sloc combinations")
    return pd.DataFrame(mardh_records)


def parse_supplier_config(config_str, scenario_type="standard"):
    """
    Parse supplier scenario configuration string.

    Args:
        config_str: Comma-separated config
        scenario_type: "standard" (vendor,material,target_otif,months) or "fda" (vendor,material)

    Returns:
        Dict with parsed config or None if invalid
    """
    if not config_str.strip():
        return None

    parts = [p.strip() for p in config_str.split(',')]

    if scenario_type == "fda":
        if len(parts) < 2:
            print(f"Warning: FDA config requires at least 2 parts (vendor,material), got {len(parts)}")
            return None
        return {
            "vendor": parts[0],
            "material": parts[1],
            "target_otif": 0.95,  # No OTIF impact
            "months_affected": 3
        }
    else:  # standard
        if len(parts) != 4:
            print(f"Warning: Supplier config requires 4 parts (vendor,material,target_otif,months), got {len(parts)}")
            return None
        return {
            "vendor": parts[0],
            "material": parts[1],
            "target_otif": float(parts[2]),
            "months_affected": int(parts[3])
        }


def parse_production_config(config_str, scenario_type="demand_increase"):
    """
    Parse production scenario configuration string.

    Args:
        config_str: Comma-separated config
        scenario_type: "demand_increase" (material,plant,increase_pct,start_date),
                      "expedition" (material,plant,qty,due_date),
                      "shortage" (material,plant,increase_pct,duration_days)

    Returns:
        Dict with parsed config or None if invalid
    """
    if not config_str.strip():
        return None

    parts = [p.strip() for p in config_str.split(',')]

    if scenario_type == "demand_increase":
        if len(parts) != 4:
            print(f"Warning: Demand increase config requires 4 parts (material,plant,increase_pct,start_date), got {len(parts)}")
            return None
        return {
            "material": parts[0],
            "plant": parts[1],
            "increase_pct": int(parts[2]),
            "start_date": parts[3]
        }
    elif scenario_type == "expedition":
        if len(parts) != 4:
            print(f"Warning: Expedition config requires 4 parts (material,plant,qty,due_date), got {len(parts)}")
            return None
        return {
            "material": parts[0],
            "plant": parts[1],
            "qty": float(parts[2]),
            "due_date": parts[3]
        }
    elif scenario_type == "shortage":
        if len(parts) != 4:
            print(f"Warning: Shortage config requires 4 parts (material,plant,increase_pct,duration_days), got {len(parts)}")
            return None
        return {
            "material": parts[0],
            "plant": parts[1],
            "increase_pct": int(parts[2]),
            "duration_days": int(parts[3])
        }
    elif scenario_type == "new_product":
        if len(parts) != 3:
            print(f"Warning: New product config requires 3 parts (new_material,plant,base_material), got {len(parts)}")
            return None
        return {
            "new_material": parts[0],
            "plant": parts[1],
            "base_material": parts[2]
        }
    elif scenario_type == "equipment_failure":
        if len(parts) != 4:
            print(f"Warning: Equipment failure config requires 4 parts (plant,failure_date,downtime_days,cancel_ratio), got {len(parts)}")
            return None
        return {
            "plant": parts[0],
            "failure_date": parts[1],
            "downtime_days": int(parts[2]),
            "cancel_ratio": float(parts[3])
        }
    elif scenario_type == "regulatory_freeze":
        if len(parts) != 3:
            print(f"Warning: Regulatory freeze config requires 3 parts (plant,start_date,freeze_days), got {len(parts)}")
            return None
        return {
            "plant": parts[0],
            "start_date": parts[1],
            "freeze_days": int(parts[2])
        }
    elif scenario_type == "new_facility":
        if len(parts) != 3:
            print(f"Warning: New facility config requires 3 parts (new_plant,ramp_start,ramp_weeks), got {len(parts)}")
            return None
        return {
            "new_plant": parts[0],
            "ramp_start": parts[1],
            "ramp_weeks": int(parts[2])
        }
    elif scenario_type == "limited_capacity":
        if len(parts) != 3:
            print(f"Warning: Limited capacity config requires 3 parts (plant,capacity_pct,duration_days), got {len(parts)}")
            return None
        return {
            "plant": parts[0],
            "capacity_pct": int(parts[1]),
            "duration_days": int(parts[2])
        }
    elif scenario_type == "competing_production":
        if len(parts) != 3:
            print(f"Warning: Competing production config requires 3 parts (plant,materials,contention_pct), got {len(parts)}")
            return None
        return {
            "plant": parts[0],
            "materials": [m.strip() for m in parts[1].split(';')],
            "contention_pct": int(parts[2])
        }
    elif scenario_type == "high_volatility":
        if len(parts) != 2:
            print(f"Warning: High volatility config requires 2 parts (volatility_pct,duration_days), got {len(parts)}")
            return None
        return {
            "volatility_pct": int(parts[0]),
            "duration_days": int(parts[1])
        }
    return None


def inject_demand_increase(scenario_id, config, df_vbak, df_vbap, df_vbep, df_kna1):
    """
    Inject increased demand by adding new sales orders for a specific product/plant.

    Creates new VBAK/VBAP/VBEP records that represent increased demand starting
    from the specified date.

    Args:
        scenario_id: Scenario identifier (e.g., "SCN011")
        config: Dict with material, plant, increase_pct, start_date
        df_vbak: Existing sales order headers
        df_vbap: Existing sales order items
        df_vbep: Existing schedule lines
        df_kna1: Customer master for selecting customers

    Returns:
        Tuple of (new_vbak_records, new_vbap_records, new_vbep_records)
    """
    material = config['material']
    plant = config['plant']
    increase_pct = config['increase_pct']
    start_date_str = config['start_date']

    print(f"\n  Injecting {scenario_id} (Demand Increase):")
    print(f"    Material: {material}")
    print(f"    Plant: {plant}")
    print(f"    Increase: +{increase_pct}%")
    print(f"    Start Date: {start_date_str}")

    try:
        start_date = datetime.strptime(start_date_str, '%Y%m%d')
    except:
        start_date = datetime.strptime(start_date_str, '%Y-%m-%d')

    if hasattr(df_vbak, 'toPandas'):
        df_vbak = df_vbak.toPandas()
    if hasattr(df_vbap, 'toPandas'):
        df_vbap = df_vbap.toPandas()
    if hasattr(df_kna1, 'toPandas'):
        df_kna1 = df_kna1.toPandas()

    existing_orders = df_vbap[
        (df_vbap['MATNR'] == material) &
        (df_vbap['WERKS'] == plant)
    ]

    if len(existing_orders) == 0:
        print(f"    Warning: No existing orders found for {material} at {plant}")
        baseline_qty = 1000  # Default baseline
        num_baseline_orders = 5
    else:
        baseline_qty = existing_orders['KWMENG'].astype(float).mean()
        num_baseline_orders = len(existing_orders)

    num_new_orders = max(1, int(num_baseline_orders * increase_pct / 100))
    avg_order_qty = baseline_qty

    print(f"    Baseline: {num_baseline_orders} orders, avg qty {baseline_qty:.0f}")
    print(f"    Creating: {num_new_orders} new orders")

    customers = df_kna1['KUNNR'].tolist()

    max_vbeln = int(df_vbak['VBELN'].astype(str).str.replace(r'\D', '', regex=True).astype(float).max())
    next_vbeln = max_vbeln + 1000

    new_vbak = []
    new_vbap = []
    new_vbep = []

    for i in range(num_new_orders):
        vbeln = str(next_vbeln + i)
        order_date = start_date + timedelta(days=random.randint(0, 30))
        delivery_date = order_date + timedelta(days=random.randint(7, 21))
        customer = random.choice(customers)
        qty = round(avg_order_qty * random.uniform(0.8, 1.2))
        net_value = round(qty * random.uniform(50, 150), 2)

        new_vbak.append({
            'MANDT': '800',
            'VBELN': vbeln,
            'ERDAT': order_date.strftime('%Y%m%d'),
            'ERZET': '120000',
            'ERNAM': 'SCENARIO',
            'AUDAT': order_date.strftime('%Y%m%d'),
            'VBTYP': 'C',
            'AUART': 'OR',
            'VKORG': '1000',
            'VTWEG': '10',
            'SPART': '00',
            'KUNNR': customer,
            'NETWR': net_value,
            'VDATU': delivery_date.strftime('%Y%m%d'),
            'WAERK': param('DATASET_CURRENCY'),
            'BSTNK': f'{scenario_id}-{i+1:03d}',
            'LIFSK': '',
            'FAKSK': ''
        })

        new_vbap.append({
            'MANDT': '800',
            'VBELN': vbeln,
            'POSNR': '000010',
            'MATNR': material,
            'WERKS': plant,
            'LGORT': 'FG01',
            'KWMENG': qty,
            'MEINS': 'PC',
            'NETWR': net_value,
            'WAERK': param('DATASET_CURRENCY'),
            'ABGRU': '',
            'PSTYV': 'TAN'
        })

        new_vbep.append({
            'MANDT': '800',
            'VBELN': vbeln,
            'POSNR': '000010',
            'ETENR': '0001',
            'ETTYP': 'BN',
            'EDATU': delivery_date.strftime('%Y%m%d'),
            'WMENG': qty,
            'BMENG': qty,
            'LMENG': 0,
            'MEINS': 'PC'
        })

    print(f"    Created: {len(new_vbak)} orders totaling {sum(r['KWMENG'] for r in new_vbap):.0f} units")

    return new_vbak, new_vbap, new_vbep


def inject_emergency_order(scenario_id, config, df_vbak, df_kna1):
    """
    Inject an emergency order for batch expedition.

    Creates a single urgent sales order with tight delivery timeline.

    Args:
        scenario_id: Scenario identifier (e.g., "SCN013")
        config: Dict with material, plant, qty, due_date
        df_vbak: Existing sales order headers (for order number generation)
        df_kna1: Customer master for selecting customer

    Returns:
        Tuple of (new_vbak_records, new_vbap_records, new_vbep_records)
    """
    material = config['material']
    plant = config['plant']
    qty = config['qty']
    due_date_str = config['due_date']

    print(f"\n  Injecting {scenario_id} (Emergency Order):")
    print(f"    Material: {material}")
    print(f"    Plant: {plant}")
    print(f"    Quantity: {qty}")
    print(f"    Due Date: {due_date_str}")

    try:
        due_date = datetime.strptime(due_date_str, '%Y%m%d')
    except:
        due_date = datetime.strptime(due_date_str, '%Y-%m-%d')

    if hasattr(df_vbak, 'toPandas'):
        df_vbak = df_vbak.toPandas()
    if hasattr(df_kna1, 'toPandas'):
        df_kna1 = df_kna1.toPandas()

    max_vbeln = int(df_vbak['VBELN'].astype(str).str.replace(r'\D', '', regex=True).astype(float).max())
    vbeln = str(max_vbeln + 5000)

    customer = df_kna1['KUNNR'].iloc[0]

    order_date = datetime.now()
    net_value = round(qty * random.uniform(80, 200), 2)

    new_vbak = [{
        'MANDT': '800',
        'VBELN': vbeln,
        'ERDAT': order_date.strftime('%Y%m%d'),
        'ERZET': '120000',
        'ERNAM': 'EMERGENCY',
        'AUDAT': order_date.strftime('%Y%m%d'),
        'VBTYP': 'C',
        'AUART': 'OR',
        'VKORG': '1000',
        'VTWEG': '10',
        'SPART': '00',
        'KUNNR': customer,
        'NETWR': net_value,
        'VDATU': due_date.strftime('%Y%m%d'),
        'WAERK': param('DATASET_CURRENCY'),
        'BSTNK': f'{scenario_id}-URGENT',
        'LIFSK': '',
        'FAKSK': ''
    }]

    new_vbap = [{
        'MANDT': '800',
        'VBELN': vbeln,
        'POSNR': '000010',
        'MATNR': material,
        'WERKS': plant,
        'LGORT': 'FG01',
        'KWMENG': qty,
        'MEINS': 'PC',
        'NETWR': net_value,
        'WAERK': param('DATASET_CURRENCY'),
        'ABGRU': '',
        'PSTYV': 'TAN'
    }]

    new_vbep = [{
        'MANDT': '800',
        'VBELN': vbeln,
        'POSNR': '000010',
        'ETENR': '0001',
        'ETTYP': 'BN',
        'EDATU': due_date.strftime('%Y%m%d'),
        'WMENG': qty,
        'BMENG': qty,
        'LMENG': 0,
        'MEINS': 'PC'
    }]

    print(f"    Created: Emergency order {vbeln} for {qty} units, due {due_date_str}")

    return new_vbak, new_vbap, new_vbep


def inject_shortage_demand(scenario_id, config, df_vbak, df_vbap, df_vbep, df_kna1):
    """
    Inject demand spike for product shortage scenario.

    Creates multiple urgent orders spread over the duration period to simulate
    a critical shortage situation requiring rapid production increase.

    Args:
        scenario_id: Scenario identifier (e.g., "SCN019")
        config: Dict with material, plant, increase_pct, duration_days
        df_vbak: Existing sales order headers
        df_vbap: Existing sales order items
        df_vbep: Existing schedule lines
        df_kna1: Customer master

    Returns:
        Tuple of (new_vbak_records, new_vbap_records, new_vbep_records)
    """
    material = config['material']
    plant = config['plant']
    increase_pct = config['increase_pct']
    duration_days = config['duration_days']

    print(f"\n  Injecting {scenario_id} (Product Shortage - Demand Spike):")
    print(f"    Material: {material} (CRITICAL THERAPY)")
    print(f"    Plant: {plant}")
    print(f"    Increase: +{increase_pct}%")
    print(f"    Duration: {duration_days} days")

    if hasattr(df_vbak, 'toPandas'):
        df_vbak = df_vbak.toPandas()
    if hasattr(df_vbap, 'toPandas'):
        df_vbap = df_vbap.toPandas()
    if hasattr(df_kna1, 'toPandas'):
        df_kna1 = df_kna1.toPandas()

    existing_orders = df_vbap[
        (df_vbap['MATNR'] == material) &
        (df_vbap['WERKS'] == plant)
    ]

    if len(existing_orders) == 0:
        baseline_qty = 500
        num_baseline_orders = 3
    else:
        baseline_qty = existing_orders['KWMENG'].astype(float).mean()
        num_baseline_orders = len(existing_orders)

    num_new_orders = max(5, int(num_baseline_orders * increase_pct / 100))
    avg_order_qty = baseline_qty * 1.5  # Larger than normal orders

    print(f"    Baseline: {num_baseline_orders} orders, avg qty {baseline_qty:.0f}")
    print(f"    Creating: {num_new_orders} URGENT orders")

    customers = df_kna1['KUNNR'].tolist()

    max_vbeln = int(df_vbak['VBELN'].astype(str).str.replace(r'\D', '', regex=True).astype(float).max())
    next_vbeln = max_vbeln + 8000

    new_vbak = []
    new_vbap = []
    new_vbep = []

    start_date = datetime.now()

    for i in range(num_new_orders):
        vbeln = str(next_vbeln + i)
        order_date = start_date + timedelta(days=random.randint(0, duration_days // 2))
        delivery_date = order_date + timedelta(days=random.randint(3, 7))
        customer = random.choice(customers)
        qty = round(avg_order_qty * random.uniform(0.9, 1.3))
        net_value = round(qty * random.uniform(100, 300), 2)  # Higher value for critical therapy

        new_vbak.append({
            'MANDT': '800',
            'VBELN': vbeln,
            'ERDAT': order_date.strftime('%Y%m%d'),
            'ERZET': '080000',
            'ERNAM': 'CRITICAL',
            'AUDAT': order_date.strftime('%Y%m%d'),
            'VBTYP': 'C',
            'AUART': 'OR',
            'VKORG': '1000',
            'VTWEG': '10',
            'SPART': '00',
            'KUNNR': customer,
            'NETWR': net_value,
            'VDATU': delivery_date.strftime('%Y%m%d'),
            'WAERK': param('DATASET_CURRENCY'),
            'BSTNK': f'{scenario_id}-CRITICAL-{i+1:03d}',
            'LIFSK': '',
            'FAKSK': ''
        })

        new_vbap.append({
            'MANDT': '800',
            'VBELN': vbeln,
            'POSNR': '000010',
            'MATNR': material,
            'WERKS': plant,
            'LGORT': 'FG01',
            'KWMENG': qty,
            'MEINS': 'PC',
            'NETWR': net_value,
            'WAERK': param('DATASET_CURRENCY'),
            'ABGRU': '',
            'PSTYV': 'TAN'
        })

        new_vbep.append({
            'MANDT': '800',
            'VBELN': vbeln,
            'POSNR': '000010',
            'ETENR': '0001',
            'ETTYP': 'BN',
            'EDATU': delivery_date.strftime('%Y%m%d'),
            'WMENG': qty,
            'BMENG': qty,
            'LMENG': 0,
            'MEINS': 'PC'
        })

    total_qty = sum(r['KWMENG'] for r in new_vbap)
    print(f"    Created: {len(new_vbak)} CRITICAL orders totaling {total_qty:.0f} units")
    print(f"    Average delivery window: 3-7 days (URGENT)")

    return new_vbak, new_vbap, new_vbep


def inject_new_product(scenario_id, config, df_mara, df_makt, df_marc, df_mast, df_stpo, df_vbak, df_kna1):
    """
    Inject a new product introduction (SCN012).

    Creates new material master records (MARA, MAKT, MARC) based on an existing
    product, copies BOM structure, and creates initial sales orders.

    Args:
        scenario_id: Scenario identifier (e.g., "SCN012")
        config: Dict with new_material, plant, base_material
        df_mara: Existing material master
        df_makt: Existing material descriptions
        df_marc: Existing plant data
        df_mast: Existing BOM headers
        df_stpo: Existing BOM items
        df_vbak: Existing sales orders (for order number generation)
        df_kna1: Customer master

    Returns:
        Tuple of (new_mara, new_makt, new_marc, new_mast, new_stpo, new_vbak, new_vbap, new_vbep)
    """
    new_material = config['new_material']
    plant = config['plant']
    base_material = config['base_material']

    print(f"\n  Injecting {scenario_id} (New Product Introduction):")
    print(f"    New Material: {new_material}")
    print(f"    Based on: {base_material}")
    print(f"    Plant: {plant}")

    if hasattr(df_mara, 'toPandas'):
        df_mara = df_mara.toPandas()
    if hasattr(df_makt, 'toPandas'):
        df_makt = df_makt.toPandas()
    if hasattr(df_marc, 'toPandas'):
        df_marc = df_marc.toPandas()
    if hasattr(df_vbak, 'toPandas'):
        df_vbak = df_vbak.toPandas()
    if hasattr(df_kna1, 'toPandas'):
        df_kna1 = df_kna1.toPandas()

    base_mara = df_mara[df_mara['MATNR'] == base_material]
    if len(base_mara) == 0:
        print(f"    Warning: Base material {base_material} not found")
        return [], [], [], [], [], [], [], []

    base_record = base_mara.iloc[0].to_dict()

    new_mara_record = base_record.copy()
    new_mara_record['MATNR'] = new_material
    new_mara_record['ERSDA'] = datetime.now().strftime('%Y%m%d')
    new_mara_record['LAEDA'] = datetime.now().strftime('%Y%m%d')

    base_makt = df_makt[df_makt['MATNR'] == base_material]
    new_makt_records = []
    for _, row in base_makt.iterrows():
        new_makt = row.to_dict()
        new_makt['MATNR'] = new_material
        new_makt['MAKTX'] = f"NEW - {row['MAKTX']}"
        new_makt_records.append(new_makt)

    base_marc = df_marc[(df_marc['MATNR'] == base_material) & (df_marc['WERKS'] == plant)]
    new_marc_records = []
    for _, row in base_marc.iterrows():
        new_marc = row.to_dict()
        new_marc['MATNR'] = new_material
        new_marc_records.append(new_marc)

    new_mast_records = []
    new_stpo_records = []
    if df_mast is not None and df_stpo is not None:
        if hasattr(df_mast, 'toPandas'):
            df_mast = df_mast.toPandas()
        if hasattr(df_stpo, 'toPandas'):
            df_stpo = df_stpo.toPandas()

        base_mast = df_mast[df_mast['MATNR'] == base_material]
        for _, mast_row in base_mast.iterrows():
            old_stlnr = mast_row['STLNR']
            new_stlnr = f"NPI{old_stlnr[-6:]}"

            new_mast = mast_row.to_dict()
            new_mast['MATNR'] = new_material
            new_mast['STLNR'] = new_stlnr
            new_mast_records.append(new_mast)

            base_stpo = df_stpo[df_stpo['STLNR'] == old_stlnr]
            for _, stpo_row in base_stpo.iterrows():
                new_stpo = stpo_row.to_dict()
                new_stpo['STLNR'] = new_stlnr
                new_stpo_records.append(new_stpo)

    customers = df_kna1['KUNNR'].tolist()[:5]  # Top 5 customers
    max_vbeln = int(df_vbak['VBELN'].astype(str).str.replace(r'\D', '', regex=True).astype(float).max())
    next_vbeln = max_vbeln + 9000

    new_vbak = []
    new_vbap = []
    new_vbep = []

    for i in range(3):
        vbeln = str(next_vbeln + i)
        order_date = datetime.now() + timedelta(days=random.randint(1, 14))
        delivery_date = order_date + timedelta(days=random.randint(14, 28))
        customer = random.choice(customers)
        qty = random.randint(100, 500)
        net_value = round(qty * random.uniform(100, 250), 2)

        new_vbak.append({
            'MANDT': '800',
            'VBELN': vbeln,
            'ERDAT': order_date.strftime('%Y%m%d'),
            'ERZET': '100000',
            'ERNAM': 'NPI_LAUNCH',
            'AUDAT': order_date.strftime('%Y%m%d'),
            'VBTYP': 'C',
            'AUART': 'OR',
            'VKORG': '1000',
            'VTWEG': '10',
            'SPART': '00',
            'KUNNR': customer,
            'NETWR': net_value,
            'VDATU': delivery_date.strftime('%Y%m%d'),
            'WAERK': param('DATASET_CURRENCY'),
            'BSTNK': f'{scenario_id}-NPI-{i+1:03d}',
            'LIFSK': '',
            'FAKSK': ''
        })

        new_vbap.append({
            'MANDT': '800',
            'VBELN': vbeln,
            'POSNR': '000010',
            'MATNR': new_material,
            'WERKS': plant,
            'LGORT': 'FG01',
            'KWMENG': qty,
            'MEINS': 'PC',
            'NETWR': net_value,
            'WAERK': param('DATASET_CURRENCY'),
            'ABGRU': '',
            'PSTYV': 'TAN'
        })

        new_vbep.append({
            'MANDT': '800',
            'VBELN': vbeln,
            'POSNR': '000010',
            'ETENR': '0001',
            'ETTYP': 'BN',
            'EDATU': delivery_date.strftime('%Y%m%d'),
            'WMENG': qty,
            'BMENG': qty,
            'LMENG': 0,
            'MEINS': 'PC'
        })

    print(f"    Created: Material {new_material} with {len(new_makt_records)} descriptions")
    print(f"    Created: {len(new_mast_records)} BOM headers, {len(new_stpo_records)} BOM items")
    print(f"    Created: {len(new_vbak)} initial sales orders")

    return [new_mara_record], new_makt_records, new_marc_records, new_mast_records, new_stpo_records, new_vbak, new_vbap, new_vbep


def inject_equipment_failure(scenario_id, config, df_afko):
    """
    Inject equipment failure scenario (SCN015).

    Marks production orders as cancelled or rescheduled to simulate
    a production line failure.

    Args:
        scenario_id: Scenario identifier (e.g., "SCN015")
        config: Dict with plant, failure_date, downtime_days, cancel_ratio
        df_afko: Existing production orders

    Returns:
        Tuple of (cancelled_aufnr_list, rescheduled_afko_records, recovery_date)
    """
    plant = config['plant']
    failure_date_str = config['failure_date']
    downtime_days = config['downtime_days']
    cancel_ratio = config.get('cancel_ratio', 0.3)

    print(f"\n  Injecting {scenario_id} (Equipment Failure):")
    print(f"    Plant: {plant}")
    print(f"    Failure Date: {failure_date_str}, Downtime: {downtime_days} days")
    print(f"    Cancel Ratio: {cancel_ratio:.0%}")

    try:
        failure_date = datetime.strptime(failure_date_str, '%Y%m%d')
    except:
        failure_date = datetime.strptime(failure_date_str, '%Y-%m-%d')

    recovery_date = failure_date + timedelta(days=downtime_days)

    if hasattr(df_afko, 'toPandas'):
        df_afko = df_afko.toPandas()

    df_afko['GSTRP_DT'] = pd.to_datetime(df_afko['GSTRP'], format='%Y%m%d', errors='coerce')

    affected_orders = df_afko[
        (df_afko['WERKS'] == plant) &
        (df_afko['GSTRP_DT'] >= failure_date) &
        (df_afko['GSTRP_DT'] <= recovery_date)
    ]

    cancelled_orders = []
    rescheduled_orders = []

    for _, order in affected_orders.iterrows():
        aufnr = order['AUFNR']

        if random.random() < cancel_ratio:
            cancelled_orders.append(aufnr)
        else:
            new_record = order.to_dict()
            new_start = recovery_date + timedelta(days=random.randint(1, 7))
            new_finish = new_start + timedelta(days=random.randint(3, 10))
            new_record['GSTRP'] = new_start.strftime('%Y%m%d')
            new_record['GLTRP'] = new_finish.strftime('%Y%m%d')
            new_record['STAT'] = 'REL'
            rescheduled_orders.append(new_record)

    print(f"    Affected: {len(affected_orders)} production orders")
    print(f"    Cancelled: {len(cancelled_orders)} orders")
    print(f"    Rescheduled: {len(rescheduled_orders)} orders to after {recovery_date.strftime('%Y%m%d')}")

    return cancelled_orders, rescheduled_orders, recovery_date


def inject_regulatory_freeze(scenario_id, config, df_likp):
    """
    Inject regulatory inspection freeze (SCN017).

    Blocks deliveries during the freeze period by adding delivery blocks.

    Args:
        scenario_id: Scenario identifier (e.g., "SCN017")
        config: Dict with plant, start_date, freeze_days
        df_likp: Existing deliveries

    Returns:
        Tuple of (blocked_delivery_ids, freeze_end_date)
    """
    plant = config['plant']
    start_date_str = config['start_date']
    freeze_days = config['freeze_days']

    print(f"\n  Injecting {scenario_id} (Regulatory Inspection):")
    print(f"    Plant: {plant}")
    print(f"    Freeze Start: {start_date_str}, Duration: {freeze_days} days")

    try:
        start_date = datetime.strptime(start_date_str, '%Y%m%d')
    except:
        start_date = datetime.strptime(start_date_str, '%Y-%m-%d')

    freeze_end = start_date + timedelta(days=freeze_days)

    if hasattr(df_likp, 'toPandas'):
        df_likp = df_likp.toPandas()

    df_likp['WADAT_DT'] = pd.to_datetime(df_likp['WADAT'], format='%Y%m%d', errors='coerce')

    affected_deliveries = df_likp[
        (df_likp['WERKS'] == plant) &
        (df_likp['WADAT_DT'] >= start_date) &
        (df_likp['WADAT_DT'] <= freeze_end)
    ]

    blocked_ids = affected_deliveries['VBELN'].tolist()

    print(f"    Freeze Period: {start_date_str} to {freeze_end.strftime('%Y%m%d')}")
    print(f"    Blocked Deliveries: {len(blocked_ids)}")

    return blocked_ids, freeze_end


def inject_new_facility(scenario_id, config, df_sapapo_loc, df_afko, df_mara):
    """
    Inject new production facility scenario (SCN018).

    Creates a new plant location and ramping production orders.

    Args:
        scenario_id: Scenario identifier (e.g., "SCN018")
        config: Dict with new_plant, ramp_start, ramp_weeks
        df_sapapo_loc: Existing locations
        df_afko: Existing production orders (for structure reference)
        df_mara: Material master (for products to produce)

    Returns:
        Tuple of (new_location_record, new_afko_records)
    """
    new_plant = config['new_plant']
    ramp_start_str = config['ramp_start']
    ramp_weeks = config['ramp_weeks']

    print(f"\n  Injecting {scenario_id} (New Production Facility):")
    print(f"    New Plant: {new_plant}")
    print(f"    Ramp Start: {ramp_start_str}, Duration: {ramp_weeks} weeks")

    try:
        ramp_start = datetime.strptime(ramp_start_str, '%Y%m%d')
    except:
        ramp_start = datetime.strptime(ramp_start_str, '%Y-%m-%d')

    if hasattr(df_sapapo_loc, 'toPandas'):
        df_sapapo_loc = df_sapapo_loc.toPandas()
    if hasattr(df_afko, 'toPandas'):
        df_afko = df_afko.toPandas()
    if hasattr(df_mara, 'toPandas'):
        df_mara = df_mara.toPandas()

    base_loc = df_sapapo_loc[df_sapapo_loc['LOCTYPE'] == 'PLANT'].iloc[0].to_dict()
    new_location = base_loc.copy()
    new_location['LOCNO'] = new_plant
    new_location['CITY'] = 'New Facility City'
    new_location['COUNTRY'] = base_loc.get('COUNTRY', 'US')

    finished_goods = df_mara[df_mara['MTART'] == 'FERT']['MATNR'].tolist()[:5]

    new_afko = []
    capacity_pct = 0.2  # Start at 20% capacity

    for week in range(ramp_weeks):
        week_start = ramp_start + timedelta(weeks=week)
        capacity_pct = min(1.0, 0.2 + (0.8 * week / ramp_weeks))

        num_orders = max(1, int(3 * capacity_pct))

        for i, material in enumerate(finished_goods[:num_orders]):
            aufnr = f"NF{new_plant[-2:]}{week:02d}{i:02d}"
            order_start = week_start + timedelta(days=random.randint(0, 4))
            order_finish = order_start + timedelta(days=random.randint(3, 7))
            base_qty = random.randint(200, 500)
            qty = int(base_qty * capacity_pct)

            new_afko.append({
                'MANDT': '800',
                'AUFNR': aufnr,
                'AUART': 'PP01',
                'AUTYP': '10',
                'WERKS': new_plant,
                'MATNR': material,
                'PLNBEZ': material,  # Planning material = material
                'GAMNG': qty,
                'GMEIN': 'PC',
                'IGMNG': qty,
                'GSTRP': order_start.strftime('%Y%m%d'),
                'GLTRP': order_finish.strftime('%Y%m%d'),
                'FTRMI': order_start.strftime('%Y%m%d'),
                'STAT': 'REL',
                'WEMNG': 0
            })

    print(f"    Created: New location {new_plant}")
    print(f"    Created: {len(new_afko)} ramping production orders over {ramp_weeks} weeks")
    print(f"    Capacity ramp: 20% -> 100%")

    return new_location, new_afko


def inject_limited_capacity(scenario_id, config, df_afko, df_mara):
    """
    Inject limited capacity scenario (SCN014).

    Creates additional production orders to fill capacity to specified percentage,
    simulating a saturated production line with little slack.

    Args:
        scenario_id: Scenario identifier (e.g., "SCN014")
        config: Dict with plant, capacity_pct, duration_days
        df_afko: Existing production orders
        df_mara: Material master (for products to produce)

    Returns:
        List of new AFKO records
    """
    plant = config['plant']
    capacity_pct = config['capacity_pct']
    duration_days = config['duration_days']

    if hasattr(df_afko, 'toPandas'):
        df_afko = df_afko.toPandas()
    if hasattr(df_mara, 'toPandas'):
        df_mara = df_mara.toPandas()

    finished_goods = df_mara[df_mara['MTART'] == 'FERT']['MATNR'].tolist()

    existing_orders = len(df_afko[df_afko['WERKS'] == plant])
    target_additional = max(1, int(existing_orders * (capacity_pct / 100 - 0.6) / 0.6))

    new_afko = []
    start_date = datetime.now()

    for i in range(target_additional):
        material = random.choice(finished_goods)
        aufnr = f"LC{plant[-2:]}{i:04d}"
        order_start = start_date + timedelta(days=random.randint(0, duration_days))
        order_finish = order_start + timedelta(days=random.randint(3, 7))
        qty = random.randint(300, 800)

        new_afko.append({
            'MANDT': '800',
            'AUFNR': aufnr,
            'AUART': 'PP01',
            'AUTYP': '10',
            'WERKS': plant,
            'MATNR': material,
            'PLNBEZ': material,  # Planning material = material
            'GAMNG': qty,
            'GMEIN': 'PC',
            'IGMNG': qty,
            'GSTRP': order_start.strftime('%Y%m%d'),
            'GLTRP': order_finish.strftime('%Y%m%d'),
            'FTRMI': order_start.strftime('%Y%m%d'),
            'STAT': 'REL',
            'WEMNG': 0
        })

    return new_afko


def inject_competing_production(scenario_id, config, df_afko, df_vbak, df_kna1):
    """
    Inject competing production scenario (SCN016).

    Creates production orders for multiple competing products on the same line,
    simulating resource contention.

    Args:
        scenario_id: Scenario identifier (e.g., "SCN016")
        config: Dict with plant, materials (list), contention_pct
        df_afko: Existing production orders
        df_vbak: Sales orders (for customer reference)
        df_kna1: Customer master

    Returns:
        Tuple of (new_afko_records, new_vbak_records, new_vbap_records, new_vbep_records)
    """
    plant = config['plant']
    materials = config['materials']
    contention_pct = config['contention_pct']

    if hasattr(df_afko, 'toPandas'):
        df_afko = df_afko.toPandas()
    if hasattr(df_vbak, 'toPandas'):
        df_vbak = df_vbak.toPandas()
    if hasattr(df_kna1, 'toPandas'):
        df_kna1 = df_kna1.toPandas()

    customers = df_kna1['KUNNR'].tolist()
    start_date = datetime.now()

    new_afko = []
    new_vbak = []
    new_vbap = []
    new_vbep = []

    for week in range(4):  # 4 weeks of contention
        week_start = start_date + timedelta(weeks=week)

        for i, material in enumerate(materials):
            num_orders = random.randint(2, 3)

            for j in range(num_orders):
                aufnr = f"CP{plant[-2:]}{week:02d}{i:02d}{j:02d}"
                order_start = week_start + timedelta(days=random.randint(0, 4))
                order_finish = order_start + timedelta(days=random.randint(5, 10))  # Longer to create contention
                qty = random.randint(400, 900)

                new_afko.append({
                    'MANDT': '800',
                    'AUFNR': aufnr,
                    'AUART': 'PP01',
                    'AUTYP': '10',
                    'WERKS': plant,
                    'MATNR': material,
                    'PLNBEZ': material,  # Planning material = material
                    'GAMNG': qty,
                    'GMEIN': 'PC',
                    'IGMNG': qty,
                    'GSTRP': order_start.strftime('%Y%m%d'),
                    'GLTRP': order_finish.strftime('%Y%m%d'),
                    'FTRMI': order_start.strftime('%Y%m%d'),
                    'STAT': 'REL',
                    'WEMNG': 0
                })

                vbeln = f"CP{scenario_id[-3:]}{week:02d}{i:02d}{j:02d}"
                customer = random.choice(customers)
                req_date = (order_finish + timedelta(days=2)).strftime('%Y%m%d')

                new_vbak.append({
                    'MANDT': '800',
                    'VBELN': vbeln,
                    'AUART': 'OR',
                    'KUNNR': customer,
                    'ERDAT': order_start.strftime('%Y%m%d'),
                    'NETWR': round(qty * random.uniform(50, 150), 2),
                    'VDATU': req_date,
                    'WAERK': param('DATASET_CURRENCY'),
                    'ERNAM': 'COMPETING',
                    'BSTNK': f'{scenario_id}-COMPETING-{week:02d}-{i:02d}-{j:02d}'
                })

                new_vbap.append({
                    'MANDT': '800',
                    'VBELN': vbeln,
                    'POSNR': '000010',
                    'MATNR': material,
                    'WERKS': plant,
                    'LGORT': 'FG01',
                    'KWMENG': qty,
                    'MEINS': 'PC',
                    'NETPR': round(random.uniform(50, 150), 2),
                    'NETWR': round(qty * random.uniform(50, 150), 2),
                    'WAERK': param('DATASET_CURRENCY')
                })

                new_vbep.append({
                    'MANDT': '800',
                    'VBELN': vbeln,
                    'POSNR': '000010',
                    'ETENR': '0001',
                    'EDATU': req_date,
                    'WMENG': qty,
                    'BMENG': qty
                })

    return new_afko, new_vbak, new_vbap, new_vbep


def inject_high_volatility(scenario_id, config, df_vbak, df_vbap, df_vbep, df_kna1, df_mara):
    """
    Inject high volatility scenario (SCN020).

    Creates variable demand orders across the network with unpredictable patterns,
    simulating network-wide demand volatility.

    Args:
        scenario_id: Scenario identifier (e.g., "SCN020")
        config: Dict with volatility_pct, duration_days
        df_vbak: Existing sales order headers
        df_vbap: Existing sales order items
        df_vbep: Existing schedule lines
        df_kna1: Customer master
        df_mara: Material master

    Returns:
        Tuple of (new_vbak_records, new_vbap_records, new_vbep_records)
    """
    volatility_pct = config['volatility_pct']
    duration_days = config['duration_days']

    if hasattr(df_vbak, 'toPandas'):
        df_vbak = df_vbak.toPandas()
    if hasattr(df_kna1, 'toPandas'):
        df_kna1 = df_kna1.toPandas()
    if hasattr(df_mara, 'toPandas'):
        df_mara = df_mara.toPandas()

    customers = df_kna1['KUNNR'].tolist()
    finished_goods = df_mara[df_mara['MTART'] == 'FERT']['MATNR'].tolist()
    plants = ['1000', '2000', '3000', '4000']
    start_date = datetime.now()

    new_vbak = []
    new_vbap = []
    new_vbep = []

    num_volatile_orders = int(20 * (volatility_pct / 40))  # Scale with volatility

    for i in range(num_volatile_orders):
        vbeln = f"HV{scenario_id[-3:]}{i:04d}"
        customer = random.choice(customers)
        material = random.choice(finished_goods)
        plant = random.choice(plants)

        base_qty = random.randint(50, 200)
        variance = random.uniform(-volatility_pct/100, volatility_pct/100)
        qty = max(10, int(base_qty * (1 + variance * 2)))  # Double the variance effect

        order_date = start_date + timedelta(days=random.randint(0, duration_days))
        lead_time = random.choice([3, 5, 7, 10, 14, 21])  # Highly variable
        req_date = (order_date + timedelta(days=lead_time)).strftime('%Y%m%d')

        new_vbak.append({
            'MANDT': '800',
            'VBELN': vbeln,
            'AUART': 'OR',
            'KUNNR': customer,
            'ERDAT': order_date.strftime('%Y%m%d'),
            'NETWR': round(qty * random.uniform(50, 200), 2),
            'VDATU': req_date,
            'WAERK': param('DATASET_CURRENCY'),
            'ERNAM': 'VOLATILITY',
            'BSTNK': f'{scenario_id}-VOLATILITY-{i+1:03d}'
        })

        new_vbap.append({
            'MANDT': '800',
            'VBELN': vbeln,
            'POSNR': '000010',
            'MATNR': material,
            'WERKS': plant,
            'LGORT': 'FG01',
            'KWMENG': qty,
            'MEINS': 'PC',
            'NETPR': round(random.uniform(50, 200), 2),
            'NETWR': round(qty * random.uniform(50, 200), 2),
            'WAERK': param('DATASET_CURRENCY')
        })

        new_vbep.append({
            'MANDT': '800',
            'VBELN': vbeln,
            'POSNR': '000010',
            'ETENR': '0001',
            'EDATU': req_date,
            'WMENG': qty,
            'BMENG': qty
        })

    return new_vbak, new_vbap, new_vbep


def inject_supplier_performance(df_ekbe, scenario_id, config, scenario_def):
    """Change EKBE dates and quantities to match a supplier scenario."""
    vendor = config['vendor']
    material = config.get('material', '')  # Optional material filter
    target_otif = config['target_otif']
    months_affected = config['months_affected']
    trend = scenario_def.get('trend', 'DECLINE')

    print(f"\n  Injecting {scenario_id} ({scenario_def['name']}):")
    print(f"    Vendor: {vendor}")
    print(f"    Material: {material if material else 'ALL'}")
    print(f"    Target OTIF: {target_otif*100:.1f}%")
    print(f"    Months affected: {months_affected}")
    print(f"    Trend: {trend}")

    df_ekbe = df_ekbe.copy()

    df_ekbe['BUDAT_DT'] = pd.to_datetime(df_ekbe['BUDAT'], format='%Y%m%d', errors='coerce')
    df_ekbe['EINDT_DT'] = pd.to_datetime(df_ekbe.get('EINDT_PLAN', df_ekbe['BUDAT']), format='%Y%m%d', errors='coerce')

    cutoff_date = datetime.now() - timedelta(days=months_affected * 30)

    vendor_mask = df_ekbe['LIFNR'] == vendor
    date_mask = df_ekbe['BUDAT_DT'] >= cutoff_date

    if material and material != 'ALL':
        material_mask = df_ekbe['MATNR'] == material
        records_mask = vendor_mask & date_mask & material_mask
    else:
        records_mask = vendor_mask & date_mask

    affected_records = df_ekbe[records_mask].index.tolist()
    print(f"    Records affected: {len(affected_records)}")

    if not affected_records:
        print(f"    Warning: No matching records found for vendor {vendor}")
        return df_ekbe

    current_otif = 0.95  # Assume baseline OTIF is 95%
    failure_rate = current_otif - target_otif  # Additional failures to inject

    if trend == 'IMPROVE':
        failure_rate = -failure_rate  # Negative = fix failures

    records_to_modify = int(len(affected_records) * abs(failure_rate))
    selected_indices = random.sample(affected_records, min(records_to_modify, len(affected_records)))

    on_time_failures = 0
    in_full_failures = 0

    for idx in selected_indices:
        if trend in ['DECLINE', 'STABLE'] and failure_rate > 0:
            if random.random() < 0.6:  # 60% chance of late delivery
                days_late = random.randint(5, 21)
                original_date = df_ekbe.loc[idx, 'BUDAT_DT']
                new_date = original_date + timedelta(days=days_late)
                df_ekbe.loc[idx, 'BUDAT'] = new_date.strftime('%Y%m%d')
                df_ekbe.loc[idx, 'OTIF_ONTIME'] = ''
                on_time_failures += 1

            if random.random() < 0.4:  # 40% chance of partial delivery
                original_qty = df_ekbe.loc[idx, 'MENGE']
                new_qty = round(original_qty * random.uniform(0.5, 0.85))
                df_ekbe.loc[idx, 'MENGE'] = new_qty
                df_ekbe.loc[idx, 'BPMNG'] = new_qty
                if 'NETPR' in df_ekbe.columns:
                    df_ekbe.loc[idx, 'DMBTR'] = round(new_qty * df_ekbe.loc[idx].get('NETPR', 50), 2)
                    df_ekbe.loc[idx, 'WRBTR'] = df_ekbe.loc[idx, 'DMBTR']
                df_ekbe.loc[idx, 'OTIF_INFULL'] = ''
                in_full_failures += 1

        elif trend == 'IMPROVE':
            df_ekbe.loc[idx, 'OTIF_ONTIME'] = 'X'
            df_ekbe.loc[idx, 'OTIF_INFULL'] = 'X'

    df_ekbe = df_ekbe.drop(columns=['BUDAT_DT', 'EINDT_DT'], errors='ignore')

    print(f"    On-time failures injected: {on_time_failures}")
    print(f"    In-full failures injected: {in_full_failures}")

    return df_ekbe


def save_sap_table(df, table_name, wh):
    """Save DataFrame to Delta table with schema alignment."""
    df = df.rename(columns={col: col.upper() for col in df.columns})

    if not wh.exists(table_name):
        print(f"Creating {table_name}...")
        wh.save(table_name, df)
    else:
        print(f"Updating {table_name}...")
        target = wh.read(table_name)

        aligned = pd.DataFrame(index=df.index)
        for col, dtype in zip(target.columns, target.dtypes):
            if col in df.columns:
                aligned[col] = df[col]
            else:
                if pd.api.types.is_string_dtype(dtype):
                    aligned[col] = ""
                elif pd.api.types.is_numeric_dtype(dtype):
                    aligned[col] = 0
                else:
                    aligned[col] = None
        wh.save(table_name, aligned)


def generate(wh):
    RANDOM_SEED = int(param("RANDOM_SEED"))

    SCN001_ENABLED = widget("SCN001_ENABLED", "false").lower() == "true"
    SCN002_ENABLED = widget("SCN002_ENABLED", "false").lower() == "true"
    SCN003_ENABLED = widget("SCN003_ENABLED", "false").lower() == "true"
    SCN004_ENABLED = widget("SCN004_ENABLED", "false").lower() == "true"
    SCN005_ENABLED = widget("SCN005_ENABLED", "false").lower() == "true"
    SCN006_ENABLED = widget("SCN006_ENABLED", "false").lower() == "true"
    SCN007_ENABLED = widget("SCN007_ENABLED", "false").lower() == "true"
    SCN008_ENABLED = widget("SCN008_ENABLED", "false").lower() == "true"
    SCN009_ENABLED = widget("SCN009_ENABLED", "false").lower() == "true"
    SCN010_ENABLED = widget("SCN010_ENABLED", "false").lower() == "true"

    SCN021_ENABLED = widget("SCN021_ENABLED", "false").lower() == "true"
    SCN022_ENABLED = widget("SCN022_ENABLED", "false").lower() == "true"
    SCN023_ENABLED = widget("SCN023_ENABLED", "false").lower() == "true"
    SCN024_ENABLED = widget("SCN024_ENABLED", "false").lower() == "true"
    SCN025_ENABLED = widget("SCN025_ENABLED", "false").lower() == "true"
    SCN026_ENABLED = widget("SCN026_ENABLED", "false").lower() == "true"

    SCN001_CONFIG = widget("SCN001_CONFIG", "")
    SCN002_CONFIG = widget("SCN002_CONFIG", "")
    SCN003_CONFIG = widget("SCN003_CONFIG", "")
    SCN004_CONFIG = widget("SCN004_CONFIG", "")
    SCN005_CONFIG = widget("SCN005_CONFIG", "")
    SCN006_CONFIG = widget("SCN006_CONFIG", "")
    SCN007_CONFIG = widget("SCN007_CONFIG", "")
    SCN008_CONFIG = widget("SCN008_CONFIG", "")
    SCN009_CONFIG = widget("SCN009_CONFIG", "")
    SCN010_CONFIG = widget("SCN010_CONFIG", "")

    SCN021_CONFIG = widget("SCN021_CONFIG", "")
    SCN022_CONFIG = widget("SCN022_CONFIG", "")
    SCN023_CONFIG = widget("SCN023_CONFIG", "")
    SCN024_CONFIG = widget("SCN024_CONFIG", "")
    SCN025_CONFIG = widget("SCN025_CONFIG", "")
    SCN026_CONFIG = widget("SCN026_CONFIG", "")

    SCN011_ENABLED = widget("SCN011_ENABLED", "false").lower() == "true"
    SCN012_ENABLED = widget("SCN012_ENABLED", "false").lower() == "true"
    SCN013_ENABLED = widget("SCN013_ENABLED", "false").lower() == "true"
    SCN014_ENABLED = widget("SCN014_ENABLED", "false").lower() == "true"
    SCN015_ENABLED = widget("SCN015_ENABLED", "false").lower() == "true"
    SCN016_ENABLED = widget("SCN016_ENABLED", "false").lower() == "true"
    SCN017_ENABLED = widget("SCN017_ENABLED", "false").lower() == "true"
    SCN018_ENABLED = widget("SCN018_ENABLED", "false").lower() == "true"
    SCN019_ENABLED = widget("SCN019_ENABLED", "false").lower() == "true"
    SCN020_ENABLED = widget("SCN020_ENABLED", "false").lower() == "true"

    SCN011_CONFIG = widget("SCN011_CONFIG", "")
    SCN012_CONFIG = widget("SCN012_CONFIG", "")
    SCN013_CONFIG = widget("SCN013_CONFIG", "")
    SCN014_CONFIG = widget("SCN014_CONFIG", "")
    SCN015_CONFIG = widget("SCN015_CONFIG", "")
    SCN016_CONFIG = widget("SCN016_CONFIG", "")
    SCN017_CONFIG = widget("SCN017_CONFIG", "")
    SCN018_CONFIG = widget("SCN018_CONFIG", "")
    SCN019_CONFIG = widget("SCN019_CONFIG", "")
    SCN020_CONFIG = widget("SCN020_CONFIG", "")

    seed_all(RANDOM_SEED)

    print(f"Seed: {RANDOM_SEED}")
    print(f"Inventory Scenarios: SCN001={SCN001_ENABLED}, SCN002={SCN002_ENABLED}, SCN003={SCN003_ENABLED}, SCN004={SCN004_ENABLED}, SCN005={SCN005_ENABLED}, SCN006={SCN006_ENABLED}, SCN008={SCN008_ENABLED}, SCN009={SCN009_ENABLED}, SCN010={SCN010_ENABLED}")
    print(f"Production Scenarios: SCN011={SCN011_ENABLED}, SCN012={SCN012_ENABLED}, SCN013={SCN013_ENABLED}, SCN014={SCN014_ENABLED}, SCN015={SCN015_ENABLED}, SCN016={SCN016_ENABLED}, SCN017={SCN017_ENABLED}, SCN018={SCN018_ENABLED}, SCN019={SCN019_ENABLED}, SCN020={SCN020_ENABLED}")
    print(f"Supplier Scenarios: SCN021={SCN021_ENABLED}, SCN022={SCN022_ENABLED}, SCN023={SCN023_ENABLED}, SCN024={SCN024_ENABLED}, SCN025={SCN025_ENABLED}, SCN026={SCN026_ENABLED}")


    inventory_scenarios_enabled = any([SCN001_ENABLED, SCN002_ENABLED, SCN003_ENABLED, SCN004_ENABLED, SCN005_ENABLED, SCN006_ENABLED, SCN007_ENABLED, SCN008_ENABLED, SCN009_ENABLED, SCN010_ENABLED])
    supplier_scenarios_enabled = any([SCN021_ENABLED, SCN022_ENABLED, SCN023_ENABLED, SCN024_ENABLED, SCN025_ENABLED, SCN026_ENABLED])
    production_scenarios_enabled = any([SCN011_ENABLED, SCN012_ENABLED, SCN013_ENABLED, SCN014_ENABLED, SCN015_ENABLED, SCN016_ENABLED, SCN017_ENABLED, SCN018_ENABLED, SCN019_ENABLED, SCN020_ENABLED])
    scenarios_enabled = inventory_scenarios_enabled or supplier_scenarios_enabled or production_scenarios_enabled

    if not scenarios_enabled:
        print("No scenarios enabled. Skipping scenario injection.")
        return

    print(f"\n{'='*60}")
    print("SCENARIO INJECTION")
    print(f"{'='*60}")

    print("Reading existing tables...")
    df_matdoc = wh.read("matdoc")
    df_mard = wh.read("mard")

    df_ekbe = None
    if supplier_scenarios_enabled:
        try:
            df_ekbe = wh.read("ekbe")
            print(f"  Loaded EKBE with {len(df_ekbe)} records")
        except Exception as e:
            print(f"  Warning: Could not load EKBE table - {e}")
            print("  Supplier scenarios will be skipped")
            supplier_scenarios_enabled = False

    df_vbak = None
    df_vbap = None
    df_vbep = None
    df_kna1 = None
    if production_scenarios_enabled:
        try:
            df_vbak = wh.read("vbak")
            df_vbap = wh.read("vbap")
            df_vbep = wh.read("vbep")
            df_kna1 = wh.read("kna1")
            print(f"  Loaded VBAK with {len(df_vbak)} records")
            print(f"  Loaded VBAP with {len(df_vbap)} records")
            print(f"  Loaded VBEP with {len(df_vbep)} records")
            print(f"  Loaded KNA1 with {len(df_kna1)} records")
        except Exception as e:
            print(f"  Warning: Could not load sales order tables - {e}")
            print("  Production scenarios will be skipped")
            production_scenarios_enabled = False

    all_scenario_records = []
    scenario_metadata = []
    blocked_matdoc_ids = []

    if SCN001_ENABLED:
        config = parse_config(SCN001_CONFIG, scenario_type="standard")
        if config:
            print(f"Injecting SCN001 (Stock Deviation): {config}")
            records = inject_scenario("SCN001", config, INVENTORY_SCENARIO_DEFINITIONS["SCN001"])
            all_scenario_records.extend(records)
            scenario_metadata.append({
                "scenario_id": "SCN001",
                "description": INVENTORY_SCENARIO_DEFINITIONS["SCN001"]["description"],
                "mvmt_type": INVENTORY_SCENARIO_DEFINITIONS["SCN001"]["mvmt_type"],
                "material": config["material"],
                "plant": config["plant"],
                "storage_loc": config["sloc"],
                "dest_loc": None,
                "quantity": float(config["qty"]),
                "downtime_days": None,
                "recovery_date": None,
                "injected_at": datetime.now()
            })

    if SCN002_ENABLED:
        config = parse_config(SCN002_CONFIG, scenario_type="standard")
        if config:
            print(f"Injecting SCN002 (Contamination): {config}")
            records = inject_scenario("SCN002", config, INVENTORY_SCENARIO_DEFINITIONS["SCN002"])
            all_scenario_records.extend(records)
            scenario_metadata.append({
                "scenario_id": "SCN002",
                "description": INVENTORY_SCENARIO_DEFINITIONS["SCN002"]["description"],
                "mvmt_type": INVENTORY_SCENARIO_DEFINITIONS["SCN002"]["mvmt_type"],
                "material": config["material"],
                "plant": config["plant"],
                "storage_loc": config["sloc"],
                "dest_loc": None,
                "quantity": float(config["qty"]),
                "downtime_days": None,
                "recovery_date": None,
                "injected_at": datetime.now()
            })

    if SCN003_ENABLED:
        config = parse_config(SCN003_CONFIG, scenario_type="fire")
        if config:
            print(f"Injecting SCN003 (Fire Damage - ALL materials at location):")
            scrap_records, blocked_ids, recovery_date = inject_fire_scenario(config, df_mard, df_matdoc)
            all_scenario_records.extend(scrap_records)
            blocked_matdoc_ids.extend(blocked_ids)

            total_qty = sum((float(r['MENGE']) for r in scrap_records), 0.0)

            sloc_desc = "ALL locations" if config["sloc"].upper() == "ALL" else config["sloc"]
            scenario_metadata.append({
                "scenario_id": "SCN003",
                "description": f"Warehouse fire - ALL stock destroyed at {config['plant']}/{sloc_desc}",
                "mvmt_type": "551",
                "material": "ALL",  # Affects all materials
                "plant": config["plant"],
                "storage_loc": config["sloc"],
                "dest_loc": None,
                "quantity": float(total_qty),
                "downtime_days": config["downtime_days"],
                "recovery_date": recovery_date.strftime('%Y%m%d'),
                "injected_at": datetime.now()
            })

    if SCN004_ENABLED:
        config = parse_config(SCN004_CONFIG, scenario_type="shutdown")
        if config:
            print(f"Injecting SCN004 (Production Shutdown):")
            blocked_ids, recovery_date = inject_shutdown_scenario("SCN004", config, df_matdoc, capacity_pct=0)
            blocked_matdoc_ids.extend(blocked_ids)
            scenario_metadata.append({
                "scenario_id": "SCN004",
                "description": INVENTORY_SCENARIO_DEFINITIONS["SCN004"]["description"],
                "mvmt_type": "N/A",
                "material": "ALL",
                "plant": config["plant"],
                "storage_loc": None,
                "dest_loc": None,
                "quantity": None,
                "downtime_days": config["downtime_days"],
                "recovery_date": recovery_date.strftime('%Y%m%d'),
                "injected_at": datetime.now()
            })

    if SCN005_ENABLED:
        config = parse_config(SCN005_CONFIG, scenario_type="quarantine_single")
        if config:
            print(f"Injecting SCN005 (Batch Quarantine - Single):")
            transfer_records, release_date = inject_quarantine_scenario("SCN005", config, df_mard, is_all_locations=False)
            all_scenario_records.extend(transfer_records)
            scenario_metadata.append({
                "scenario_id": "SCN005",
                "description": f"Batch {config['batch']} quarantine - pending release",
                "mvmt_type": "311",
                "material": config["material"],
                "plant": config["plant"],
                "storage_loc": config["sloc"],
                "dest_loc": "QA01",
                "quantity": float(config["qty"]),
                "downtime_days": config["quarantine_days"],
                "recovery_date": release_date.strftime('%Y%m%d'),
                "injected_at": datetime.now()
            })

    if SCN006_ENABLED:
        config = parse_config(SCN006_CONFIG, scenario_type="quarantine_all")
        if config:
            print(f"Injecting SCN006 (Batch Quarantine - All Locations):")
            transfer_records, release_date = inject_quarantine_scenario("SCN006", config, df_mard, is_all_locations=True)
            all_scenario_records.extend(transfer_records)

            total_qty = sum((float(r['MENGE']) for r in transfer_records if r['SHKZG'] == 'S'), 0.0)

            scenario_metadata.append({
                "scenario_id": "SCN006",
                "description": f"Product {config['material']} quarantine - all locations pending release",
                "mvmt_type": "311",
                "material": config["material"],
                "plant": "ALL",
                "storage_loc": "ALL",
                "dest_loc": "QA01",
                "quantity": float(total_qty),
                "downtime_days": config["quarantine_days"],
                "recovery_date": release_date.strftime('%Y%m%d'),
                "injected_at": datetime.now()
            })

    if SCN007_ENABLED:
        config = parse_config(SCN007_CONFIG, scenario_type="writeoff")
        if config:
            print(f"Injecting SCN007 (Product Write-off):")
            print(f"  Material: {config['material']}, Plant: {config['plant']}, Batch: {config['batch']}, Qty: {config['qty']}")
            records = inject_scenario("SCN007", config, INVENTORY_SCENARIO_DEFINITIONS["SCN007"])
            all_scenario_records.extend(records)
            scenario_metadata.append({
                "scenario_id": "SCN007",
                "description": f"Product write-off - batch {config['batch']} permanently removed",
                "mvmt_type": "551",
                "material": config["material"],
                "plant": config["plant"],
                "storage_loc": config["sloc"],
                "dest_loc": None,
                "quantity": float(config["qty"]),
                "downtime_days": None,
                "recovery_date": None,
                "injected_at": datetime.now()
            })

    if SCN008_ENABLED:
        config = parse_config(SCN008_CONFIG, scenario_type="transfer")
        if config:
            print(f"Injecting SCN008 (Temperature Issue - Inventory Destruction):")
            scrap_records = inject_temperature_scenario(config, df_mard)
            all_scenario_records.extend(scrap_records)

            total_qty = sum((float(r['MENGE']) for r in scrap_records), 0.0)

            scenario_metadata.append({
                "scenario_id": "SCN008",
                "description": INVENTORY_SCENARIO_DEFINITIONS["SCN008"]["description"],
                "mvmt_type": "551",
                "material": "ALL",
                "plant": config["plant"],
                "storage_loc": config["from_sloc"],
                "dest_loc": None,
                "quantity": float(total_qty),
                "downtime_days": None,
                "recovery_date": None,
                "injected_at": datetime.now()
            })

    if SCN009_ENABLED:
        config = parse_config(SCN009_CONFIG, scenario_type="reroute")
        if config:
            print(f"Injecting SCN009 (Re-route - Warehouse Offline):")
            transfer_records, blocked_ids, recovery_date, total_qty = inject_reroute_scenario(config, df_mard, df_matdoc)
            all_scenario_records.extend(transfer_records)
            blocked_matdoc_ids.extend(blocked_ids)

            sloc_desc = "ALL locations" if config["sloc"].upper() == "ALL" else config["sloc"]
            scenario_metadata.append({
                "scenario_id": "SCN009",
                "description": f"Warehouse offline - all inventory at {config['plant']}/{sloc_desc} quarantined, rerouting required",
                "mvmt_type": "311",
                "material": "ALL",
                "plant": config["plant"],
                "storage_loc": config["sloc"],
                "dest_loc": "QA01",
                "quantity": float(total_qty),
                "downtime_days": config["downtime_days"],
                "recovery_date": recovery_date.strftime('%Y%m%d'),
                "injected_at": datetime.now()
            })

    if SCN010_ENABLED:
        config = parse_config(SCN010_CONFIG, scenario_type="shutdown")
        if config:
            print(f"Injecting SCN010 (Partial Production Shutdown - 50% capacity):")
            blocked_ids, recovery_date = inject_shutdown_scenario("SCN010", config, df_matdoc, capacity_pct=50)
            scenario_metadata.append({
                "scenario_id": "SCN010",
                "description": INVENTORY_SCENARIO_DEFINITIONS["SCN010"]["description"],
                "mvmt_type": "N/A",
                "material": "ALL",
                "plant": config["plant"],
                "storage_loc": None,
                "dest_loc": None,
                "quantity": None,
                "downtime_days": config["downtime_days"],
                "recovery_date": recovery_date.strftime('%Y%m%d'),
                "injected_at": datetime.now()
            })


    production_scenario_records = {
        "vbak": [],
        "vbap": [],
        "vbep": []
    }
    production_scenarios_injected = 0

    if production_scenarios_enabled and df_vbak is not None:
        print("\n--- Processing Production Scenarios ---")

        if SCN011_ENABLED:
            config = parse_production_config(SCN011_CONFIG)
            if config:
                print(f"\n  Injecting SCN011 (Demand Increase):")
                print(f"    Material: {config['material']}, Plant: {config['plant']}")
                print(f"    Increase: {config['increase_pct']}% permanent demand increase")

                vbak_records, vbap_records, vbep_records = inject_demand_increase(
                    "SCN011", config, df_vbak, df_vbap, df_vbep, df_kna1
                )
                production_scenario_records["vbak"].extend(vbak_records)
                production_scenario_records["vbap"].extend(vbap_records)
                production_scenario_records["vbep"].extend(vbep_records)

                scenario_metadata.append({
                    "scenario_id": "SCN011",
                    "scenario_type": "PRODUCTION",
                    "description": PRODUCTION_SCENARIO_DEFINITIONS["SCN011"]["description"],
                    "mvmt_type": "N/A",
                    "material": config["material"],
                    "plant": config["plant"],
                    "storage_loc": None,
                    "dest_loc": None,
                    "quantity": None,
                    "downtime_days": None,
                    "recovery_date": None,
                    "demand_increase_pct": config["increase_pct"],
                    "demand_type": "PERMANENT",
                    "injected_at": datetime.now()
                })
                production_scenarios_injected += 1
                print(f"    Created {len(vbak_records)} new sales orders")

        if SCN013_ENABLED:
            config = parse_production_config(SCN013_CONFIG, scenario_type="expedition")
            if config:
                print(f"\n  Injecting SCN013 (Batch Expedition):")
                print(f"    Material: {config['material']}, Plant: {config['plant']}")
                print(f"    Emergency order: {config['qty']} units, Due: {config['due_date']}")

                vbak_records, vbap_records, vbep_records = inject_emergency_order(
                    "SCN013", config, df_vbak, df_kna1
                )
                production_scenario_records["vbak"].extend(vbak_records)
                production_scenario_records["vbap"].extend(vbap_records)
                production_scenario_records["vbep"].extend(vbep_records)

                scenario_metadata.append({
                    "scenario_id": "SCN013",
                    "scenario_type": "PRODUCTION",
                    "description": PRODUCTION_SCENARIO_DEFINITIONS["SCN013"]["description"],
                    "mvmt_type": "N/A",
                    "material": config["material"],
                    "plant": config["plant"],
                    "storage_loc": None,
                    "dest_loc": None,
                    "quantity": float(config["qty"]),
                    "downtime_days": None,
                    "recovery_date": None,
                    "demand_increase_pct": None,
                    "demand_type": "EMERGENCY",
                    "injected_at": datetime.now()
                })
                production_scenarios_injected += 1
                print(f"    Created {len(vbak_records)} emergency sales order(s)")

        if SCN019_ENABLED:
            config = parse_production_config(SCN019_CONFIG, scenario_type="shortage")
            if config:
                print(f"\n  Injecting SCN019 (Product Shortage):")
                print(f"    Material: {config['material']}, Plant: {config['plant']}")
                print(f"    Shortage response: +{config['increase_pct']}% demand for {config['duration_days']} days")

                vbak_records, vbap_records, vbep_records = inject_shortage_demand(
                    "SCN019", config, df_vbak, df_vbap, df_vbep, df_kna1
                )
                production_scenario_records["vbak"].extend(vbak_records)
                production_scenario_records["vbap"].extend(vbap_records)
                production_scenario_records["vbep"].extend(vbep_records)

                scenario_metadata.append({
                    "scenario_id": "SCN019",
                    "scenario_type": "PRODUCTION",
                    "description": PRODUCTION_SCENARIO_DEFINITIONS["SCN019"]["description"],
                    "mvmt_type": "N/A",
                    "material": config["material"],
                    "plant": config["plant"],
                    "storage_loc": None,
                    "dest_loc": None,
                    "quantity": None,
                    "downtime_days": config["duration_days"],
                    "recovery_date": None,
                    "demand_increase_pct": config["increase_pct"],
                    "demand_type": "EMERGENCY",
                    "injected_at": datetime.now()
                })
                production_scenarios_injected += 1
                print(f"    Created {len(vbak_records)} shortage response orders")

        if SCN012_ENABLED:
            config = parse_production_config(SCN012_CONFIG, scenario_type="new_product")
            if config:
                print(f"\n  Injecting SCN012 (New Product Introduction):")
                print(f"    New Material: {config['new_material']}, Based on: {config['base_material']}")

                try:
                    df_mara = wh.read("mara")
                    df_makt = wh.read("makt")
                    df_marc = wh.read("marc")
                    df_mast = wh.read("mast")
                    df_stpo = wh.read("stpo")

                    mara_recs, makt_recs, marc_recs, mast_recs, stpo_recs, vbak_recs, vbap_recs, vbep_recs = inject_new_product(
                        "SCN012", config, df_mara, df_makt, df_marc, df_mast, df_stpo, df_vbak, df_kna1
                    )

                    if 'master_data' not in production_scenario_records:
                        production_scenario_records['master_data'] = {'mara': [], 'makt': [], 'marc': [], 'mast': [], 'stpo': []}
                    production_scenario_records['master_data']['mara'].extend(mara_recs)
                    production_scenario_records['master_data']['makt'].extend(makt_recs)
                    production_scenario_records['master_data']['marc'].extend(marc_recs)
                    production_scenario_records['master_data']['mast'].extend(mast_recs)
                    production_scenario_records['master_data']['stpo'].extend(stpo_recs)
                    production_scenario_records["vbak"].extend(vbak_recs)
                    production_scenario_records["vbap"].extend(vbap_recs)
                    production_scenario_records["vbep"].extend(vbep_recs)

                    scenario_metadata.append({
                        "scenario_id": "SCN012",
                        "scenario_type": "PRODUCTION",
                        "description": PRODUCTION_SCENARIO_DEFINITIONS["SCN012"]["description"],
                        "mvmt_type": "N/A",
                        "material": config["new_material"],
                        "plant": config["plant"],
                        "storage_loc": None,
                        "dest_loc": None,
                        "quantity": None,
                        "downtime_days": None,
                        "recovery_date": None,
                        "demand_increase_pct": None,
                        "demand_type": "NEW_PRODUCT",
                        "injected_at": datetime.now()
                    })
                    production_scenarios_injected += 1
                except Exception as e:
                    print(f"    Warning: SCN012 failed - {e}")

        if SCN015_ENABLED:
            config = parse_production_config(SCN015_CONFIG, scenario_type="equipment_failure")
            if config:
                print(f"\n  Injecting SCN015 (Equipment Failure):")

                try:
                    df_afko = wh.read("afko")

                    cancelled_orders, rescheduled_orders, recovery_date = inject_equipment_failure(
                        "SCN015", config, df_afko
                    )

                    if 'afko_changes' not in production_scenario_records:
                        production_scenario_records['afko_changes'] = {'cancelled': [], 'rescheduled': []}
                    production_scenario_records['afko_changes']['cancelled'].extend(cancelled_orders)
                    production_scenario_records['afko_changes']['rescheduled'].extend(rescheduled_orders)

                    scenario_metadata.append({
                        "scenario_id": "SCN015",
                        "scenario_type": "PRODUCTION",
                        "description": PRODUCTION_SCENARIO_DEFINITIONS["SCN015"]["description"],
                        "mvmt_type": "N/A",
                        "material": "ALL",
                        "plant": config["plant"],
                        "storage_loc": None,
                        "dest_loc": None,
                        "quantity": None,
                        "downtime_days": config["downtime_days"],
                        "recovery_date": recovery_date.strftime('%Y%m%d'),
                        "demand_increase_pct": None,
                        "demand_type": "DISRUPTION",
                        "injected_at": datetime.now()
                    })
                    production_scenarios_injected += 1
                except Exception as e:
                    print(f"    Warning: SCN015 failed - {e}")

        if SCN017_ENABLED:
            config = parse_production_config(SCN017_CONFIG, scenario_type="regulatory_freeze")
            if config:
                print(f"\n  Injecting SCN017 (Regulatory Inspection):")

                try:
                    df_likp = wh.read("likp")

                    blocked_deliveries, freeze_end = inject_regulatory_freeze(
                        "SCN017", config, df_likp
                    )

                    if 'likp_blocks' not in production_scenario_records:
                        production_scenario_records['likp_blocks'] = []
                    production_scenario_records['likp_blocks'].extend(blocked_deliveries)

                    scenario_metadata.append({
                        "scenario_id": "SCN017",
                        "scenario_type": "PRODUCTION",
                        "description": PRODUCTION_SCENARIO_DEFINITIONS["SCN017"]["description"],
                        "mvmt_type": "N/A",
                        "material": "ALL",
                        "plant": config["plant"],
                        "storage_loc": None,
                        "dest_loc": None,
                        "quantity": None,
                        "downtime_days": config["freeze_days"],
                        "recovery_date": freeze_end.strftime('%Y%m%d'),
                        "demand_increase_pct": None,
                        "demand_type": "FREEZE",
                        "injected_at": datetime.now()
                    })
                    production_scenarios_injected += 1
                except Exception as e:
                    print(f"    Warning: SCN017 failed - {e}")

        if SCN018_ENABLED:
            config = parse_production_config(SCN018_CONFIG, scenario_type="new_facility")
            if config:
                print(f"\n  Injecting SCN018 (New Production Facility):")

                try:
                    df_sapapo_loc = wh.read("sapapo_loc")
                    df_afko = wh.read("afko")
                    df_mara = wh.read("mara")

                    new_location, new_afko = inject_new_facility(
                        "SCN018", config, df_sapapo_loc, df_afko, df_mara
                    )

                    if 'new_facility' not in production_scenario_records:
                        production_scenario_records['new_facility'] = {'locations': [], 'afko': []}
                    production_scenario_records['new_facility']['locations'].append(new_location)
                    production_scenario_records['new_facility']['afko'].extend(new_afko)

                    scenario_metadata.append({
                        "scenario_id": "SCN018",
                        "scenario_type": "PRODUCTION",
                        "description": PRODUCTION_SCENARIO_DEFINITIONS["SCN018"]["description"],
                        "mvmt_type": "N/A",
                        "material": "ALL",
                        "plant": config["new_plant"],
                        "storage_loc": None,
                        "dest_loc": None,
                        "quantity": None,
                        "downtime_days": config["ramp_weeks"] * 7,
                        "recovery_date": None,
                        "demand_increase_pct": None,
                        "demand_type": "CAPACITY_RAMP",
                        "injected_at": datetime.now()
                    })
                    production_scenarios_injected += 1
                except Exception as e:
                    print(f"    Warning: SCN018 failed - {e}")

        if SCN014_ENABLED:
            config = parse_production_config(SCN014_CONFIG, scenario_type="limited_capacity")
            if config:
                print(f"\n  Injecting SCN014 (Limited Capacity):")
                print(f"    Plant: {config['plant']}, Capacity: {config['capacity_pct']}%")
                print(f"    Duration: {config['duration_days']} days")

                try:
                    df_afko = wh.read("afko")
                    df_mara = wh.read("mara")

                    capacity_afko = inject_limited_capacity(
                        "SCN014", config, df_afko, df_mara
                    )

                    if 'afko' not in production_scenario_records:
                        production_scenario_records['afko'] = []
                    production_scenario_records['afko'].extend(capacity_afko)

                    scenario_metadata.append({
                        "scenario_id": "SCN014",
                        "scenario_type": "PRODUCTION",
                        "description": PRODUCTION_SCENARIO_DEFINITIONS["SCN014"]["description"],
                        "mvmt_type": "N/A",
                        "material": "ALL",
                        "plant": config["plant"],
                        "storage_loc": None,
                        "dest_loc": None,
                        "quantity": None,
                        "downtime_days": config["duration_days"],
                        "recovery_date": None,
                        "demand_increase_pct": config["capacity_pct"],
                        "demand_type": "CAPACITY_CONSTRAINT",
                        "injected_at": datetime.now()
                    })
                    production_scenarios_injected += 1
                    print(f"    Created {len(capacity_afko)} production orders to saturate capacity")
                except Exception as e:
                    print(f"    Warning: SCN014 failed - {e}")

        if SCN016_ENABLED:
            config = parse_production_config(SCN016_CONFIG, scenario_type="competing_production")
            if config:
                print(f"\n  Injecting SCN016 (Competing Production):")
                print(f"    Plant: {config['plant']}, Materials: {config['materials']}")
                print(f"    Contention: {config['contention_pct']}%")

                try:
                    df_afko = wh.read("afko")

                    competing_afko, competing_vbak, competing_vbap, competing_vbep = inject_competing_production(
                        "SCN016", config, df_afko, df_vbak, df_kna1
                    )

                    if 'afko' not in production_scenario_records:
                        production_scenario_records['afko'] = []
                    production_scenario_records['afko'].extend(competing_afko)
                    production_scenario_records['vbak'].extend(competing_vbak)
                    production_scenario_records['vbap'].extend(competing_vbap)
                    production_scenario_records['vbep'].extend(competing_vbep)

                    scenario_metadata.append({
                        "scenario_id": "SCN016",
                        "scenario_type": "PRODUCTION",
                        "description": PRODUCTION_SCENARIO_DEFINITIONS["SCN016"]["description"],
                        "mvmt_type": "N/A",
                        "material": ",".join(config["materials"]),
                        "plant": config["plant"],
                        "storage_loc": None,
                        "dest_loc": None,
                        "quantity": None,
                        "downtime_days": None,
                        "recovery_date": None,
                        "demand_increase_pct": config["contention_pct"],
                        "demand_type": "RESOURCE_CONTENTION",
                        "injected_at": datetime.now()
                    })
                    production_scenarios_injected += 1
                    print(f"    Created {len(competing_afko)} overlapping production orders")
                    print(f"    Created {len(competing_vbak)} competing sales orders")
                except Exception as e:
                    print(f"    Warning: SCN016 failed - {e}")

        if SCN020_ENABLED:
            config = parse_production_config(SCN020_CONFIG, scenario_type="high_volatility")
            if config:
                print(f"\n  Injecting SCN020 (High Volatility):")
                print(f"    Volatility: {config['volatility_pct']}%, Duration: {config['duration_days']} days")

                try:
                    df_mara = wh.read("mara")

                    volatility_vbak, volatility_vbap, volatility_vbep = inject_high_volatility(
                        "SCN020", config, df_vbak, df_vbap, df_vbep, df_kna1, df_mara
                    )

                    production_scenario_records['vbak'].extend(volatility_vbak)
                    production_scenario_records['vbap'].extend(volatility_vbap)
                    production_scenario_records['vbep'].extend(volatility_vbep)

                    scenario_metadata.append({
                        "scenario_id": "SCN020",
                        "scenario_type": "PRODUCTION",
                        "description": PRODUCTION_SCENARIO_DEFINITIONS["SCN020"]["description"],
                        "mvmt_type": "N/A",
                        "material": "NETWORK-WIDE",
                        "plant": "ALL",
                        "storage_loc": None,
                        "dest_loc": None,
                        "quantity": None,
                        "downtime_days": config["duration_days"],
                        "recovery_date": None,
                        "demand_increase_pct": config["volatility_pct"],
                        "demand_type": "VOLATILITY",
                        "injected_at": datetime.now()
                    })
                    production_scenarios_injected += 1
                    print(f"    Created {len(volatility_vbak)} high-volatility sales orders")
                except Exception as e:
                    print(f"    Warning: SCN020 failed - {e}")


    supplier_scenarios_injected = 0

    if supplier_scenarios_enabled and df_ekbe is not None:
        print("\n--- Processing Supplier Scenarios ---")

        if SCN021_ENABLED:
            config = parse_supplier_config(SCN021_CONFIG, scenario_type="standard")
            if config:
                df_ekbe = inject_supplier_performance(df_ekbe, "SCN021", config, SUPPLIER_SCENARIO_DEFINITIONS["SCN021"])
                scenario_metadata.append({
                    "scenario_id": "SCN021",
                    "scenario_type": "SUPPLIER",
                    "description": SUPPLIER_SCENARIO_DEFINITIONS["SCN021"]["description"],
                    "mvmt_type": "N/A",
                    "material": config.get("material", "ALL"),
                    "plant": "N/A",
                    "storage_loc": None,
                    "dest_loc": None,
                    "quantity": None,
                    "downtime_days": None,
                    "recovery_date": None,
                    "vendor": config["vendor"],
                    "target_otif": config["target_otif"],
                    "injected_at": datetime.now()
                })
                supplier_scenarios_injected += 1

        if SCN022_ENABLED:
            config = parse_supplier_config(SCN022_CONFIG, scenario_type="standard")
            if config:
                df_ekbe = inject_supplier_performance(df_ekbe, "SCN022", config, SUPPLIER_SCENARIO_DEFINITIONS["SCN022"])
                scenario_metadata.append({
                    "scenario_id": "SCN022",
                    "scenario_type": "SUPPLIER",
                    "description": SUPPLIER_SCENARIO_DEFINITIONS["SCN022"]["description"],
                    "mvmt_type": "N/A",
                    "material": config.get("material", "ALL"),
                    "plant": "N/A",
                    "storage_loc": None,
                    "dest_loc": None,
                    "quantity": None,
                    "downtime_days": None,
                    "recovery_date": None,
                    "vendor": config["vendor"],
                    "target_otif": config["target_otif"],
                    "injected_at": datetime.now()
                })
                supplier_scenarios_injected += 1

        if SCN023_ENABLED:
            config = parse_supplier_config(SCN023_CONFIG, scenario_type="fda")
            if config:
                print(f"\n  Injecting SCN023 (FDA 483):")
                print(f"    Vendor: {config['vendor']}")
                print(f"    Material: {config['material']}")
                print(f"    Action: Flagged for review (no OTIF impact)")
                scenario_metadata.append({
                    "scenario_id": "SCN023",
                    "scenario_type": "SUPPLIER",
                    "description": SUPPLIER_SCENARIO_DEFINITIONS["SCN023"]["description"],
                    "mvmt_type": "N/A",
                    "material": config.get("material", "ALL"),
                    "plant": "N/A",
                    "storage_loc": None,
                    "dest_loc": None,
                    "quantity": None,
                    "downtime_days": None,
                    "recovery_date": None,
                    "vendor": config["vendor"],
                    "target_otif": 0.95,
                    "injected_at": datetime.now()
                })
                supplier_scenarios_injected += 1

        if SCN024_ENABLED:
            config = parse_supplier_config(SCN024_CONFIG, scenario_type="standard")
            if config:
                df_ekbe = inject_supplier_performance(df_ekbe, "SCN024", config, SUPPLIER_SCENARIO_DEFINITIONS["SCN024"])
                scenario_metadata.append({
                    "scenario_id": "SCN024",
                    "scenario_type": "SUPPLIER",
                    "description": SUPPLIER_SCENARIO_DEFINITIONS["SCN024"]["description"],
                    "mvmt_type": "N/A",
                    "material": config.get("material", "ALL"),
                    "plant": "N/A",
                    "storage_loc": None,
                    "dest_loc": None,
                    "quantity": None,
                    "downtime_days": None,
                    "recovery_date": None,
                    "vendor": config["vendor"],
                    "target_otif": config["target_otif"],
                    "injected_at": datetime.now()
                })
                supplier_scenarios_injected += 1

        if SCN025_ENABLED:
            config = parse_supplier_config(SCN025_CONFIG, scenario_type="standard")
            if config:
                df_ekbe = inject_supplier_performance(df_ekbe, "SCN025", config, SUPPLIER_SCENARIO_DEFINITIONS["SCN025"])
                scenario_metadata.append({
                    "scenario_id": "SCN025",
                    "scenario_type": "SUPPLIER",
                    "description": SUPPLIER_SCENARIO_DEFINITIONS["SCN025"]["description"],
                    "mvmt_type": "N/A",
                    "material": config.get("material", "ALL"),
                    "plant": "N/A",
                    "storage_loc": None,
                    "dest_loc": None,
                    "quantity": None,
                    "downtime_days": None,
                    "recovery_date": None,
                    "vendor": config["vendor"],
                    "target_otif": config["target_otif"],
                    "injected_at": datetime.now()
                })
                supplier_scenarios_injected += 1

        if SCN026_ENABLED:
            config = parse_supplier_config(SCN026_CONFIG, scenario_type="standard")
            if config:
                df_ekbe = inject_supplier_performance(df_ekbe, "SCN026", config, SUPPLIER_SCENARIO_DEFINITIONS["SCN026"])
                scenario_metadata.append({
                    "scenario_id": "SCN026",
                    "scenario_type": "SUPPLIER",
                    "description": SUPPLIER_SCENARIO_DEFINITIONS["SCN026"]["description"],
                    "mvmt_type": "N/A",
                    "material": config.get("material", "ALL"),
                    "plant": "N/A",
                    "storage_loc": None,
                    "dest_loc": None,
                    "quantity": None,
                    "downtime_days": None,
                    "recovery_date": None,
                    "vendor": config["vendor"],
                    "target_otif": config["target_otif"],
                    "injected_at": datetime.now()
                })
                supplier_scenarios_injected += 1


    inventory_changes = all_scenario_records or blocked_matdoc_ids
    supplier_changes = supplier_scenarios_injected > 0
    production_changes = production_scenarios_injected > 0

    if inventory_changes or supplier_changes or production_changes:
        if inventory_changes:
            print(f"\nApplying {len(all_scenario_records)} scenario MATDOC records...")

            if blocked_matdoc_ids:
                print(f"Removing {len(blocked_matdoc_ids)} blocked transactions during fire downtime...")
                df_matdoc = df_matdoc[~df_matdoc['MBLNR'].isin(blocked_matdoc_ids)]

            df_scenario_matdoc = pd.DataFrame(all_scenario_records)
            df_matdoc_updated = pd.concat([df_matdoc, df_scenario_matdoc], ignore_index=True)

            print("Updating MARD inventory levels...")
            df_mard_updated = update_mard_for_scenario(df_mard, all_scenario_records)

            print("Loading related tables (LIPS, LIKP, VBFA) for cascade...")
            try:
                df_lips = wh.read("lips")
                df_likp = wh.read("likp")
                df_vbfa = wh.read("vbfa")
            except Exception as e:
                print(f"  Warning: Could not load some tables for cascade: {e}")
                df_lips = None
                df_likp = None
                df_vbfa = None

            print("Adjusting goods issues to prevent negative inventory...")
            df_matdoc_updated, df_lips_updated, df_likp_updated, df_vbfa_updated = adjust_goods_issues_for_scenario(
                df_matdoc_updated, all_scenario_records, df_mard_updated, df_lips, df_likp, df_vbfa
            )

            print("Regenerating MARDH...")
            df_mardh_updated = generate_mardh(df_matdoc_updated, df_mard_updated)

            print("\nSaving updated inventory tables...")
            save_sap_table(df_matdoc_updated, "matdoc", wh)
            save_sap_table(df_mard_updated, "mard", wh)
            save_sap_table(df_mardh_updated, "mardh", wh)

            if df_lips_updated is not None:
                save_sap_table(df_lips_updated, "lips", wh)
                print("  Saved updated LIPS")
            if df_likp_updated is not None:
                save_sap_table(df_likp_updated, "likp", wh)
                print("  Saved updated LIKP")
            if df_vbfa_updated is not None:
                save_sap_table(df_vbfa_updated, "vbfa", wh)
                print("  Saved updated VBFA")

        if supplier_changes and df_ekbe is not None:
            print("\nSaving updated supplier tables...")
            save_sap_table(df_ekbe, "ekbe", wh)

        scenario_protection_records = []

        if production_changes and df_vbak is not None:
            print("\nSaving updated production/sales tables...")

            if production_scenario_records["vbak"]:
                df_new_vbak = pd.DataFrame(production_scenario_records["vbak"])
                df_vbak_updated = pd.concat([df_vbak, df_new_vbak], ignore_index=True)
                save_sap_table(df_vbak_updated, "vbak", wh)
                scenario_protection_records += [("vbak", "VBELN", str(v)) for v in df_new_vbak["VBELN"].unique()]
                print(f"  Added {len(df_new_vbak)} new VBAK records")

            if production_scenario_records["vbap"]:
                df_new_vbap = pd.DataFrame(production_scenario_records["vbap"])
                df_vbap_updated = pd.concat([df_vbap, df_new_vbap], ignore_index=True)
                save_sap_table(df_vbap_updated, "vbap", wh)
                scenario_protection_records += [("vbap", "VBELN", str(v)) for v in df_new_vbap["VBELN"].unique()]
                print(f"  Added {len(df_new_vbap)} new VBAP records")

            if production_scenario_records["vbep"]:
                df_new_vbep = pd.DataFrame(production_scenario_records["vbep"])
                df_vbep_updated = pd.concat([df_vbep, df_new_vbep], ignore_index=True)
                save_sap_table(df_vbep_updated, "vbep", wh)
                scenario_protection_records += [("vbep", "VBELN", str(v)) for v in df_new_vbep["VBELN"].unique()]
                print(f"  Added {len(df_new_vbep)} new VBEP records")

            if 'master_data' in production_scenario_records:
                md = production_scenario_records['master_data']
                if md.get('mara'):
                    df_mara = wh.read("mara")
                    df_mara_updated = pd.concat([df_mara, pd.DataFrame(md['mara'])], ignore_index=True)
                    save_sap_table(df_mara_updated, "mara", wh)
                    scenario_protection_records += [("mara", "MATNR", str(r["MATNR"])) for r in md["mara"]]
                    print(f"  Added {len(md['mara'])} new MARA records (SCN012)")
                if md.get('makt'):
                    df_makt = wh.read("makt")
                    df_makt_updated = pd.concat([df_makt, pd.DataFrame(md['makt'])], ignore_index=True)
                    save_sap_table(df_makt_updated, "makt", wh)
                    scenario_protection_records += [("makt", "MATNR", str(r["MATNR"])) for r in md["makt"]]
                    print(f"  Added {len(md['makt'])} new MAKT records (SCN012)")
                if md.get('marc'):
                    df_marc = wh.read("marc")
                    df_marc_updated = pd.concat([df_marc, pd.DataFrame(md['marc'])], ignore_index=True)
                    save_sap_table(df_marc_updated, "marc", wh)
                    scenario_protection_records += [("marc", "MATNR", str(r["MATNR"])) for r in md["marc"]]
                    print(f"  Added {len(md['marc'])} new MARC records (SCN012)")
                if md.get('mast'):
                    df_mast = wh.read("mast")
                    df_mast_updated = pd.concat([df_mast, pd.DataFrame(md['mast'])], ignore_index=True)
                    save_sap_table(df_mast_updated, "mast", wh)
                    scenario_protection_records += [("mast", "MATNR", str(r["MATNR"])) for r in md["mast"]]
                    print(f"  Added {len(md['mast'])} new MAST records (SCN012)")
                if md.get('stpo'):
                    df_stpo = wh.read("stpo")
                    df_stpo_updated = pd.concat([df_stpo, pd.DataFrame(md['stpo'])], ignore_index=True)
                    save_sap_table(df_stpo_updated, "stpo", wh)
                    scenario_protection_records += [("stpo", "STLNR", str(r["STLNR"])) for r in md["stpo"]]
                    print(f"  Added {len(md['stpo'])} new STPO records (SCN012)")

            if 'afko' in production_scenario_records and production_scenario_records['afko']:
                df_new_afko = pd.DataFrame(production_scenario_records['afko'])
                df_afko = wh.read("afko")
                df_afko_updated = pd.concat([df_afko, df_new_afko], ignore_index=True)
                if 'PLNBEZ' in df_afko_updated.columns and 'MATNR' in df_afko_updated.columns:
                    df_afko_updated['PLNBEZ'] = df_afko_updated['PLNBEZ'].fillna(df_afko_updated['MATNR'])
                save_sap_table(df_afko_updated, "afko", wh)
                print(f"  Added {len(df_new_afko)} new AFKO production orders (SCN014/SCN016)")

            if 'afko_changes' in production_scenario_records:
                changes = production_scenario_records['afko_changes']
                df_afko = wh.read("afko")

                if changes.get('cancelled'):
                    df_afko.loc[df_afko['AUFNR'].isin(changes['cancelled']), 'STAT'] = 'DLFL'
                    print(f"  Cancelled {len(changes['cancelled'])} AFKO orders (SCN015)")

                if changes.get('rescheduled'):
                    for resc in changes['rescheduled']:
                        mask = df_afko['AUFNR'] == resc['AUFNR']
                        for col in ['GSTRP', 'GLTRP', 'STAT']:
                            if col in resc:
                                df_afko.loc[mask, col] = resc[col]
                    print(f"  Rescheduled {len(changes['rescheduled'])} AFKO orders (SCN015)")

                if 'PLNBEZ' in df_afko.columns and 'MATNR' in df_afko.columns:
                    df_afko['PLNBEZ'] = df_afko['PLNBEZ'].fillna(df_afko['MATNR'])
                save_sap_table(df_afko, "afko", wh)

            if 'likp_blocks' in production_scenario_records:
                blocked = production_scenario_records['likp_blocks']
                if blocked:
                    df_likp = wh.read("likp")
                    df_likp.loc[df_likp['VBELN'].isin(blocked), 'LIFSK'] = '01'  # Delivery block
                    save_sap_table(df_likp, "likp", wh)
                    print(f"  Blocked {len(blocked)} deliveries in LIKP (SCN017)")

            if 'new_facility' in production_scenario_records:
                nf = production_scenario_records['new_facility']
                if nf.get('locations'):
                    df_loc = wh.read("sapapo_loc")
                    df_loc_updated = pd.concat([df_loc, pd.DataFrame(nf['locations'])], ignore_index=True)
                    save_sap_table(df_loc_updated, "sapapo_loc", wh)
                    print(f"  Added {len(nf['locations'])} new location(s) (SCN018)")
                if nf.get('afko'):
                    df_afko = wh.read("afko")
                    df_afko_updated = pd.concat([df_afko, pd.DataFrame(nf['afko'])], ignore_index=True)
                    if 'PLNBEZ' in df_afko_updated.columns and 'MATNR' in df_afko_updated.columns:
                        df_afko_updated['PLNBEZ'] = df_afko_updated['PLNBEZ'].fillna(df_afko_updated['MATNR'])
                    save_sap_table(df_afko_updated, "afko", wh)
                    print(f"  Added {len(nf['afko'])} ramping production orders (SCN018)")

        if scenario_protection_records:
            df_protection = pd.DataFrame(
                scenario_protection_records,
                columns=["TABLE_NAME", "KEY_COLUMN", "KEY_VALUE"],
            ).drop_duplicates().reset_index(drop=True)
            wh.save("scenario_protection", df_protection)
            print(f"  Saved {len(df_protection)} scenario protection keys")

        print("Saving scenario metadata...")

        normalized_metadata = []
        for meta in scenario_metadata:
            normalized = {
                "scenario_id": meta.get("scenario_id", ""),
                "scenario_type": meta.get("scenario_type", "INVENTORY"),
                "description": meta.get("description", ""),
                "mvmt_type": meta.get("mvmt_type", ""),
                "material": meta.get("material", ""),
                "plant": meta.get("plant", ""),
                "storage_loc": meta.get("storage_loc"),
                "dest_loc": meta.get("dest_loc"),
                "quantity": meta.get("quantity"),
                "downtime_days": meta.get("downtime_days"),
                "recovery_date": meta.get("recovery_date"),
                "vendor": meta.get("vendor"),
                "target_otif": meta.get("target_otif"),
                "demand_increase_pct": meta.get("demand_increase_pct"),
                "demand_type": meta.get("demand_type"),
                "injected_at": meta.get("injected_at", datetime.now()),
            }
            normalized_metadata.append(normalized)

        metadata_columns = [
            "scenario_id",
            "scenario_type",
            "description",
            "mvmt_type",
            "material",
            "plant",
            "storage_loc",
            "dest_loc",
            "quantity",
            "downtime_days",
            "recovery_date",
            "vendor",
            "target_otif",
            "demand_increase_pct",
            "demand_type",
            "injected_at",
        ]
        df_metadata = pd.DataFrame(normalized_metadata, columns=metadata_columns)
        df_metadata = df_metadata.astype({
            "scenario_id": "string",
            "scenario_type": "string",
            "description": "string",
            "mvmt_type": "string",
            "material": "string",
            "plant": "string",
            "storage_loc": "string",
            "dest_loc": "string",
            "quantity": "float64",
            "downtime_days": "Int32",
            "recovery_date": "string",
            "vendor": "string",
            "target_otif": "float64",
            "demand_increase_pct": "Int32",
            "demand_type": "string",
        })
        df_metadata["injected_at"] = pd.to_datetime(df_metadata["injected_at"])
        metadata_table = "scenario_metadata"
        wh.save(metadata_table, df_metadata.reset_index(drop=True))

        print(f"\n{'='*60}")
        print(f"SCENARIO INJECTION COMPLETE")
        if inventory_changes:
            print(f"  Inventory scenarios: {len(all_scenario_records)} MATDOC records")
            if blocked_matdoc_ids:
                print(f"  Blocked transactions: {len(blocked_matdoc_ids)}")
        if supplier_changes:
            print(f"  Supplier scenarios: {supplier_scenarios_injected}")
        print(f"  Total scenarios: {len(scenario_metadata)}")
        print(f"  Metadata saved to: {metadata_table}")
        print(f"{'='*60}")

    else:
        print("No scenario records generated. Check configurations.")
