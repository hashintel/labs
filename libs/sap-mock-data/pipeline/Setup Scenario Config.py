# Databricks notebook source
# Setup Scenario Configuration Table
# Creates a table of scenario parameters for AI agent reasoning

dbutils.widgets.text("CATALOG", "sample_synthetic_sap", "Catalog Name")
dbutils.widgets.text("SCHEMA", "sap", "Schema Name")

CATALOG = dbutils.widgets.get("CATALOG")
SCHEMA = dbutils.widgets.get("SCHEMA")

print(f"Setting up scenario config in {CATALOG}.{SCHEMA}")

# COMMAND ----------

from pyspark.sql.types import StructType, StructField, StringType, BooleanType, IntegerType
from datetime import datetime

# Scenario Configuration
# Each row defines the parameters for a specific supply chain disruption scenario

scenarios = [
    # ==========================================================================
    # INVENTORY/NODE SCENARIOS (SCN001-SCN010)
    # ==========================================================================
    {
        "SCENARIO_ID": "SCN001",
        "SCENARIO_NAME": "Stock Deviation",
        "SCENARIO_TYPE": "INVENTORY",
        "DESCRIPTION": "A batch deviation impacts inventory at the Manufacturing site (1000) - removes a particular batch of one product permanently",
        "IMPACTED_NODE": "1000",
        "IMPACTED_PRODUCTS": "MAT-A0008",
        "IMPACTED_BATCH": "BATCH-2025-001",
        "NODE_OFFLINE": False,
        "NODE_CAPACITY_PCT": 100,
        "INVENTORY_IMPACT": "REMOVE",
        "INVENTORY_QTY": "500",
        "QUARANTINE_SLOC": "",
        "IMPACT_PERMANENT": True,
        "IMPACT_DATE": "20250615",
        "IMPACT_DURATION_DAYS": 0,
        "TLANES_AFFECTED": False,
        "ALT_LINE_SAME_LOCATION": False,
        "IMPACTED_SUPPLIER": "",
        "SUPPLIER_ISSUE": "",
        "METRIC_TREND": "",
        "CURRENT_RELIABILITY": "",
        "ALTERNATE_SUPPLIERS_AVAILABLE": False,
        "REVIEW_REQUIRED": False,
        # Production/Planning fields (not applicable for inventory scenarios)
        "DEMAND_CHANGE_PCT": 0,
        "DEMAND_CHANGE_TYPE": "NONE",
        "NEW_PRODUCT_ID": "",
        "CAPACITY_CONSTRAINT": "",
        "COMPETING_PRODUCTS": "",
        "REGULATORY_EVENT": "",
        "NEW_FACILITY": "",
        "NETWORK_VOLATILITY": "LOW",
        "AI_DECISION_OPTIONS": "Accept loss|Expedite production|Source from alternate supplier|Reallocate from other products",
        "DATA_EVIDENCE": "inventory_impacted.csv: Filter Product_Code=MAT-A0008, Location=1000 to see affected stock | supply_network.csv: Location_ID=1000 shows Node_Status=IMPACTED | matdoc table: MBLNR starting with SCN001 contains the 344 adjustment movement"
    },
    {
        "SCENARIO_ID": "SCN002",
        "SCENARIO_NAME": "Contamination",
        "SCENARIO_TYPE": "INVENTORY",
        "DESCRIPTION": "A contamination impacts inventory for one product across ALL locations - removes all batches permanently",
        "IMPACTED_NODE": "ALL",
        "IMPACTED_PRODUCTS": "MAT-A0005",
        "IMPACTED_BATCH": "ALL",
        "NODE_OFFLINE": False,
        "NODE_CAPACITY_PCT": 100,
        "INVENTORY_IMPACT": "REMOVE",
        "INVENTORY_QTY": "ALL",
        "QUARANTINE_SLOC": "",
        "IMPACT_PERMANENT": True,
        "IMPACT_DATE": "20250615",
        "IMPACT_DURATION_DAYS": 0,
        "TLANES_AFFECTED": False,
        "ALT_LINE_SAME_LOCATION": False,
        "IMPACTED_SUPPLIER": "",
        "SUPPLIER_ISSUE": "",
        "METRIC_TREND": "",
        "CURRENT_RELIABILITY": "",
        "ALTERNATE_SUPPLIERS_AVAILABLE": False,
        "REVIEW_REQUIRED": False,
        "DEMAND_CHANGE_PCT": 0,
        "DEMAND_CHANGE_TYPE": "NONE",
        "NEW_PRODUCT_ID": "",
        "CAPACITY_CONSTRAINT": "",
        "COMPETING_PRODUCTS": "",
        "REGULATORY_EVENT": "",
        "NEW_FACILITY": "",
        "NETWORK_VOLATILITY": "LOW",
        "AI_DECISION_OPTIONS": "Accept loss|Emergency production|Source from alternate supplier|Customer order reallocation",
        "DATA_EVIDENCE": "inventory_impacted.csv: Filter Product_Code=MAT-A0005 across ALL locations to see contaminated stock | inventory_other.csv: Empty for this product (all contaminated) | matdoc table: MBLNR starting with SCN002 contains the 551 scrap movements"
    },
    {
        "SCENARIO_ID": "SCN003",
        "SCENARIO_NAME": "Fire Damage",
        "SCENARIO_TYPE": "INVENTORY",
        "DESCRIPTION": "A fire removes ALL inventory (all products, all batches) at one location and takes the node offline temporarily",
        "IMPACTED_NODE": "2000",
        "IMPACTED_PRODUCTS": "ALL",
        "IMPACTED_BATCH": "ALL",
        "NODE_OFFLINE": True,
        "NODE_CAPACITY_PCT": 0,
        "INVENTORY_IMPACT": "REMOVE",
        "INVENTORY_QTY": "ALL",
        "QUARANTINE_SLOC": "",
        "IMPACT_PERMANENT": False,
        "IMPACT_DATE": "20250615",
        "IMPACT_DURATION_DAYS": 30,
        "TLANES_AFFECTED": True,
        "ALT_LINE_SAME_LOCATION": False,
        "IMPACTED_SUPPLIER": "",
        "SUPPLIER_ISSUE": "",
        "METRIC_TREND": "",
        "CURRENT_RELIABILITY": "",
        "ALTERNATE_SUPPLIERS_AVAILABLE": False,
        "REVIEW_REQUIRED": False,
        "DEMAND_CHANGE_PCT": 0,
        "DEMAND_CHANGE_TYPE": "NONE",
        "NEW_PRODUCT_ID": "",
        "CAPACITY_CONSTRAINT": "",
        "COMPETING_PRODUCTS": "",
        "REGULATORY_EVENT": "",
        "NEW_FACILITY": "",
        "NETWORK_VOLATILITY": "LOW",
        "AI_DECISION_OPTIONS": "Reroute through alternate node|Direct ship from hub|Delay customer orders|Split shipments",
        "DATA_EVIDENCE": "supply_network.csv: Location_ID=2000 shows Node_Status=OFFLINE, Node_Capacity_Pct=0 | transportation_lanes.csv: Lanes to/from 2000 show Lane_Status=BLOCKED | inventory_impacted.csv: ALL products at Location=2000 destroyed | matdoc table: SCN003 records with BWART=551"
    },
    {
        "SCENARIO_ID": "SCN004",
        "SCENARIO_NAME": "Production Shutdown 1",
        "SCENARIO_TYPE": "INVENTORY",
        "DESCRIPTION": "Production shutdown takes manufacturing offline temporarily but inventory remains accessible",
        "IMPACTED_NODE": "1000",
        "IMPACTED_PRODUCTS": "ALL",
        "IMPACTED_BATCH": "N/A",
        "NODE_OFFLINE": True,
        "NODE_CAPACITY_PCT": 0,
        "INVENTORY_IMPACT": "NONE",
        "INVENTORY_QTY": "0",
        "QUARANTINE_SLOC": "",
        "IMPACT_PERMANENT": False,
        "IMPACT_DATE": "20250615",
        "IMPACT_DURATION_DAYS": 14,
        "TLANES_AFFECTED": True,
        "ALT_LINE_SAME_LOCATION": False,
        "IMPACTED_SUPPLIER": "",
        "SUPPLIER_ISSUE": "",
        "METRIC_TREND": "",
        "CURRENT_RELIABILITY": "",
        "ALTERNATE_SUPPLIERS_AVAILABLE": False,
        "REVIEW_REQUIRED": False,
        "DEMAND_CHANGE_PCT": 0,
        "DEMAND_CHANGE_TYPE": "NONE",
        "NEW_PRODUCT_ID": "",
        "CAPACITY_CONSTRAINT": "",
        "COMPETING_PRODUCTS": "",
        "REGULATORY_EVENT": "",
        "NEW_FACILITY": "",
        "NETWORK_VOLATILITY": "LOW",
        "AI_DECISION_OPTIONS": "Use existing inventory|Delay production orders|Source from alternate supplier|Prioritize critical customers",
        "DATA_EVIDENCE": "supply_network.csv: Location_ID=1000 shows Node_Status=OFFLINE, Transport_Lanes_Blocked=YES | transportation_lanes.csv: Lanes to/from 1000 show Lane_Status=BLOCKED | production_orders.csv: Orders at Plant=1000 affected | inventory remains accessible (no MATDOC impact)"
    },
    {
        "SCENARIO_ID": "SCN005",
        "SCENARIO_NAME": "Batch Quarantine 1",
        "SCENARIO_TYPE": "INVENTORY",
        "DESCRIPTION": "A quarantine moves inventory for one batch at manufacturing location to quarantine storage (QA01) - not usable until released",
        "IMPACTED_NODE": "1000",
        "IMPACTED_PRODUCTS": "MAT-A0010",
        "IMPACTED_BATCH": "BATCH-2025-005",
        "NODE_OFFLINE": False,
        "NODE_CAPACITY_PCT": 100,
        "INVENTORY_IMPACT": "QUARANTINE",
        "INVENTORY_QTY": "300",
        "QUARANTINE_SLOC": "QA01",
        "IMPACT_PERMANENT": False,
        "IMPACT_DATE": "20250615",
        "IMPACT_DURATION_DAYS": 21,
        "TLANES_AFFECTED": False,
        "ALT_LINE_SAME_LOCATION": False,
        "IMPACTED_SUPPLIER": "",
        "SUPPLIER_ISSUE": "",
        "METRIC_TREND": "",
        "CURRENT_RELIABILITY": "",
        "ALTERNATE_SUPPLIERS_AVAILABLE": False,
        "REVIEW_REQUIRED": False,
        "DEMAND_CHANGE_PCT": 0,
        "DEMAND_CHANGE_TYPE": "NONE",
        "NEW_PRODUCT_ID": "",
        "CAPACITY_CONSTRAINT": "",
        "COMPETING_PRODUCTS": "",
        "REGULATORY_EVENT": "",
        "NEW_FACILITY": "",
        "NETWORK_VOLATILITY": "LOW",
        "AI_DECISION_OPTIONS": "Wait for release|Use alternate batch|Expedite testing|Reallocate orders",
        "DATA_EVIDENCE": "inventory_impacted.csv: Product_Code=MAT-A0010 at Location=1000 shows quarantined quantity | mard table: LGORT=QA01 contains quarantined stock | matdoc table: SCN005 records with BWART=311 (transfer to QA01)"
    },
    {
        "SCENARIO_ID": "SCN006",
        "SCENARIO_NAME": "Batch Quarantine 2",
        "SCENARIO_TYPE": "INVENTORY",
        "DESCRIPTION": "A quarantine moves inventory for one product (all batches) across ALL locations to quarantine storage (QA01) - not usable until released",
        "IMPACTED_NODE": "ALL",
        "IMPACTED_PRODUCTS": "MAT-A0012",
        "IMPACTED_BATCH": "ALL",
        "NODE_OFFLINE": False,
        "NODE_CAPACITY_PCT": 100,
        "INVENTORY_IMPACT": "QUARANTINE",
        "INVENTORY_QTY": "ALL",
        "QUARANTINE_SLOC": "QA01",
        "IMPACT_PERMANENT": False,
        "IMPACT_DATE": "20250615",
        "IMPACT_DURATION_DAYS": 21,
        "TLANES_AFFECTED": False,
        "ALT_LINE_SAME_LOCATION": False,
        "IMPACTED_SUPPLIER": "",
        "SUPPLIER_ISSUE": "",
        "METRIC_TREND": "",
        "CURRENT_RELIABILITY": "",
        "ALTERNATE_SUPPLIERS_AVAILABLE": False,
        "REVIEW_REQUIRED": False,
        "DEMAND_CHANGE_PCT": 0,
        "DEMAND_CHANGE_TYPE": "NONE",
        "NEW_PRODUCT_ID": "",
        "CAPACITY_CONSTRAINT": "",
        "COMPETING_PRODUCTS": "",
        "REGULATORY_EVENT": "",
        "NEW_FACILITY": "",
        "NETWORK_VOLATILITY": "LOW",
        "AI_DECISION_OPTIONS": "Wait for release|Emergency production of alternate|Source from alternate supplier|Customer communication",
        "DATA_EVIDENCE": "inventory_impacted.csv: Product_Code=MAT-A0012 across ALL locations shows quarantined quantity | mard table: LGORT=QA01 at all plants contains quarantined stock | matdoc table: SCN006 records with BWART=311 (transfer to QA01)"
    },
    {
        "SCENARIO_ID": "SCN007",
        "SCENARIO_NAME": "Product Write-off",
        "SCENARIO_TYPE": "INVENTORY",
        "DESCRIPTION": "A write-off permanently removes inventory for one batch at manufacturing location",
        "IMPACTED_NODE": "1000",
        "IMPACTED_PRODUCTS": "MAT-A0015",
        "IMPACTED_BATCH": "BATCH-2025-007",
        "NODE_OFFLINE": False,
        "NODE_CAPACITY_PCT": 100,
        "INVENTORY_IMPACT": "REMOVE",
        "INVENTORY_QTY": "400",
        "QUARANTINE_SLOC": "",
        "IMPACT_PERMANENT": True,
        "IMPACT_DATE": "20250615",
        "IMPACT_DURATION_DAYS": 0,
        "TLANES_AFFECTED": False,
        "ALT_LINE_SAME_LOCATION": False,
        "IMPACTED_SUPPLIER": "",
        "SUPPLIER_ISSUE": "",
        "METRIC_TREND": "",
        "CURRENT_RELIABILITY": "",
        "ALTERNATE_SUPPLIERS_AVAILABLE": False,
        "REVIEW_REQUIRED": False,
        "DEMAND_CHANGE_PCT": 0,
        "DEMAND_CHANGE_TYPE": "NONE",
        "NEW_PRODUCT_ID": "",
        "CAPACITY_CONSTRAINT": "",
        "COMPETING_PRODUCTS": "",
        "REGULATORY_EVENT": "",
        "NEW_FACILITY": "",
        "NETWORK_VOLATILITY": "LOW",
        "AI_DECISION_OPTIONS": "Accept loss|Expedite replacement production|Source externally|Reallocate customer orders",
        "DATA_EVIDENCE": "inventory_impacted.csv: Product_Code=MAT-A0015 at Location=1000 shows written-off quantity | matdoc table: SCN007 records with BWART=551 (scrap) for the specific batch"
    },
    {
        "SCENARIO_ID": "SCN008",
        "SCENARIO_NAME": "Temperature Issue",
        "SCENARIO_TYPE": "INVENTORY",
        "DESCRIPTION": "A temperature issue permanently damages ALL inventory (all products, all batches) at one spoke location",
        "IMPACTED_NODE": "3000",
        "IMPACTED_PRODUCTS": "ALL",
        "IMPACTED_BATCH": "ALL",
        "NODE_OFFLINE": False,
        "NODE_CAPACITY_PCT": 100,
        "INVENTORY_IMPACT": "REMOVE",
        "INVENTORY_QTY": "ALL",
        "QUARANTINE_SLOC": "",
        "IMPACT_PERMANENT": True,
        "IMPACT_DATE": "20250615",
        "IMPACT_DURATION_DAYS": 0,
        "TLANES_AFFECTED": False,
        "ALT_LINE_SAME_LOCATION": False,
        "IMPACTED_SUPPLIER": "",
        "SUPPLIER_ISSUE": "",
        "METRIC_TREND": "",
        "CURRENT_RELIABILITY": "",
        "ALTERNATE_SUPPLIERS_AVAILABLE": False,
        "REVIEW_REQUIRED": False,
        "DEMAND_CHANGE_PCT": 0,
        "DEMAND_CHANGE_TYPE": "NONE",
        "NEW_PRODUCT_ID": "",
        "CAPACITY_CONSTRAINT": "",
        "COMPETING_PRODUCTS": "",
        "REGULATORY_EVENT": "",
        "NEW_FACILITY": "",
        "NETWORK_VOLATILITY": "LOW",
        "AI_DECISION_OPTIONS": "Replenish from hub|Reroute from other spokes|Delay orders|Split shipments across locations",
        "DATA_EVIDENCE": "supply_network.csv: Location_ID=3000 shows Node_Status=IMPACTED | inventory_impacted.csv: ALL products at Location=3000 destroyed | matdoc table: SCN008 records with BWART=551 (temperature scrap)"
    },
    {
        "SCENARIO_ID": "SCN009",
        "SCENARIO_NAME": "Re-route",
        "SCENARIO_TYPE": "INVENTORY",
        "DESCRIPTION": "A warehouse is taken offline and its inventory (all products, all batches) is moved to quarantine storage (QA01) - requires rerouting through other nodes",
        "IMPACTED_NODE": "4000",
        "IMPACTED_PRODUCTS": "ALL",
        "IMPACTED_BATCH": "ALL",
        "NODE_OFFLINE": True,
        "NODE_CAPACITY_PCT": 0,
        "INVENTORY_IMPACT": "QUARANTINE",
        "INVENTORY_QTY": "ALL",
        "QUARANTINE_SLOC": "QA01",
        "IMPACT_PERMANENT": False,
        "IMPACT_DATE": "20250615",
        "IMPACT_DURATION_DAYS": 14,
        "TLANES_AFFECTED": True,
        "ALT_LINE_SAME_LOCATION": False,
        "IMPACTED_SUPPLIER": "",
        "SUPPLIER_ISSUE": "",
        "METRIC_TREND": "",
        "CURRENT_RELIABILITY": "",
        "ALTERNATE_SUPPLIERS_AVAILABLE": False,
        "REVIEW_REQUIRED": False,
        "DEMAND_CHANGE_PCT": 0,
        "DEMAND_CHANGE_TYPE": "NONE",
        "NEW_PRODUCT_ID": "",
        "CAPACITY_CONSTRAINT": "",
        "COMPETING_PRODUCTS": "",
        "REGULATORY_EVENT": "",
        "NEW_FACILITY": "",
        "NETWORK_VOLATILITY": "LOW",
        "AI_DECISION_OPTIONS": "Reroute through alternate warehouse|Direct ship from hub|Use other spoke inventory|Delay non-critical orders",
        "DATA_EVIDENCE": "supply_network.csv: Location_ID=4000 shows Node_Status=OFFLINE, Transport_Lanes_Blocked=YES | transportation_lanes.csv: Lanes to/from 4000 show Lane_Status=BLOCKED | inventory_impacted.csv: ALL products at Location=4000 quarantined | mard table: LGORT=QA01 at plant 4000"
    },
    {
        "SCENARIO_ID": "SCN010",
        "SCENARIO_NAME": "Production Shutdown 2",
        "SCENARIO_TYPE": "INVENTORY",
        "DESCRIPTION": "One production line at manufacturing location is down but alternative line at SAME location available - runs at 50% capacity",
        "IMPACTED_NODE": "1000",
        "IMPACTED_PRODUCTS": "ALL",
        "IMPACTED_BATCH": "N/A",
        "NODE_OFFLINE": False,
        "NODE_CAPACITY_PCT": 50,
        "INVENTORY_IMPACT": "NONE",
        "INVENTORY_QTY": "0",
        "QUARANTINE_SLOC": "",
        "IMPACT_PERMANENT": False,
        "IMPACT_DATE": "20250615",
        "IMPACT_DURATION_DAYS": 7,
        "TLANES_AFFECTED": False,
        "ALT_LINE_SAME_LOCATION": True,
        "IMPACTED_SUPPLIER": "",
        "SUPPLIER_ISSUE": "",
        "METRIC_TREND": "",
        "CURRENT_RELIABILITY": "",
        "ALTERNATE_SUPPLIERS_AVAILABLE": False,
        "REVIEW_REQUIRED": False,
        "DEMAND_CHANGE_PCT": 0,
        "DEMAND_CHANGE_TYPE": "NONE",
        "NEW_PRODUCT_ID": "",
        "CAPACITY_CONSTRAINT": "",
        "COMPETING_PRODUCTS": "",
        "REGULATORY_EVENT": "",
        "NEW_FACILITY": "",
        "NETWORK_VOLATILITY": "LOW",
        "AI_DECISION_OPTIONS": "Prioritize critical products|Use safety stock|Delay non-critical production|Overtime on remaining line",
        "DATA_EVIDENCE": "supply_network.csv: Location_ID=1000 shows Node_Status=DEGRADED, Node_Capacity_Pct=50 | production_orders.csv: Orders at Plant=1000 may be delayed | No inventory impact - stock remains accessible"
    },
    # ==========================================================================
    # PRODUCTION/PLANNING SCENARIOS (SCN011-SCN020)
    # ==========================================================================
    {
        "SCENARIO_ID": "SCN011",
        "SCENARIO_NAME": "Demand Increase",
        "SCENARIO_TYPE": "PRODUCTION",
        "DESCRIPTION": "Permanent increase in demand - planned issues increase and receipt/production plans need to be increased accordingly",
        "IMPACTED_NODE": "1000",
        "IMPACTED_PRODUCTS": "MAT-A0005",
        "IMPACTED_BATCH": "N/A",
        "NODE_OFFLINE": False,
        "NODE_CAPACITY_PCT": 100,
        "INVENTORY_IMPACT": "NONE",
        "INVENTORY_QTY": "0",
        "QUARANTINE_SLOC": "",
        "IMPACT_PERMANENT": True,
        "IMPACT_DATE": "20250615",
        "IMPACT_DURATION_DAYS": 0,
        "TLANES_AFFECTED": False,
        "ALT_LINE_SAME_LOCATION": False,
        "IMPACTED_SUPPLIER": "",
        "SUPPLIER_ISSUE": "",
        "METRIC_TREND": "",
        "CURRENT_RELIABILITY": "",
        "ALTERNATE_SUPPLIERS_AVAILABLE": False,
        "REVIEW_REQUIRED": False,
        "DEMAND_CHANGE_PCT": 25,
        "DEMAND_CHANGE_TYPE": "PERMANENT",
        "NEW_PRODUCT_ID": "",
        "CAPACITY_CONSTRAINT": "",
        "COMPETING_PRODUCTS": "",
        "REGULATORY_EVENT": "",
        "NEW_FACILITY": "",
        "NETWORK_VOLATILITY": "MEDIUM",
        "AI_DECISION_OPTIONS": "Increase production schedule|Add overtime shifts|Qualify additional capacity|Adjust safety stock targets",
        "DATA_EVIDENCE": "vbak table: Sales orders with BSTNK like 'SCN011-%' (ERNAM=SCENARIO) | vbap table: Order items for MATNR=MAT-A0005, WERKS=1000 showing +25% demand | vbep table: Schedule lines with delivery dates | scenario_metadata table: SCN011 scenario_type=PRODUCTION, demand_type=PERMANENT"
    },
    {
        "SCENARIO_ID": "SCN012",
        "SCENARIO_NAME": "New Product Introduction",
        "SCENARIO_TYPE": "PRODUCTION",
        "DESCRIPTION": "A new product is introduced requiring new BOM setup, production capacity allocation, and supply chain configuration",
        "IMPACTED_NODE": "1000",
        "IMPACTED_PRODUCTS": "MAT-NEW01",
        "IMPACTED_BATCH": "N/A",
        "NODE_OFFLINE": False,
        "NODE_CAPACITY_PCT": 100,
        "INVENTORY_IMPACT": "NONE",
        "INVENTORY_QTY": "0",
        "QUARANTINE_SLOC": "",
        "IMPACT_PERMANENT": True,
        "IMPACT_DATE": "20250701",
        "IMPACT_DURATION_DAYS": 0,
        "TLANES_AFFECTED": False,
        "ALT_LINE_SAME_LOCATION": False,
        "IMPACTED_SUPPLIER": "",
        "SUPPLIER_ISSUE": "",
        "METRIC_TREND": "",
        "CURRENT_RELIABILITY": "",
        "ALTERNATE_SUPPLIERS_AVAILABLE": False,
        "REVIEW_REQUIRED": True,
        "DEMAND_CHANGE_PCT": 0,
        "DEMAND_CHANGE_TYPE": "NEW_PRODUCT",
        "NEW_PRODUCT_ID": "MAT-NEW01",
        "CAPACITY_CONSTRAINT": "Shared line with existing products",
        "COMPETING_PRODUCTS": "MAT-A0005,MAT-A0008",
        "REGULATORY_EVENT": "",
        "NEW_FACILITY": "",
        "NETWORK_VOLATILITY": "MEDIUM",
        "AI_DECISION_OPTIONS": "Dedicate line for NPI|Share capacity with existing products|Outsource initial batches|Phase launch by region",
        "DATA_EVIDENCE": "mara table: New material MATNR=MAT-NEW01 added | makt table: Material description for MAT-NEW01 | marc table: Plant data for MAT-NEW01 at WERKS=1000 | mast/stpo tables: BOM structure for new product | vbak table: Initial orders with BSTNK like 'SCN012-NPI-%' | scenario_metadata table: SCN012 scenario_type=NEW_PRODUCT"
    },
    {
        "SCENARIO_ID": "SCN013",
        "SCENARIO_NAME": "Batch Expedition",
        "SCENARIO_TYPE": "PRODUCTION",
        "DESCRIPTION": "Short-term increase in demand from emergency customer order - production schedules need immediate adjustment",
        "IMPACTED_NODE": "1000",
        "IMPACTED_PRODUCTS": "MAT-A0010",
        "IMPACTED_BATCH": "N/A",
        "NODE_OFFLINE": False,
        "NODE_CAPACITY_PCT": 100,
        "INVENTORY_IMPACT": "NONE",
        "INVENTORY_QTY": "0",
        "QUARANTINE_SLOC": "",
        "IMPACT_PERMANENT": False,
        "IMPACT_DATE": "20250615",
        "IMPACT_DURATION_DAYS": 14,
        "TLANES_AFFECTED": False,
        "ALT_LINE_SAME_LOCATION": False,
        "IMPACTED_SUPPLIER": "",
        "SUPPLIER_ISSUE": "",
        "METRIC_TREND": "",
        "CURRENT_RELIABILITY": "",
        "ALTERNATE_SUPPLIERS_AVAILABLE": False,
        "REVIEW_REQUIRED": False,
        "DEMAND_CHANGE_PCT": 50,
        "DEMAND_CHANGE_TYPE": "EMERGENCY",
        "NEW_PRODUCT_ID": "",
        "CAPACITY_CONSTRAINT": "",
        "COMPETING_PRODUCTS": "",
        "REGULATORY_EVENT": "",
        "NEW_FACILITY": "",
        "NETWORK_VOLATILITY": "HIGH",
        "AI_DECISION_OPTIONS": "Expedite production run|Pull forward scheduled batches|Use safety stock|Negotiate delivery timeline with customer",
        "DATA_EVIDENCE": "vbak table: Emergency order with BSTNK='SCN013-URGENT', AUART='OR' (standard order), ERNAM=EMERGENCY | vbap table: MATNR=MAT-A0010, WERKS=1000 emergency qty | vbep table: Tight delivery window (3-7 days) | scenario_metadata table: SCN013 demand_type=EMERGENCY"
    },
    {
        "SCENARIO_ID": "SCN014",
        "SCENARIO_NAME": "Limited Capacity",
        "SCENARIO_TYPE": "PRODUCTION",
        "DESCRIPTION": "High-value injectable product produced at nearly saturated sterile facility with limited alternatives - capacity is maxed out",
        "IMPACTED_NODE": "1000",
        "IMPACTED_PRODUCTS": "MAT-A0020",
        "IMPACTED_BATCH": "N/A",
        "NODE_OFFLINE": False,
        "NODE_CAPACITY_PCT": 95,
        "INVENTORY_IMPACT": "NONE",
        "INVENTORY_QTY": "0",
        "QUARANTINE_SLOC": "",
        "IMPACT_PERMANENT": True,
        "IMPACT_DATE": "20250615",
        "IMPACT_DURATION_DAYS": 0,
        "TLANES_AFFECTED": False,
        "ALT_LINE_SAME_LOCATION": False,
        "IMPACTED_SUPPLIER": "",
        "SUPPLIER_ISSUE": "",
        "METRIC_TREND": "",
        "CURRENT_RELIABILITY": "",
        "ALTERNATE_SUPPLIERS_AVAILABLE": False,
        "REVIEW_REQUIRED": False,
        "DEMAND_CHANGE_PCT": 0,
        "DEMAND_CHANGE_TYPE": "NONE",
        "NEW_PRODUCT_ID": "",
        "CAPACITY_CONSTRAINT": "Sterile facility at 95% utilization",
        "COMPETING_PRODUCTS": "MAT-A0018,MAT-A0022",
        "REGULATORY_EVENT": "",
        "NEW_FACILITY": "",
        "NETWORK_VOLATILITY": "HIGH",
        "AI_DECISION_OPTIONS": "Prioritize by margin|Prioritize by service level|Qualify CMO for overflow|Invest in capacity expansion",
        "DATA_EVIDENCE": "CONFIG ONLY - No transactional injection | NODE_CAPACITY_PCT=95 (saturated) | CAPACITY_CONSTRAINT describes sterile facility limit | material_master.csv: MAT-A0020 details | production_orders.csv: Current utilization"
    },
    {
        "SCENARIO_ID": "SCN015",
        "SCENARIO_NAME": "Equipment Failure",
        "SCENARIO_TYPE": "PRODUCTION",
        "DESCRIPTION": "Critical equipment fails unexpectedly, forcing resequencing across multiple products sharing the line",
        "IMPACTED_NODE": "1000",
        "IMPACTED_PRODUCTS": "ALL",
        "IMPACTED_BATCH": "N/A",
        "NODE_OFFLINE": False,
        "NODE_CAPACITY_PCT": 60,
        "INVENTORY_IMPACT": "NONE",
        "INVENTORY_QTY": "0",
        "QUARANTINE_SLOC": "",
        "IMPACT_PERMANENT": False,
        "IMPACT_DATE": "20250615",
        "IMPACT_DURATION_DAYS": 21,
        "TLANES_AFFECTED": False,
        "ALT_LINE_SAME_LOCATION": True,
        "IMPACTED_SUPPLIER": "",
        "SUPPLIER_ISSUE": "",
        "METRIC_TREND": "",
        "CURRENT_RELIABILITY": "",
        "ALTERNATE_SUPPLIERS_AVAILABLE": False,
        "REVIEW_REQUIRED": False,
        "DEMAND_CHANGE_PCT": 0,
        "DEMAND_CHANGE_TYPE": "NONE",
        "NEW_PRODUCT_ID": "",
        "CAPACITY_CONSTRAINT": "Filling line down - backup available at reduced speed",
        "COMPETING_PRODUCTS": "MAT-A0005,MAT-A0008,MAT-A0010,MAT-A0012",
        "REGULATORY_EVENT": "",
        "NEW_FACILITY": "",
        "NETWORK_VOLATILITY": "HIGH",
        "AI_DECISION_OPTIONS": "Resequence by criticality|Use backup equipment|Outsource to CMO|Delay non-critical SKUs",
        "DATA_EVIDENCE": "afko table: Production orders at WERKS=1000 with TRMDT after failure date show PLNBEZ field updated (cancelled/rescheduled) | scenario_metadata table: SCN015 scenario_type=DISRUPTION, downtime_days=7, cancel_ratio=0.3 | Some orders cancelled, others rescheduled to after downtime period"
    },
    {
        "SCENARIO_ID": "SCN016",
        "SCENARIO_NAME": "Competing Production",
        "SCENARIO_TYPE": "PRODUCTION",
        "DESCRIPTION": "Several commercial products with different service levels compete for time on the same production line",
        "IMPACTED_NODE": "1000",
        "IMPACTED_PRODUCTS": "MAT-A0005,MAT-A0008,MAT-A0010",
        "IMPACTED_BATCH": "N/A",
        "NODE_OFFLINE": False,
        "NODE_CAPACITY_PCT": 100,
        "INVENTORY_IMPACT": "NONE",
        "INVENTORY_QTY": "0",
        "QUARANTINE_SLOC": "",
        "IMPACT_PERMANENT": True,
        "IMPACT_DATE": "20250615",
        "IMPACT_DURATION_DAYS": 0,
        "TLANES_AFFECTED": False,
        "ALT_LINE_SAME_LOCATION": False,
        "IMPACTED_SUPPLIER": "",
        "SUPPLIER_ISSUE": "",
        "METRIC_TREND": "",
        "CURRENT_RELIABILITY": "",
        "ALTERNATE_SUPPLIERS_AVAILABLE": False,
        "REVIEW_REQUIRED": False,
        "DEMAND_CHANGE_PCT": 0,
        "DEMAND_CHANGE_TYPE": "NONE",
        "NEW_PRODUCT_ID": "",
        "CAPACITY_CONSTRAINT": "Single line shared by 3 products",
        "COMPETING_PRODUCTS": "MAT-A0005,MAT-A0008,MAT-A0010",
        "REGULATORY_EVENT": "",
        "NEW_FACILITY": "",
        "NETWORK_VOLATILITY": "MEDIUM",
        "AI_DECISION_OPTIONS": "Optimize by service level|Optimize by margin|Fixed rotation schedule|Dynamic scheduling based on inventory",
        "DATA_EVIDENCE": "CONFIG ONLY - No transactional injection | COMPETING_PRODUCTS=MAT-A0005,MAT-A0008,MAT-A0010 share line | production_orders.csv: Competing orders | material_master.csv: Product priorities"
    },
    {
        "SCENARIO_ID": "SCN017",
        "SCENARIO_NAME": "Regulatory Inspection",
        "SCENARIO_TYPE": "PRODUCTION",
        "DESCRIPTION": "Production must be pulled forward to avoid overlap with upcoming regulatory inspection window",
        "IMPACTED_NODE": "1000",
        "IMPACTED_PRODUCTS": "ALL",
        "IMPACTED_BATCH": "N/A",
        "NODE_OFFLINE": False,
        "NODE_CAPACITY_PCT": 100,
        "INVENTORY_IMPACT": "NONE",
        "INVENTORY_QTY": "0",
        "QUARANTINE_SLOC": "",
        "IMPACT_PERMANENT": False,
        "IMPACT_DATE": "20250715",
        "IMPACT_DURATION_DAYS": 14,
        "TLANES_AFFECTED": False,
        "ALT_LINE_SAME_LOCATION": False,
        "IMPACTED_SUPPLIER": "",
        "SUPPLIER_ISSUE": "",
        "METRIC_TREND": "",
        "CURRENT_RELIABILITY": "",
        "ALTERNATE_SUPPLIERS_AVAILABLE": False,
        "REVIEW_REQUIRED": True,
        "DEMAND_CHANGE_PCT": 0,
        "DEMAND_CHANGE_TYPE": "NONE",
        "NEW_PRODUCT_ID": "",
        "CAPACITY_CONSTRAINT": "Production freeze during inspection",
        "COMPETING_PRODUCTS": "",
        "REGULATORY_EVENT": "FDA_INSPECTION",
        "NEW_FACILITY": "",
        "NETWORK_VOLATILITY": "MEDIUM",
        "AI_DECISION_OPTIONS": "Pull production forward|Build safety stock buffer|Identify CMO backup|Accept partial stockout risk",
        "DATA_EVIDENCE": "likp table: Deliveries at WERKS=1000 with WADAT during freeze period show WBSTK='C' (blocked status) | scenario_metadata table: SCN017 scenario_type=FREEZE, freeze_days=14 | Deliveries during inspection window are frozen"
    },
    {
        "SCENARIO_ID": "SCN018",
        "SCENARIO_NAME": "New Production Facility",
        "SCENARIO_TYPE": "PRODUCTION",
        "DESCRIPTION": "Second production site comes online, creating new optionality but short-term instability during qualification",
        "IMPACTED_NODE": "5000",
        "IMPACTED_PRODUCTS": "MAT-A0005,MAT-A0008",
        "IMPACTED_BATCH": "N/A",
        "NODE_OFFLINE": False,
        "NODE_CAPACITY_PCT": 50,
        "INVENTORY_IMPACT": "NONE",
        "INVENTORY_QTY": "0",
        "QUARANTINE_SLOC": "",
        "IMPACT_PERMANENT": False,
        "IMPACT_DATE": "20250615",
        "IMPACT_DURATION_DAYS": 90,
        "TLANES_AFFECTED": False,
        "ALT_LINE_SAME_LOCATION": False,
        "IMPACTED_SUPPLIER": "",
        "SUPPLIER_ISSUE": "",
        "METRIC_TREND": "",
        "CURRENT_RELIABILITY": "",
        "ALTERNATE_SUPPLIERS_AVAILABLE": False,
        "REVIEW_REQUIRED": True,
        "DEMAND_CHANGE_PCT": 0,
        "DEMAND_CHANGE_TYPE": "NONE",
        "NEW_PRODUCT_ID": "",
        "CAPACITY_CONSTRAINT": "New facility ramping - 50% capacity initially",
        "COMPETING_PRODUCTS": "",
        "REGULATORY_EVENT": "",
        "NEW_FACILITY": "5000",
        "NETWORK_VOLATILITY": "HIGH",
        "AI_DECISION_OPTIONS": "Gradual transfer of volume|Parallel production during qualification|Maintain primary site as backup|Product-by-product migration",
        "DATA_EVIDENCE": "sapapo_loc table: New location LOC_ID=5000 added | afko table: Production orders at WERKS=5000 with ramping capacity (GAMNG increases over ramp_days) | scenario_metadata table: SCN018 scenario_type=CAPACITY_RAMP, ramp_days=90, start_capacity=0.25 | Capacity ramps from 25% to 100% over 90 days"
    },
    {
        "SCENARIO_ID": "SCN019",
        "SCENARIO_NAME": "Product Shortage",
        "SCENARIO_TYPE": "PRODUCTION",
        "DESCRIPTION": "Downstream shortage forces rapid production of critical therapy with minimal buffer inventory",
        "IMPACTED_NODE": "1000",
        "IMPACTED_PRODUCTS": "MAT-A0020",
        "IMPACTED_BATCH": "N/A",
        "NODE_OFFLINE": False,
        "NODE_CAPACITY_PCT": 100,
        "INVENTORY_IMPACT": "NONE",
        "INVENTORY_QTY": "0",
        "QUARANTINE_SLOC": "",
        "IMPACT_PERMANENT": False,
        "IMPACT_DATE": "20250615",
        "IMPACT_DURATION_DAYS": 30,
        "TLANES_AFFECTED": False,
        "ALT_LINE_SAME_LOCATION": False,
        "IMPACTED_SUPPLIER": "",
        "SUPPLIER_ISSUE": "",
        "METRIC_TREND": "",
        "CURRENT_RELIABILITY": "",
        "ALTERNATE_SUPPLIERS_AVAILABLE": False,
        "REVIEW_REQUIRED": True,
        "DEMAND_CHANGE_PCT": 100,
        "DEMAND_CHANGE_TYPE": "EMERGENCY",
        "NEW_PRODUCT_ID": "",
        "CAPACITY_CONSTRAINT": "Critical therapy - cannot stockout",
        "COMPETING_PRODUCTS": "MAT-A0018,MAT-A0022",
        "REGULATORY_EVENT": "",
        "NEW_FACILITY": "",
        "NETWORK_VOLATILITY": "HIGH",
        "AI_DECISION_OPTIONS": "Emergency production campaign|Reallocate from other markets|Expedite API supply|FDA notification and controlled distribution",
        "DATA_EVIDENCE": "vbak table: CRITICAL orders with BSTNK like 'SCN019-CRITICAL-%', AUART='OR' (standard order), ERNAM=CRITICAL | vbap table: MATNR=MAT-A0020, WERKS=1000 showing +100% demand spike | vbep table: Very tight delivery windows (3-7 days) over 30-day period | scenario_metadata table: SCN019 demand_type=EMERGENCY, duration_days=30"
    },
    {
        "SCENARIO_ID": "SCN020",
        "SCENARIO_NAME": "High Volatility",
        "SCENARIO_TYPE": "PRODUCTION",
        "DESCRIPTION": "Fragile network with high volatility, constrained capacity, weak flexibility, and constant reprioritisation across all products",
        "IMPACTED_NODE": "ALL",
        "IMPACTED_PRODUCTS": "ALL",
        "IMPACTED_BATCH": "N/A",
        "NODE_OFFLINE": False,
        "NODE_CAPACITY_PCT": 85,
        "INVENTORY_IMPACT": "NONE",
        "INVENTORY_QTY": "0",
        "QUARANTINE_SLOC": "",
        "IMPACT_PERMANENT": True,
        "IMPACT_DATE": "20250615",
        "IMPACT_DURATION_DAYS": 0,
        "TLANES_AFFECTED": True,
        "ALT_LINE_SAME_LOCATION": False,
        "IMPACTED_SUPPLIER": "",
        "SUPPLIER_ISSUE": "",
        "METRIC_TREND": "",
        "CURRENT_RELIABILITY": "",
        "ALTERNATE_SUPPLIERS_AVAILABLE": False,
        "REVIEW_REQUIRED": False,
        "DEMAND_CHANGE_PCT": 0,
        "DEMAND_CHANGE_TYPE": "NONE",
        "NEW_PRODUCT_ID": "",
        "CAPACITY_CONSTRAINT": "Network at 85% utilization with frequent disruptions",
        "COMPETING_PRODUCTS": "ALL",
        "REGULATORY_EVENT": "",
        "NEW_FACILITY": "",
        "NETWORK_VOLATILITY": "HIGH",
        "AI_DECISION_OPTIONS": "Increase safety stock globally|Invest in capacity expansion|Qualify backup suppliers|Implement demand smoothing",
        "DATA_EVIDENCE": "CONFIG ONLY - No transactional injection | NETWORK_VOLATILITY=HIGH, NODE_CAPACITY_PCT=85 | TLANES_AFFECTED=True | supply_network.csv: All nodes showing stress | transportation_lanes.csv: Lane reliability concerns"
    },
    # ==========================================================================
    # SUPPLIER SCENARIOS (SCN021-SCN026)
    # ==========================================================================
    {
        "SCENARIO_ID": "SCN021",
        "SCENARIO_NAME": "Supplier Drift",
        "SCENARIO_TYPE": "SUPPLIER",
        "DESCRIPTION": "Supplier of one core excipient material has drifted from agreed SLA - delivery quantities and on-time performance declining",
        "IMPACTED_NODE": "1000",
        "IMPACTED_PRODUCTS": "MAT-R0005",
        "IMPACTED_BATCH": "N/A",
        "NODE_OFFLINE": False,
        "NODE_CAPACITY_PCT": 100,
        "INVENTORY_IMPACT": "NONE",
        "INVENTORY_QTY": "0",
        "QUARANTINE_SLOC": "",
        "IMPACT_PERMANENT": False,
        "IMPACT_DATE": "20250615",
        "IMPACT_DURATION_DAYS": 0,
        "TLANES_AFFECTED": False,
        "ALT_LINE_SAME_LOCATION": False,
        "IMPACTED_SUPPLIER": "VEND-0005",
        "SUPPLIER_ISSUE": "SLA_DRIFT",
        "METRIC_TREND": "DECLINE",
        "CURRENT_RELIABILITY": "0.72",
        "ALTERNATE_SUPPLIERS_AVAILABLE": False,
        "REVIEW_REQUIRED": False,
        "DEMAND_CHANGE_PCT": 0,
        "DEMAND_CHANGE_TYPE": "NONE",
        "NEW_PRODUCT_ID": "",
        "CAPACITY_CONSTRAINT": "",
        "COMPETING_PRODUCTS": "",
        "REGULATORY_EVENT": "",
        "NEW_FACILITY": "",
        "NETWORK_VOLATILITY": "LOW",
        "AI_DECISION_OPTIONS": "Engage supplier for improvement plan|Qualify alternate supplier|Increase safety stock|Adjust production schedule",
        "DATA_EVIDENCE": "supplier_master.csv: Vendor_ID=VEND-0005 supplies MAT-R0005 | ekbe table: Filter LIFNR=VEND-0005 to see declining OTIF (OTIF_ONTIME, OTIF_INFULL columns) | CURRENT_RELIABILITY=0.72 (down from baseline 0.95)"
    },
    {
        "SCENARIO_ID": "SCN022",
        "SCENARIO_NAME": "CMO Deviation Increase",
        "SCENARIO_TYPE": "SUPPLIER",
        "DESCRIPTION": "Single-source sterile fill-finish CMO shows rapid deviation increase and slower responses - product reliability declining from vendor",
        "IMPACTED_NODE": "1000",
        "IMPACTED_PRODUCTS": "MAT-A0020",
        "IMPACTED_BATCH": "N/A",
        "NODE_OFFLINE": False,
        "NODE_CAPACITY_PCT": 100,
        "INVENTORY_IMPACT": "NONE",
        "INVENTORY_QTY": "0",
        "QUARANTINE_SLOC": "",
        "IMPACT_PERMANENT": False,
        "IMPACT_DATE": "20250615",
        "IMPACT_DURATION_DAYS": 0,
        "TLANES_AFFECTED": False,
        "ALT_LINE_SAME_LOCATION": False,
        "IMPACTED_SUPPLIER": "VEND-0010",
        "SUPPLIER_ISSUE": "DEVIATION_INCREASE",
        "METRIC_TREND": "DECLINE",
        "CURRENT_RELIABILITY": "0.65",
        "ALTERNATE_SUPPLIERS_AVAILABLE": False,
        "REVIEW_REQUIRED": True,
        "DEMAND_CHANGE_PCT": 0,
        "DEMAND_CHANGE_TYPE": "NONE",
        "NEW_PRODUCT_ID": "",
        "CAPACITY_CONSTRAINT": "",
        "COMPETING_PRODUCTS": "",
        "REGULATORY_EVENT": "",
        "NEW_FACILITY": "",
        "NETWORK_VOLATILITY": "LOW",
        "AI_DECISION_OPTIONS": "Quality audit at CMO|Accelerate backup CMO qualification|Adjust release criteria|Customer communication on delays",
        "DATA_EVIDENCE": "supplier_master.csv: Vendor_ID=VEND-0010 (CMO) supplies MAT-A0020 | ekbe table: Filter LIFNR=VEND-0010 to see deviation pattern (OTIF declining) | CURRENT_RELIABILITY=0.65, SUPPLIER_ISSUE=DEVIATION_INCREASE"
    },
    {
        "SCENARIO_ID": "SCN023",
        "SCENARIO_NAME": "FDA 483",
        "SCENARIO_TYPE": "SUPPLIER",
        "DESCRIPTION": "API supplier receives FDA 483 for a different client - no immediate change but all supply from this supplier requires review",
        "IMPACTED_NODE": "1000",
        "IMPACTED_PRODUCTS": "MAT-R0010",
        "IMPACTED_BATCH": "ALL",
        "NODE_OFFLINE": False,
        "NODE_CAPACITY_PCT": 100,
        "INVENTORY_IMPACT": "NONE",
        "INVENTORY_QTY": "0",
        "QUARANTINE_SLOC": "",
        "IMPACT_PERMANENT": False,
        "IMPACT_DATE": "20250615",
        "IMPACT_DURATION_DAYS": 90,
        "TLANES_AFFECTED": False,
        "ALT_LINE_SAME_LOCATION": False,
        "IMPACTED_SUPPLIER": "VEND-0008",
        "SUPPLIER_ISSUE": "FDA_483",
        "METRIC_TREND": "STABLE",
        "CURRENT_RELIABILITY": "0.95",
        "ALTERNATE_SUPPLIERS_AVAILABLE": True,
        "REVIEW_REQUIRED": True,
        "DEMAND_CHANGE_PCT": 0,
        "DEMAND_CHANGE_TYPE": "NONE",
        "NEW_PRODUCT_ID": "",
        "CAPACITY_CONSTRAINT": "",
        "COMPETING_PRODUCTS": "",
        "REGULATORY_EVENT": "",
        "NEW_FACILITY": "",
        "NETWORK_VOLATILITY": "LOW",
        "AI_DECISION_OPTIONS": "Immediate quality review of existing supply|Request supplier documentation and CAPA|Prepare backup supplier qualification|No action pending review",
        "DATA_EVIDENCE": "supplier_master.csv: Vendor_ID=VEND-0008 supplies MAT-R0010 | SUPPLIER_ISSUE=FDA_483, REVIEW_REQUIRED=True | ekbe table: No OTIF impact yet (CURRENT_RELIABILITY=0.95) but all batches flagged for review"
    },
    {
        "SCENARIO_ID": "SCN024",
        "SCENARIO_NAME": "Vendor OTIF Decline",
        "SCENARIO_TYPE": "SUPPLIER",
        "DESCRIPTION": "Packaging component vendor OTIF drops due to capacity constraints - quality remains stable and alternate suppliers are ready",
        "IMPACTED_NODE": "1000",
        "IMPACTED_PRODUCTS": "MAT-R0015",
        "IMPACTED_BATCH": "N/A",
        "NODE_OFFLINE": False,
        "NODE_CAPACITY_PCT": 100,
        "INVENTORY_IMPACT": "NONE",
        "INVENTORY_QTY": "0",
        "QUARANTINE_SLOC": "",
        "IMPACT_PERMANENT": False,
        "IMPACT_DATE": "20250615",
        "IMPACT_DURATION_DAYS": 0,
        "TLANES_AFFECTED": False,
        "ALT_LINE_SAME_LOCATION": False,
        "IMPACTED_SUPPLIER": "VEND-0012",
        "SUPPLIER_ISSUE": "OTIF_DECLINE",
        "METRIC_TREND": "DECLINE",
        "CURRENT_RELIABILITY": "0.68",
        "ALTERNATE_SUPPLIERS_AVAILABLE": True,
        "REVIEW_REQUIRED": False,
        "DEMAND_CHANGE_PCT": 0,
        "DEMAND_CHANGE_TYPE": "NONE",
        "NEW_PRODUCT_ID": "",
        "CAPACITY_CONSTRAINT": "",
        "COMPETING_PRODUCTS": "",
        "REGULATORY_EVENT": "",
        "NEW_FACILITY": "",
        "NETWORK_VOLATILITY": "LOW",
        "AI_DECISION_OPTIONS": "Switch to alternate supplier|Split orders across suppliers|Increase safety stock|Expedite shipments from current supplier",
        "DATA_EVIDENCE": "supplier_master.csv: Vendor_ID=VEND-0012 supplies MAT-R0015 (packaging) | ekbe table: Filter LIFNR=VEND-0012 to see OTIF decline | CURRENT_RELIABILITY=0.68, ALTERNATE_SUPPLIERS_AVAILABLE=True"
    },
    {
        "SCENARIO_ID": "SCN025",
        "SCENARIO_NAME": "CAPA Failures",
        "SCENARIO_TYPE": "SUPPLIER",
        "DESCRIPTION": "API supplier with current CAPA failures - quality issues require immediate attention and potential supply disruption",
        "IMPACTED_NODE": "1000",
        "IMPACTED_PRODUCTS": "MAT-R0010",
        "IMPACTED_BATCH": "ALL",
        "NODE_OFFLINE": False,
        "NODE_CAPACITY_PCT": 100,
        "INVENTORY_IMPACT": "NONE",
        "INVENTORY_QTY": "0",
        "QUARANTINE_SLOC": "",
        "IMPACT_PERMANENT": False,
        "IMPACT_DATE": "20250615",
        "IMPACT_DURATION_DAYS": 60,
        "TLANES_AFFECTED": False,
        "ALT_LINE_SAME_LOCATION": False,
        "IMPACTED_SUPPLIER": "VEND-0008",
        "SUPPLIER_ISSUE": "CAPA_FAILURE",
        "METRIC_TREND": "DECLINE",
        "CURRENT_RELIABILITY": "0.60",
        "ALTERNATE_SUPPLIERS_AVAILABLE": True,
        "REVIEW_REQUIRED": True,
        "DEMAND_CHANGE_PCT": 0,
        "DEMAND_CHANGE_TYPE": "NONE",
        "NEW_PRODUCT_ID": "",
        "CAPACITY_CONSTRAINT": "",
        "COMPETING_PRODUCTS": "",
        "REGULATORY_EVENT": "",
        "NEW_FACILITY": "",
        "NETWORK_VOLATILITY": "LOW",
        "AI_DECISION_OPTIONS": "Suspend supplier pending CAPA closure|Increase incoming inspection|Qualify alternate supplier urgently|Conditional use with extra testing",
        "DATA_EVIDENCE": "supplier_master.csv: Vendor_ID=VEND-0008 supplies MAT-R0010 (API) | ekbe table: Filter LIFNR=VEND-0008 to see CAPA-related failures | CURRENT_RELIABILITY=0.60, SUPPLIER_ISSUE=CAPA_FAILURE, REVIEW_REQUIRED=True"
    },
    {
        "SCENARIO_ID": "SCN026",
        "SCENARIO_NAME": "CAPA Improvement",
        "SCENARIO_TYPE": "SUPPLIER",
        "DESCRIPTION": "API supplier with previous CAPA failures shows improvement - situation recovering and reliability increasing",
        "IMPACTED_NODE": "1000",
        "IMPACTED_PRODUCTS": "MAT-R0010",
        "IMPACTED_BATCH": "N/A",
        "NODE_OFFLINE": False,
        "NODE_CAPACITY_PCT": 100,
        "INVENTORY_IMPACT": "NONE",
        "INVENTORY_QTY": "0",
        "QUARANTINE_SLOC": "",
        "IMPACT_PERMANENT": False,
        "IMPACT_DATE": "20250615",
        "IMPACT_DURATION_DAYS": 30,
        "TLANES_AFFECTED": False,
        "ALT_LINE_SAME_LOCATION": False,
        "IMPACTED_SUPPLIER": "VEND-0008",
        "SUPPLIER_ISSUE": "CAPA_IMPROVEMENT",
        "METRIC_TREND": "IMPROVE",
        "CURRENT_RELIABILITY": "0.85",
        "ALTERNATE_SUPPLIERS_AVAILABLE": True,
        "REVIEW_REQUIRED": False,
        "DEMAND_CHANGE_PCT": 0,
        "DEMAND_CHANGE_TYPE": "NONE",
        "NEW_PRODUCT_ID": "",
        "CAPACITY_CONSTRAINT": "",
        "COMPETING_PRODUCTS": "",
        "REGULATORY_EVENT": "",
        "NEW_FACILITY": "",
        "NETWORK_VOLATILITY": "LOW",
        "AI_DECISION_OPTIONS": "Resume normal ordering volumes|Continue enhanced monitoring|Reduce safety stock buffer|Update supplier qualification status",
        "DATA_EVIDENCE": "supplier_master.csv: Vendor_ID=VEND-0008 supplies MAT-R0010 | ekbe table: Filter LIFNR=VEND-0008 to see improving OTIF trend | CURRENT_RELIABILITY=0.85 (recovering), SUPPLIER_ISSUE=CAPA_IMPROVEMENT, METRIC_TREND=IMPROVE"
    }
]

