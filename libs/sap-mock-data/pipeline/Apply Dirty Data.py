# Databricks notebook source
# Apply Dirty Data Notebook
# Applies dirty data transformations to master data and transaction tables.
# Run this notebook last, after Inject Scenarios: the generation and scenario
# notebooks read clean tables.

import pandas as pd
import numpy as np
import random
import zlib
import pyspark.sql.functions as F
from pyspark.sql.types import *

# COMMAND ----------

dbutils.widgets.text("CATALOG", "sample_synthetic_sap", "Catalog Name")
dbutils.widgets.text("SCHEMA", "sap", "Schema Name")
dbutils.widgets.text("RANDOM_SEED", "42", "Random Seed")
dbutils.widgets.text("DIRTY_DATA_RATE", "0.05", "Dirty Data Rate (0.0-1.0)")

CATALOG = dbutils.widgets.get("CATALOG")
SCHEMA = dbutils.widgets.get("SCHEMA")
RANDOM_SEED = int(dbutils.widgets.get("RANDOM_SEED"))
DIRTY_DATA_RATE = float(dbutils.widgets.get("DIRTY_DATA_RATE"))

random.seed(RANDOM_SEED)
np.random.seed(RANDOM_SEED)

print(f"Target: {CATALOG}.{SCHEMA} | Seed: {RANDOM_SEED}")
print(f"Dirty Data Rate: {DIRTY_DATA_RATE}")

# COMMAND ----------

# DIRTY DATA HELPER FUNCTIONS
def dirty_key(value, dirty_rate=0.05):
    """Apply random dirty transformation to a key value."""
    if random.random() > dirty_rate:
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
    if random.random() > dirty_rate or not date_str:
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
    if dirty_rate <= 0:
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
    if dirty_rate <= 0:
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
    if orphan_rate <= 0:
        return df

    df_dirty = df.copy()
    mask = np.random.random(len(df_dirty)) < orphan_rate
    n_orphans = mask.sum()

    if n_orphans > 0:
        # Create orphan keys that definitely don't exist
        orphan_keys = [f"{prefix}_{i:06d}" for i in range(n_orphans)]
        df_dirty.loc[mask, fk_column] = orphan_keys

    return df_dirty


def inject_duplicates(df, key_column, dup_rate=0.01):
    """Duplicate some rows to create duplicate key issues."""
    if dup_rate <= 0:
        return df

    n_dups = max(1, int(len(df) * dup_rate))
    dup_indices = np.random.choice(df.index, size=min(n_dups, len(df)), replace=False)
    duplicates = df.loc[dup_indices].copy()

    return pd.concat([df, duplicates], ignore_index=True)


def inject_nulls(df, columns, null_rate=0.02):
    """Inject NULL values into specified columns."""
    if null_rate <= 0:
        return df

    df_dirty = df.copy()
    for col in columns:
        if col in df_dirty.columns:
            mask = np.random.random(len(df_dirty)) < null_rate
            df_dirty.loc[mask, col] = None

    return df_dirty


def apply_dirty_data(df, table_name, config, dirty_rate, seed):
    """
    Apply all dirty transformations to a DataFrame.
    Uses deterministic seed for reproducibility.
    """
    # Set seed for reproducibility within this table
    np.random.seed(seed + zlib.crc32(table_name.encode()) % 1000)
    random.seed(seed + zlib.crc32(table_name.encode()) % 1000)

    df_dirty = df.copy()

    if 'key_columns' in config:
        df_dirty = dirty_dataframe(df_dirty, config['key_columns'], dirty_rate)

    if 'date_columns' in config:
        df_dirty = dirty_date_column(df_dirty, config['date_columns'], dirty_rate)

    if 'orphan_config' in config:
        for fk_col, rate, prefix in config['orphan_config']:
            df_dirty = inject_orphan_records(df_dirty, fk_col, rate, prefix)

    if 'pk_column' in config and 'dup_rate' in config:
        df_dirty = inject_duplicates(df_dirty, config['pk_column'], config['dup_rate'])

    if 'null_columns' in config:
        df_dirty = inject_nulls(df_dirty, config['null_columns'], config.get('null_rate', 0.02))

    return df_dirty

# COMMAND ----------

# Helper: Safe Save (Schema Auto-Heal)

def save_sap_table(df_spark, table_name, catalog, schema):
    """Save DataFrame to Delta table with schema alignment."""
    full_table_name = f"{catalog}.{schema}.{table_name}"

    for col in df_spark.columns:
        df_spark = df_spark.withColumnRenamed(col, col.upper())

    if not spark.catalog.tableExists(full_table_name):
        print(f"Creating {table_name}...")
        df_spark.write.format("delta").saveAsTable(full_table_name)
    else:
        print(f"Updating {table_name}...")
        target_table = spark.table(full_table_name)
        target_schema = target_table.schema

        select_exprs = []
        for field in target_schema:
            col = field.name.upper()
            if col in df_spark.columns:
                select_exprs.append(F.col(col).cast(field.dataType))
            else:
                if isinstance(field.dataType, StringType):
                    select_exprs.append(F.lit("").cast(field.dataType).alias(col))
                elif isinstance(field.dataType, (DoubleType, LongType, IntegerType)):
                    select_exprs.append(F.lit(0).cast(field.dataType).alias(col))
                else:
                    select_exprs.append(F.lit(None).cast(field.dataType).alias(col))

        df_spark.select(*select_exprs).write.mode("overwrite").insertInto(full_table_name)

