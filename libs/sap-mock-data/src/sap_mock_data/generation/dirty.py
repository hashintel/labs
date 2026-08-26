"""Corrupt stored tables after generation.

Dirty data models recording errors in the stored tables. This stage runs
after every generator and after scenario injection, so generators and
scenario matching read clean tables.
"""
import random
import zlib

import numpy as np
import pandas as pd

from .common import param


def dirty_key(value):
    """Apply a random dirty transformation to a key value."""
    transformations = [
        lambda v: '0' + str(v),           # Add leading zero
        lambda v: ' ' + str(v),           # Add leading space
        lambda v: str(v) + ' ',           # Add trailing space
        lambda v: str(v).lower(),         # Lowercase
        lambda v: str(v).lstrip('0'),     # Strip leading zeros
        lambda v: '  ' + str(v) + '  ',   # Multiple spaces
    ]
    return random.choice(transformations)(str(value))


def dirty_date(date_str):
    """Convert a date from YYYYMMDD to a random dirty format."""
    if not date_str:
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
    except Exception:
        return date_str


def dirty_dataframe(df, key_columns, dirty_rate):
    """Apply dirty transformations to specified columns in a DataFrame."""
    if dirty_rate <= 0:
        return df

    df_dirty = df.copy()
    for col in key_columns:
        if col in df_dirty.columns:
            mask = np.random.random(len(df_dirty)) < dirty_rate
            df_dirty.loc[mask, col] = df_dirty.loc[mask, col].apply(dirty_key)
    return df_dirty


def dirty_date_column(df, date_columns, dirty_rate):
    """Apply dirty date transformations to specified date columns."""
    if dirty_rate <= 0:
        return df

    df_dirty = df.copy()
    for col in date_columns:
        if col in df_dirty.columns:
            mask = np.random.random(len(df_dirty)) < dirty_rate
            df_dirty.loc[mask, col] = df_dirty.loc[mask, col].apply(dirty_date)
    return df_dirty


def inject_orphan_records(df, fk_column, orphan_rate=0.03, prefix='ORPHAN'):
    """Replace some foreign keys with non-existent values."""
    if orphan_rate <= 0:
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
    """Apply configured dirty-data transformations with a per-table seed."""
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


MASTERDATA_DIRTY_CONFIGS = {
    "kna1": {
        'key_columns': ['KUNNR'],
        'pk_column': 'KUNNR',
        'dup_rate': 0.01,
        'null_columns': ['NAME1'],
        'null_rate': 0.02,
    },
    "mara": {
        'key_columns': ['MATNR'],
        'pk_column': 'MATNR',
        'dup_rate': 0.01,
        'null_columns': ['MTART'],
        'null_rate': 0.02,
    },
    "makt": {
        'key_columns': ['MATNR'],
        'orphan_config': [('MATNR', 0.03, 'ORPHAN_MAT')],
    },
    "marc": {
        'orphan_config': [('MATNR', 0.02, 'ORPHAN_MAT')],
    },
    "mard": {
        'key_columns': ['LGORT'],
        'orphan_config': [('MATNR', 0.02, 'ORPHAN_MAT')],
    },
    "mbew": {
        'orphan_config': [('MATNR', 0.02, 'ORPHAN_MAT')],
    },
    "marm": {
        'orphan_config': [('MATNR', 0.02, 'ORPHAN_MAT')],
    },
    "stpo": {
        'orphan_config': [('IDNRK', 0.02, 'ORPHAN_COMP')],
    },
}

TRANSACTION_DIRTY_CONFIGS = {
    "vbak": {
        'key_columns': ['VBELN', 'KUNNR'],
        'orphan_config': [('KUNNR', 0.02, 'ORPHAN_CUST')],
        'pk_column': 'VBELN',
        'dup_rate': 0.01,
        'null_columns': ['NETWR'],
        'null_rate': 0.02,
    },
    "vbap": {
        'key_columns': ['WERKS'],
        'null_columns': ['KWMENG'],
        'null_rate': 0.02,
    },
    "vbep": {
        'key_columns': ['VBELN'],
    },
    "likp": {
        'key_columns': ['VBELN'],
        'pk_column': 'VBELN',
        'dup_rate': 0.01,
    },
    "lips": {
        'key_columns': ['WERKS'],
        'orphan_config': [('VBELN', 0.03, 'ORPHAN_DEL'), ('MATNR', 0.03, 'ORPHAN_MAT')],
        'null_columns': ['LFIMG'],
        'null_rate': 0.02,
    },
    "vbfa": {
        'orphan_config': [('VBELN', 0.02, 'ORPHAN_DOC')],
    },
    "vttk": {
        'key_columns': ['TKNUM'],
    },
    "vttp": {
        'key_columns': ['TKNUM'],
        'orphan_config': [('VBELN', 0.02, 'ORPHAN_DEL')],
    },
    "matdoc": {
        'key_columns': ['MBLNR', 'WERKS'],
        # Scenario records are identified by the 'SCN' prefix on MBLNR,
        # so they are left clean.
        'protect': ('MBLNR', 'SCN'),
    },
}


def generate(wh):
    """Corrupt the stored tables per the configs above."""
    if param("GENERATE_DIRTY_DATA").lower() != "true":
        return

    dirty_rate = float(param("DIRTY_DATA_RATE"))
    seed = int(param("RANDOM_SEED"))

    dirtied = 0
    for table_name, config in {**MASTERDATA_DIRTY_CONFIGS, **TRANSACTION_DIRTY_CONFIGS}.items():
        if not wh.exists(table_name):
            continue

        df = wh.read(table_name)
        protect = config.get('protect')
        if protect:
            protect_col, protect_prefix = protect
            protected_mask = df[protect_col].astype(str).str.startswith(protect_prefix)
            config = {key: value for key, value in config.items() if key != 'protect'}
            df_dirty = apply_dirty_data(df[~protected_mask], table_name, config, dirty_rate, seed)
            df_dirty = pd.concat([df_dirty, df[protected_mask]], ignore_index=True)
        else:
            df_dirty = apply_dirty_data(df, table_name, config, dirty_rate, seed)

        wh.save(table_name, df_dirty)
        dirtied += 1

    print(f"Dirty data applied to {dirtied} tables (rate={dirty_rate}, seed={seed})")