# COMMAND ----------

# Create DataFrame
from pyspark.sql import Row

df_scenarios = spark.createDataFrame([Row(**s) for s in scenarios])

# Save to table
table_name = f"{CATALOG}.{SCHEMA}.scenario_config"
df_scenarios.write.mode("overwrite").saveAsTable(table_name)

print(f"Saved {len(scenarios)} scenarios to {table_name}")
display(df_scenarios)

# COMMAND ----------

# MAGIC %md
# MAGIC ## Scenario Summary
# MAGIC
# MAGIC ### Inventory/Node Scenarios (SCN001-SCN010)
# MAGIC
# MAGIC | ID | Name | Node | Products | Batch | Node Offline | Inventory Impact | Permanent | Duration |
# MAGIC |----|------|------|----------|-------|--------------|------------------|-----------|----------|
# MAGIC | SCN001 | Stock Deviation | 1000 | Single | Single | No | REMOVE | Yes | - |
# MAGIC | SCN002 | Contamination | ALL | Single | ALL | No | REMOVE | Yes | - |
# MAGIC | SCN003 | Fire Damage | 2000 | ALL | ALL | Yes | REMOVE | No | 30 days |
# MAGIC | SCN004 | Production Shutdown 1 | 1000 | ALL | N/A | Yes | NONE | No | 14 days |
# MAGIC | SCN005 | Batch Quarantine 1 | 1000 | Single | Single | No | QUARANTINE | No | 21 days |
# MAGIC | SCN006 | Batch Quarantine 2 | ALL | Single | ALL | No | QUARANTINE | No | 21 days |
# MAGIC | SCN007 | Product Write-off | 1000 | Single | Single | No | REMOVE | Yes | - |
# MAGIC | SCN008 | Temperature Issue | 3000 | ALL | ALL | No | REMOVE | Yes | - |
# MAGIC | SCN009 | Re-route | 4000 | ALL | ALL | Yes | QUARANTINE | No | 14 days |
# MAGIC | SCN010 | Production Shutdown 2 | 1000 | ALL | N/A | No (50%) | NONE | No | 7 days |
# MAGIC
# MAGIC ### Production/Planning Scenarios (SCN011-SCN020)
# MAGIC
# MAGIC | ID | Name | Type | Products | Demand Change | Capacity | Volatility | Duration |
# MAGIC |----|------|------|----------|---------------|----------|------------|----------|
# MAGIC | SCN011 | Demand Increase | PERMANENT | Single | +25% | 100% | MEDIUM | Ongoing |
# MAGIC | SCN012 | New Product Introduction | NEW_PRODUCT | NEW | N/A | Shared line | MEDIUM | Ongoing |
# MAGIC | SCN013 | Batch Expedition | EMERGENCY | Single | +50% | 100% | HIGH | 14 days |
# MAGIC | SCN014 | Limited Capacity | NONE | Single | - | 95% saturated | HIGH | Ongoing |
# MAGIC | SCN015 | Equipment Failure | NONE | ALL | - | 60% (backup) | HIGH | 21 days |
# MAGIC | SCN016 | Competing Production | NONE | Multiple | - | Shared line | MEDIUM | Ongoing |
# MAGIC | SCN017 | Regulatory Inspection | NONE | ALL | - | Freeze period | MEDIUM | 14 days |
# MAGIC | SCN018 | New Production Facility | NONE | Multiple | - | 50% (ramping) | HIGH | 90 days |
# MAGIC | SCN019 | Product Shortage | EMERGENCY | Single | +100% | Critical | HIGH | 30 days |
# MAGIC | SCN020 | High Volatility | NONE | ALL | - | 85% network | HIGH | Ongoing |
# MAGIC
# MAGIC ### Supplier Scenarios (SCN021-SCN026)
# MAGIC
# MAGIC | ID | Name | Supplier | Material | Issue | Trend | Reliability | Alternates | Review |
# MAGIC |----|------|----------|----------|-------|-------|-------------|------------|--------|
# MAGIC | SCN021 | Supplier Drift | VEND-0005 | MAT-R0005 | SLA_DRIFT | DECLINE | 72% | No | No |
# MAGIC | SCN022 | CMO Deviation Increase | VEND-0010 | MAT-A0020 | DEVIATION_INCREASE | DECLINE | 65% | No | Yes |
# MAGIC | SCN023 | FDA 483 | VEND-0008 | MAT-R0010 | FDA_483 | STABLE | 95% | Yes | Yes |
# MAGIC | SCN024 | Vendor OTIF Decline | VEND-0012 | MAT-R0015 | OTIF_DECLINE | DECLINE | 68% | Yes | No |
# MAGIC | SCN025 | CAPA Failures | VEND-0008 | MAT-R0010 | CAPA_FAILURE | DECLINE | 60% | Yes | Yes |
# MAGIC | SCN026 | CAPA Improvement | VEND-0008 | MAT-R0010 | CAPA_IMPROVEMENT | IMPROVE | 85% | Yes | No |

