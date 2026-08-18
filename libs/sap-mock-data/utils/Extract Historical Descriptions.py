# Databricks notebook source
# =============================================================================
# EXTRACT COLUMN DESCRIPTIONS FROM HISTORICAL TABLE VERSIONS
# =============================================================================
# This script queries historical versions of Delta tables to extract
# column descriptions that may have been overwritten.
#
# Usage:
#   1. Set the CATALOG and SCHEMA
#   2. Define TABLE_VERSIONS as a dictionary of {table_name: version_number}
#   3. Run the notebook
#   4. Copy the YAML output to update schema_documentation.yaml

# COMMAND ----------

# =============================================================================
# PARAMETERS
# =============================================================================
dbutils.widgets.text("CATALOG", "sample_synthetic_sap", "Catalog Name")
dbutils.widgets.text("SCHEMA", "sap", "Schema Name")

CATALOG = dbutils.widgets.get("CATALOG")
SCHEMA = dbutils.widgets.get("SCHEMA")

print("=" * 70)
print("EXTRACT HISTORICAL COLUMN DESCRIPTIONS")
print("=" * 70)
print(f"Catalog: {CATALOG}")
print(f"Schema:  {SCHEMA}")
print("=" * 70)

# COMMAND ----------

# =============================================================================
# DEFINE TABLE VERSIONS TO QUERY
# =============================================================================
# Update this dictionary with your table names and the version numbers
# that contain the descriptions you want to restore.
#
# To find available versions, run: DESCRIBE HISTORY catalog.schema.table_name
#
# Example:
# TABLE_VERSIONS = {
#     "mara": 5,
#     "marc": 3,
#     "mard": 4,
# }

TABLE_VERSIONS = {
    "vbfa": 81,
    "afko": 78,
    "vbep": 86,
    "kna1": 67,
    "likp": 74,
    "lips": 95,
    "makt": 42,
    "mara": 44,
    "marc": 63,
    "mard": 44,
    "mast": 48,
    "matdoc": 48,
    "mbew": 37,
    "stko": 15,
    "stpo": 46,
    "vbak": 86,
    "vbap": 93,
}

if not TABLE_VERSIONS:
    print("WARNING: TABLE_VERSIONS is empty!")
    print("Please define the tables and versions you want to query.")
    print("\nTo find available versions for a table, run:")
    print(f"  DESCRIBE HISTORY {CATALOG}.{SCHEMA}.<table_name>")

# COMMAND ----------

# =============================================================================
# HELPER: SHOW AVAILABLE HISTORY FOR ALL TABLES
# =============================================================================
# Run this cell to see version history for all tables

print("TABLE VERSION HISTORY")
print("=" * 70)

tables_df = spark.sql(f"""
    SELECT table_name
    FROM {CATALOG}.information_schema.tables
    WHERE table_schema = '{SCHEMA}'
    AND table_type = 'MANAGED'
    ORDER BY table_name
""")

for row in tables_df.collect():
    table_name = row['table_name']
    try:
        history_df = spark.sql(f"DESCRIBE HISTORY {CATALOG}.{SCHEMA}.{table_name} LIMIT 5")
        versions = [r['version'] for r in history_df.collect()]
        print(f"{table_name}: versions {versions}")
    except Exception as e:
        print(f"{table_name}: (no history available)")

# COMMAND ----------

# =============================================================================
# EXTRACT DESCRIPTIONS FROM HISTORICAL OR CURRENT VERSIONS
# =============================================================================
# Column comments are stored in Delta schema metadata and accessible via
# spark.read with versionAsOf - then access field.metadata.get("comment")
#
# If historical version is not available (VACUUM'd), falls back to current.

print("\nEXTRACTING DESCRIPTIONS FROM DELTA SCHEMA METADATA")
print("=" * 70)

all_results = {}

for table_name, version in TABLE_VERSIONS.items():
    full_table_name = f"{CATALOG}.{SCHEMA}.{table_name}"
    print(f"\n{table_name} (version {version}):")
    print("-" * 40)

    df_to_use = None
    version_used = None

    # Try the specified historical version first
    try:
        df_to_use = spark.read.format("delta").option("versionAsOf", version).table(full_table_name)
        version_used = version
        print(f"  Using historical version {version}")
    except Exception as e:
        error_msg = str(e)
        if "DELETED_FILE_RETENTION" in error_msg or "VERSION_NOT_FOUND" in error_msg:
            # Historical version not available, try to find available versions
            print(f"  Historical version {version} not available (VACUUM'd)")

            # Get available versions from history
            try:
                history_df = spark.sql(f"DESCRIBE HISTORY {full_table_name} LIMIT 10")
                available_versions = [r['version'] for r in history_df.collect()]
                print(f"  Available versions: {available_versions}")

                # Try the oldest available version (most likely to have original descriptions)
                if available_versions:
                    oldest_available = min(available_versions)
                    try:
                        df_to_use = spark.read.format("delta").option("versionAsOf", oldest_available).table(full_table_name)
                        version_used = oldest_available
                        print(f"  Using oldest available version {oldest_available}")
                    except:
                        pass
            except:
                pass

            # Fall back to current version
            if df_to_use is None:
                try:
                    df_to_use = spark.table(full_table_name)
                    version_used = "current"
                    print(f"  Using current version")
                except Exception as e2:
                    print(f"  ERROR: Could not read table: {str(e2)[:60]}")
                    continue
        else:
            print(f"  ERROR: {error_msg[:80]}")
            continue

    # Extract column descriptions from schema
    columns = {}
    described_count = 0

    for field in df_to_use.schema:
        col_name = field.name
        comment = field.metadata.get("comment", "") or ""
        data_type = str(field.dataType)

        columns[col_name] = {
            'description': comment,
            'data_type': data_type
        }

        if comment:
            described_count += 1
            print(f"  {col_name}: {comment[:60]}{'...' if len(comment) > 60 else ''}")

    print(f"  --- {described_count}/{len(columns)} columns have descriptions ---")
    all_results[table_name] = columns

# COMMAND ----------

# =============================================================================
# OUTPUT AS YAML FORMAT
# =============================================================================

if TABLE_VERSIONS and all_results:
    print("\n" + "=" * 70)
    print("YAML OUTPUT (copy this to update schema_documentation.yaml)")
    print("=" * 70 + "\n")

    for table_name, columns in all_results.items():
        print(f"  {table_name}:")
        print(f"    description: ''  # Add table description")
        print(f"    columns:")

        for col_name, col_info in columns.items():
            desc = col_info['description'].replace("'", "''") if col_info['description'] else ''
            dtype = col_info['data_type']

            print(f"      {col_name}:")
            print(f"        description: '{desc}'")
            print(f"        data_type: {dtype}")
            print(f"        nullable: true")

        print()

# COMMAND ----------

# =============================================================================
# ALTERNATIVE: QUERY SPECIFIC TABLE HISTORY
# =============================================================================
# Uncomment and modify to check a specific table's history

# table_to_check = "mara"
# display(spark.sql(f"DESCRIBE HISTORY {CATALOG}.{SCHEMA}.{table_to_check}"))

# COMMAND ----------

# =============================================================================
# ALTERNATIVE: DESCRIBE TABLE AT SPECIFIC VERSION
# =============================================================================
# Uncomment and modify to see schema at a specific version

# table_to_check = "mara"
# version_to_check = 5
# display(spark.sql(f"DESCRIBE TABLE {CATALOG}.{SCHEMA}.{table_to_check} VERSION AS OF {version_to_check}"))
