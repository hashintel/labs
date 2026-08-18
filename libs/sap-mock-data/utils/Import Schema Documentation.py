# Databricks notebook source
# =============================================================================
# IMPORT SCHEMA DOCUMENTATION TO UNITY CATALOG
# =============================================================================
# This notebook reads table and column descriptions from a YAML file
# and applies them to Unity Catalog tables.
#
# Features:
#   - Table descriptions
#   - Column descriptions
#   - Primary key constraints
#   - Foreign key constraints
#
# Usage:
#   1. Ensure the YAML file exists (from export or manual editing)
#   2. Set CATALOG, SCHEMA, and INPUT_PATH parameters
#   3. Run with DRY_RUN=true first to preview
#   4. Set DRY_RUN=false to apply changes
#
# The YAML file is the source of truth - this script syncs it to Unity Catalog.

# COMMAND ----------

# MAGIC %pip install pyyaml --quiet

# COMMAND ----------

# =============================================================================
# PARAMETERS
# =============================================================================
dbutils.widgets.text("CATALOG", "sample_synthetic_sap", "Catalog Name")
dbutils.widgets.text("SCHEMA", "sap", "Schema Name")
dbutils.widgets.text("INPUT_PATH", "/Volumes/sample_synthetic_sap/sap/exports/schema_documentation.yaml", "Input YAML Path")
dbutils.widgets.dropdown("DRY_RUN", "true", ["true", "false"], "Dry Run (preview only)")
dbutils.widgets.dropdown("APPLY_CONSTRAINTS", "true", ["true", "false"], "Apply PK/FK Constraints")
dbutils.widgets.dropdown("DROP_EXISTING_CONSTRAINTS", "true", ["true", "false"], "Drop Existing Constraints First")

CATALOG = dbutils.widgets.get("CATALOG")
SCHEMA = dbutils.widgets.get("SCHEMA")
INPUT_PATH = dbutils.widgets.get("INPUT_PATH")
DRY_RUN = dbutils.widgets.get("DRY_RUN") == "true"
APPLY_CONSTRAINTS = dbutils.widgets.get("APPLY_CONSTRAINTS") == "true"
DROP_EXISTING_CONSTRAINTS = dbutils.widgets.get("DROP_EXISTING_CONSTRAINTS") == "true"

print("=" * 70)
print("IMPORT SCHEMA DOCUMENTATION TO UNITY CATALOG")
print("=" * 70)
print(f"Target:              {CATALOG}.{SCHEMA}")
print(f"Source:              {INPUT_PATH}")
print(f"Dry Run:             {DRY_RUN}")
print(f"Apply Constraints:   {APPLY_CONSTRAINTS}")
print(f"Drop Existing:       {DROP_EXISTING_CONSTRAINTS}")
print("=" * 70)

# COMMAND ----------

# =============================================================================
# LOAD YAML DOCUMENTATION
# =============================================================================
import yaml

with open(INPUT_PATH, 'r') as f:
    documentation = yaml.safe_load(f)

tables = documentation.get('tables', {})
print(f"Loaded documentation for {len(tables)} tables")

# Count constraints
pk_count = sum(1 for t in tables.values() if t.get('primary_key'))
fk_count = sum(len(t.get('foreign_keys', [])) for t in tables.values())
print(f"Primary keys defined: {pk_count}")
print(f"Foreign keys defined: {fk_count}")

# COMMAND ----------

# =============================================================================
# HELPER FUNCTIONS
# =============================================================================
def escape_comment(comment):
    """Escape single quotes and clean up comment for SQL."""
    if not comment:
        return ''
    # Replace single quotes with escaped single quotes
    comment = comment.replace("'", "\\'")
    # Remove newlines and extra whitespace
    comment = ' '.join(comment.split())
    return comment

def table_exists(full_table_name):
    """Check if a table exists in the catalog."""
    try:
        spark.sql(f"DESCRIBE TABLE {full_table_name}")
        return True
    except:
        return False

def get_existing_constraints(full_table_name, constraint_type):
    """Get existing constraints of a specific type for a table."""
    table_name = full_table_name.split('.')[-1]
    try:
        df = spark.sql(f"""
            SELECT constraint_name
            FROM {CATALOG}.information_schema.table_constraints
            WHERE table_schema = '{SCHEMA}'
              AND table_name = '{table_name}'
              AND constraint_type = '{constraint_type}'
        """)
        return [row['constraint_name'] for row in df.collect()]
    except:
        return []

# COMMAND ----------