# COMMAND ----------

# MAGIC %md
# MAGIC ## Parameter Definitions
# MAGIC
# MAGIC ### Common Parameters
# MAGIC
# MAGIC | Parameter | Type | Description |
# MAGIC |-----------|------|-------------|
# MAGIC | `SCENARIO_ID` | String | Unique identifier (SCN001-SCN026) |
# MAGIC | `SCENARIO_NAME` | String | Human-readable name |
# MAGIC | `SCENARIO_TYPE` | String | INVENTORY, PRODUCTION, or SUPPLIER |
# MAGIC | `DESCRIPTION` | String | Full description of the scenario |
# MAGIC | `IMPACTED_NODE` | String | Plant code(s) - "1000", "2000", or "ALL" |
# MAGIC | `IMPACTED_PRODUCTS` | String | Material(s) - "MAT-A0008", "ALL", or "NEW" |
# MAGIC | `IMPACTED_BATCH` | String | Batch ID - "BATCH-2025-001", "ALL", or "N/A" |
# MAGIC | `IMPACT_DATE` | String | Start date (YYYYMMDD) |
# MAGIC | `IMPACT_DURATION_DAYS` | Integer | Days until recovery (0 if permanent/ongoing) |
# MAGIC | `AI_DECISION_OPTIONS` | String | Pipe-separated list of possible actions for AI |
# MAGIC
# MAGIC ### Inventory/Node Parameters (SCN001-SCN010)
# MAGIC
# MAGIC | Parameter | Type | Description |
# MAGIC |-----------|------|-------------|
# MAGIC | `NODE_OFFLINE` | Boolean | Is the node taken completely offline? |
# MAGIC | `NODE_CAPACITY_PCT` | Integer | Remaining capacity % (0=offline, 50=partial, 100=normal) |
# MAGIC | `INVENTORY_IMPACT` | String | NONE / QUARANTINE / REMOVE |
# MAGIC | `INVENTORY_QTY` | String | Quantity affected - number or "ALL" |
# MAGIC | `QUARANTINE_SLOC` | String | Storage location for quarantined goods (e.g., "QA01") |
# MAGIC | `IMPACT_PERMANENT` | Boolean | Is the impact permanent? |
# MAGIC | `TLANES_AFFECTED` | Boolean | Are ALL T-lanes to/from node affected? |
# MAGIC | `ALT_LINE_SAME_LOCATION` | Boolean | Is alternative capacity at same location? |
# MAGIC
# MAGIC ### Production/Planning Parameters (SCN011-SCN020)
# MAGIC
# MAGIC | Parameter | Type | Description |
# MAGIC |-----------|------|-------------|
# MAGIC | `DEMAND_CHANGE_PCT` | Integer | Percentage change in demand (e.g., 25 for +25%) |
# MAGIC | `DEMAND_CHANGE_TYPE` | String | NONE / PERMANENT / TEMPORARY / EMERGENCY / NEW_PRODUCT |
# MAGIC | `NEW_PRODUCT_ID` | String | Material ID for new product introduction (e.g., "MAT-A0050") |
# MAGIC | `CAPACITY_CONSTRAINT` | String | Description of capacity constraint |
# MAGIC | `COMPETING_PRODUCTS` | String | Comma-separated list of products competing for resources |
# MAGIC | `REGULATORY_EVENT` | String | Type of regulatory event (e.g., "FDA_INSPECTION") |
# MAGIC | `NEW_FACILITY` | String | Plant code of new facility coming online |
# MAGIC | `NETWORK_VOLATILITY` | String | LOW / MEDIUM / HIGH - overall network stability |
# MAGIC
# MAGIC ### Supplier Parameters (SCN021-SCN026)
# MAGIC
# MAGIC | Parameter | Type | Description |
# MAGIC |-----------|------|-------------|
# MAGIC | `IMPACTED_SUPPLIER` | String | Vendor ID (e.g., "VEND-0005") |
# MAGIC | `SUPPLIER_ISSUE` | String | SLA_DRIFT / DEVIATION_INCREASE / FDA_483 / OTIF_DECLINE / CAPA_FAILURE / CAPA_IMPROVEMENT |
# MAGIC | `METRIC_TREND` | String | DECLINE / STABLE / IMPROVE |
# MAGIC | `CURRENT_RELIABILITY` | String | Current supplier reliability (0.0-1.0 as decimal string) |
# MAGIC | `ALTERNATE_SUPPLIERS_AVAILABLE` | Boolean | Are alternate suppliers qualified and available? |
# MAGIC | `REVIEW_REQUIRED` | Boolean | Does this scenario require quality/compliance review? |