# COMMAND ----------

# Main Execution - Apply Dirty Data

print(f"\n{'='*60}")
print(f"APPLYING DIRTY DATA (rate={DIRTY_DATA_RATE}, seed={RANDOM_SEED})")
print(f"{'='*60}")

dirty_configs = {
    "kna1": {
        'key_columns': ['KUNNR'],
        'pk_column': 'KUNNR',
        'dup_rate': 0.01,
        'null_columns': ['NAME1'],
        'null_rate': 0.02
    },
    "mara": {
        'key_columns': ['MATNR'],
        'pk_column': 'MATNR',
        'dup_rate': 0.01,
        'null_columns': ['MTART'],
        'null_rate': 0.02
    },
    "makt": {
        'key_columns': ['MATNR'],
        'orphan_config': [('MATNR', 0.03, 'ORPHAN_MAT')]
    },
    "marc": {
        'orphan_config': [('MATNR', 0.02, 'ORPHAN_MAT')]
    },
    "mard": {
        'key_columns': ['LGORT'],
        'orphan_config': [('MATNR', 0.02, 'ORPHAN_MAT')]
    },
    "mbew": {
        'orphan_config': [('MATNR', 0.02, 'ORPHAN_MAT')]
    },
    "marm": {
        'orphan_config': [('MATNR', 0.02, 'ORPHAN_MAT')]
    },
    "stpo": {
        'orphan_config': [('IDNRK', 0.02, 'ORPHAN_COMP')]
    },
    "vbak": {
        'key_columns': ['VBELN', 'KUNNR'],
        'orphan_config': [('KUNNR', 0.02, 'ORPHAN_CUST')],
        'pk_column': 'VBELN',
        'dup_rate': 0.01,
        'null_columns': ['NETWR'],
        'null_rate': 0.02
    },
    "vbap": {
        'key_columns': ['WERKS'],
        'null_columns': ['KWMENG'],
        'null_rate': 0.02
    },
    "vbep": {
        'key_columns': ['VBELN']
    },
    "likp": {
        'key_columns': ['VBELN'],
        'pk_column': 'VBELN',
        'dup_rate': 0.01
    },
    "lips": {
        'key_columns': ['WERKS'],
        'orphan_config': [('VBELN', 0.03, 'ORPHAN_DEL'), ('MATNR', 0.03, 'ORPHAN_MAT')],
        'null_columns': ['LFIMG'],
        'null_rate': 0.02
    },
    "vbfa": {
        'orphan_config': [('VBELN', 0.02, 'ORPHAN_DOC')]
    },
    "vttk": {
        'key_columns': ['TKNUM']
    },
    "vttp": {
        'key_columns': ['TKNUM'],
        'orphan_config': [('VBELN', 0.02, 'ORPHAN_DEL')]
    },
    "matdoc": {
        'key_columns': ['MBLNR', 'WERKS'],
        # Scenario documents (MBLNR prefix 'SCN') stay clean.
        'protect': ('MBLNR', 'SCN')
    }
}

# Rows appended by Inject Scenarios stay clean; it records their keys in scenario_protection.
protected_keys = {}
if spark.catalog.tableExists(f"{CATALOG}.{SCHEMA}.scenario_protection"):
    df_protection = spark.table(f"{CATALOG}.{SCHEMA}.scenario_protection").toPandas()
    for row in df_protection.itertuples(index=False):
        protected_keys.setdefault(row.TABLE_NAME, {}).setdefault(row.KEY_COLUMN, set()).add(str(row.KEY_VALUE))
    print(f"Scenario protection: {len(df_protection)} keys loaded")
else:
    print("No scenario_protection table found")

tables_processed = 0
for table_name, config in dirty_configs.items():
    try:
        print(f"Dirtying {table_name.upper()}...")

        df = spark.table(f"{CATALOG}.{SCHEMA}.{table_name}").toPandas()

        exempt = pd.Series(False, index=df.index)
        if 'protect' in config:
            protect_col, protect_prefix = config['protect']
            exempt |= df[protect_col].astype(str).str.startswith(protect_prefix)
        for key_column, key_values in protected_keys.get(table_name, {}).items():
            if key_column in df.columns:
                exempt |= df[key_column].astype(str).isin(key_values)

        table_config = {key: value for key, value in config.items() if key != 'protect'}
        if exempt.any():
            df_dirty = apply_dirty_data(df[~exempt], table_name, table_config, DIRTY_DATA_RATE, RANDOM_SEED)
            df_dirty = pd.concat([df_dirty, df[exempt]], ignore_index=True)
        else:
            df_dirty = apply_dirty_data(df, table_name, table_config, DIRTY_DATA_RATE, RANDOM_SEED)

        save_sap_table(spark.createDataFrame(df_dirty), table_name, CATALOG, SCHEMA)
        tables_processed += 1

    except Exception as e:
        print(f"Warning: Could not process {table_name}: {str(e)}")

print(f"\n{'='*60}")
print(f"Dirty data applied to {tables_processed} tables")
print(f"{'='*60}")

dbutils.notebook.exit(f"SUCCESS: {tables_processed} tables dirtied")