# =============================================================================
# DROP EXISTING CONSTRAINTS (if requested)
# =============================================================================
if APPLY_CONSTRAINTS and DROP_EXISTING_CONSTRAINTS:
    print("\n" + "=" * 70)
    print("DROPPING EXISTING CONSTRAINTS")
    print("=" * 70)

    fk_dropped = 0
    pk_dropped = 0

    for table_name in tables.keys():
        full_table_name = f"{CATALOG}.{SCHEMA}.{table_name}"

        if not table_exists(full_table_name):
            continue

        # Drop Foreign Keys first (to avoid dependency errors)
        for constraint_name in get_existing_constraints(full_table_name, 'FOREIGN KEY'):
            if DRY_RUN:
                print(f"  [DRY RUN] Would drop FK: {table_name}.{constraint_name}")
                fk_dropped += 1
            else:
                try:
                    spark.sql(f"ALTER TABLE {full_table_name} DROP CONSTRAINT {constraint_name}")
                    print(f"  Dropped FK: {table_name}.{constraint_name}")
                    fk_dropped += 1
                except Exception as e:
                    print(f"  Skip FK {constraint_name}: {str(e)[:50]}")

        # Drop Primary Keys
        for constraint_name in get_existing_constraints(full_table_name, 'PRIMARY KEY'):
            if DRY_RUN:
                print(f"  [DRY RUN] Would drop PK: {table_name}.{constraint_name}")
                pk_dropped += 1
            else:
                try:
                    spark.sql(f"ALTER TABLE {full_table_name} DROP PRIMARY KEY")
                    print(f"  Dropped PK: {table_name}")
                    pk_dropped += 1
                except Exception as e:
                    print(f"  Skip PK {table_name}: {str(e)[:50]}")

    print(f"\nDropped: {pk_dropped} PKs, {fk_dropped} FKs")

# COMMAND ----------

# =============================================================================
# APPLY TABLE DESCRIPTIONS
# =============================================================================
print("\n" + "=" * 70)
print("APPLYING TABLE DESCRIPTIONS")
print("=" * 70)

table_updates = 0
table_errors = 0

for table_name, table_doc in tables.items():
    description = table_doc.get('description', '')

    if not description:
        continue

    escaped_desc = escape_comment(description)
    full_table_name = f"{CATALOG}.{SCHEMA}.{table_name}"

    if not table_exists(full_table_name):
        print(f"  SKIP: {table_name} (table not found)")
        continue

    sql = f"COMMENT ON TABLE {full_table_name} IS '{escaped_desc}'"

    if DRY_RUN:
        print(f"  [DRY RUN] Would update: {table_name}")
        table_updates += 1
    else:
        try:
            spark.sql(sql)
            print(f"  OK: {table_name}")
            table_updates += 1
        except Exception as e:
            print(f"  ERROR: {table_name} - {str(e)[:50]}")
            table_errors += 1

print(f"\nTable descriptions: {table_updates} updated, {table_errors} errors")

# COMMAND ----------

# =============================================================================
# APPLY COLUMN DESCRIPTIONS
# =============================================================================
print("\n" + "=" * 70)
print("APPLYING COLUMN DESCRIPTIONS")
print("=" * 70)

column_updates = 0
column_skipped = 0
column_errors = 0

for table_name, table_doc in tables.items():
    columns = table_doc.get('columns', {})
    full_table_name = f"{CATALOG}.{SCHEMA}.{table_name}"

    if not table_exists(full_table_name):
        continue

    for col_name, col_doc in columns.items():
        description = col_doc.get('description', '')

        if not description:
            column_skipped += 1
            continue

        escaped_desc = escape_comment(description)
        sql = f"ALTER TABLE {full_table_name} ALTER COLUMN {col_name} COMMENT '{escaped_desc}'"

        if DRY_RUN:
            # Only print first few for preview
            if column_updates < 10:
                print(f"  [DRY RUN] {table_name}.{col_name}: {description[:40]}...")
            elif column_updates == 10:
                print(f"  ... and more columns")
            column_updates += 1
        else:
            try:
                spark.sql(sql)
                column_updates += 1
            except Exception as e:
                # Column might not exist or other issue
                column_errors += 1
                if column_errors <= 5:
                    print(f"  ERROR: {table_name}.{col_name} - {str(e)[:50]}")

if not DRY_RUN:
    print(f"\nColumn descriptions: {column_updates} updated, {column_skipped} skipped (empty), {column_errors} errors")
else:
    print(f"\n[DRY RUN] Would update {column_updates} column descriptions")

# COMMAND ----------