# COMMAND ----------

# MAGIC %md
# MAGIC ## Inventory Impact Types
# MAGIC
# MAGIC - **NONE**: Inventory remains available and accessible
# MAGIC - **QUARANTINE**: Inventory is moved to quarantine storage location (QA01) - not usable until released
# MAGIC - **REMOVE**: Inventory is permanently removed/destroyed (scrapped)

# COMMAND ----------

# MAGIC %md
# MAGIC ## Demand Change Types (Production Scenarios)
# MAGIC
# MAGIC - **NONE**: No demand change - scenario involves capacity, scheduling, or other factors
# MAGIC - **PERMANENT**: Permanent increase in baseline demand requiring long-term capacity adjustment
# MAGIC - **TEMPORARY**: Short-term demand change that will revert to normal after duration
# MAGIC - **EMERGENCY**: Urgent, unplanned demand spike requiring immediate response
# MAGIC - **NEW_PRODUCT**: New product introduction creating new demand stream
# MAGIC
# MAGIC ## Network Volatility Levels
# MAGIC
# MAGIC - **LOW**: Stable network with predictable demand and reliable supply
# MAGIC - **MEDIUM**: Moderate variability requiring active monitoring and occasional intervention
# MAGIC - **HIGH**: Fragile network with frequent disruptions, constrained capacity, and constant reprioritization
# MAGIC
# MAGIC ## Supplier Issue Types
# MAGIC
# MAGIC - **SLA_DRIFT**: Supplier has drifted from agreed SLA on delivery quantities and/or on-time performance
# MAGIC - **DEVIATION_INCREASE**: Supplier showing rapid increase in deviations/quality issues and slower response times
# MAGIC - **FDA_483**: Supplier received FDA Form 483 (inspection observations) - may be for different client but requires review
# MAGIC - **OTIF_DECLINE**: On-Time In-Full (OTIF) performance declining, typically due to capacity constraints
# MAGIC - **CAPA_FAILURE**: Supplier has open CAPA (Corrective and Preventive Action) failures requiring attention
# MAGIC - **CAPA_IMPROVEMENT**: Supplier with previous CAPA issues is showing improvement and recovery

# COMMAND ----------

# MAGIC %md
# MAGIC ## Usage
# MAGIC
# MAGIC The AI agent can:
# MAGIC 1. Read this config table to understand available scenarios
# MAGIC 2. Select a scenario by ID
# MAGIC 3. Pass parameters to the Node Impact Analysis notebook
# MAGIC 4. Analyze the output tables to reason about next best action
# MAGIC 5. Use `AI_DECISION_OPTIONS` as a starting point for action selection