# =============================================================================
# APPLY PRIMARY KEY CONSTRAINTS
# =============================================================================
if APPLY_CONSTRAINTS:
    print("\n" + "=" * 70)
    print("APPLYING PRIMARY KEY CONSTRAINTS")
    print("=" * 70)

    pk_updates = 0
    pk_errors = 0

    for table_name, table_doc in tables.items():
        primary_key = table_doc.get('primary_key', [])

        if not primary_key:
            continue

        full_table_name = f"{CATALOG}.{SCHEMA}.{table_name}"

        if not table_exists(full_table_name):
            print(f"  SKIP: {table_name} (table not found)")
            continue

        # First, set NOT NULL on PK columns
        for col in primary_key:
            not_null_sql = f"ALTER TABLE {full_table_name} ALTER COLUMN {col} SET NOT NULL"
            if not DRY_RUN:
                try:
                    spark.sql(not_null_sql)
                except Exception as e:
                    # May already be NOT NULL or contain nulls
                    if "contains null values" in str(e).lower():
                        print(f"  WARNING: {table_name}.{col} contains NULL values - cannot set NOT NULL")

        # Create the PK constraint
        pk_cols = ", ".join(primary_key)
        constraint_name = f"pk_{table_name}"
        pk_sql = f"ALTER TABLE {full_table_name} ADD CONSTRAINT {constraint_name} PRIMARY KEY ({pk_cols})"

        if DRY_RUN:
            print(f"  [DRY RUN] {table_name}: PK ({pk_cols})")
            pk_updates += 1
        else:
            try:
                spark.sql(pk_sql)
                print(f"  OK: {table_name} PK ({pk_cols})")
                pk_updates += 1
            except Exception as e:
                error_msg = str(e)
                if "already exists" in error_msg.lower():
                    print(f"  SKIP: {table_name} (PK already exists)")
                else:
                    print(f"  ERROR: {table_name} - {error_msg[:60]}")
                    pk_errors += 1

    print(f"\nPrimary keys: {pk_updates} created, {pk_errors} errors")

# COMMAND ----------

# =============================================================================
# APPLY FOREIGN KEY CONSTRAINTS
# =============================================================================
if APPLY_CONSTRAINTS:
    print("\n" + "=" * 70)
    print("APPLYING FOREIGN KEY CONSTRAINTS")
    print("=" * 70)

    fk_updates = 0
    fk_errors = 0
    fk_skipped = 0

    for table_name, table_doc in tables.items():
        foreign_keys = table_doc.get('foreign_keys', [])

        if not foreign_keys:
            continue

        full_table_name = f"{CATALOG}.{SCHEMA}.{table_name}"

        if not table_exists(full_table_name):
            print(f"  SKIP: {table_name} (table not found)")
            continue

        for i, fk in enumerate(foreign_keys):
            fk_columns = fk.get('columns', [])
            ref_info = fk.get('references', {})
            ref_table = ref_info.get('table', '')
            ref_columns = ref_info.get('columns', [])

            if not fk_columns or not ref_table or not ref_columns:
                fk_skipped += 1
                continue

            # Check if referenced table exists
            ref_full_table = f"{CATALOG}.{SCHEMA}.{ref_table}"
            if not table_exists(ref_full_table):
                print(f"  SKIP: {table_name} FK to {ref_table} (ref table not found)")
                fk_skipped += 1
                continue

            # Build the constraint
            fk_cols_str = ", ".join(fk_columns)
            ref_cols_str = ", ".join(ref_columns)

            # Create a unique constraint name
            constraint_name = f"fk_{table_name}_{ref_table}_{i+1}"

            fk_sql = f"""ALTER TABLE {full_table_name}
                ADD CONSTRAINT {constraint_name}
                FOREIGN KEY ({fk_cols_str})
                REFERENCES {ref_full_table} ({ref_cols_str})"""

            if DRY_RUN:
                print(f"  [DRY RUN] {table_name}({fk_cols_str}) -> {ref_table}({ref_cols_str})")
                fk_updates += 1
            else:
                try:
                    spark.sql(fk_sql)
                    print(f"  OK: {table_name}({fk_cols_str}) -> {ref_table}({ref_cols_str})")
                    fk_updates += 1
                except Exception as e:
                    error_msg = str(e)
                    if "already exists" in error_msg.lower():
                        print(f"  SKIP: {constraint_name} (already exists)")
                        fk_skipped += 1
                    else:
                        print(f"  ERROR: {table_name} -> {ref_table}: {error_msg[:50]}")
                        fk_errors += 1

    print(f"\nForeign keys: {fk_updates} created, {fk_skipped} skipped, {fk_errors} errors")

# COMMAND ----------

# =============================================================================
# SUMMARY
# =============================================================================
print("\n" + "=" * 70)
print("IMPORT SUMMARY")
print("=" * 70)

if DRY_RUN:
    print("DRY RUN COMPLETE - No changes were made")
    print("Set DRY_RUN to 'false' to apply changes")
else:
    print(f"Tables updated:      {table_updates}")
    print(f"Columns updated:     {column_updates}")
    if APPLY_CONSTRAINTS:
        print(f"Primary keys:        {pk_updates}")
        print(f"Foreign keys:        {fk_updates}")
    print(f"Total errors:        {table_errors + column_errors + (pk_errors if APPLY_CONSTRAINTS else 0) + (fk_errors if APPLY_CONSTRAINTS else 0)}")
    print("\nDocumentation has been applied to Unity Catalog")

print("=" * 70)
