# Databricks notebook source
# =============================================================================
# EXPORT UNITY CATALOG DOCUMENTATION TO YAML
# =============================================================================
# This notebook extracts table and column descriptions from Unity Catalog
# and exports them to a portable YAML file for version control.
#
# Usage:
#   1. Set CATALOG and SCHEMA parameters
#   2. Run the notebook
#   3. Download the generated YAML file
#
# The YAML file becomes the source of truth for schema documentation.

# COMMAND ----------

# MAGIC %pip install pyyaml --quiet

# COMMAND ----------

# =============================================================================
# PARAMETERS
# =============================================================================
dbutils.widgets.text("CATALOG", "sample_synthetic_sap", "Catalog Name")
dbutils.widgets.text("SCHEMA", "sap", "Schema Name")
dbutils.widgets.text("OUTPUT_PATH", "/Volumes/sample_synthetic_sap/sap/exports/schema_documentation.yaml", "Output YAML Path")

CATALOG = dbutils.widgets.get("CATALOG")
SCHEMA = dbutils.widgets.get("SCHEMA")
OUTPUT_PATH = dbutils.widgets.get("OUTPUT_PATH")

print("=" * 70)
print("EXPORT UNITY CATALOG DOCUMENTATION")
print("=" * 70)
print(f"Source:  {CATALOG}.{SCHEMA}")
print(f"Output:  {OUTPUT_PATH}")
print("=" * 70)

# COMMAND ----------

# =============================================================================
# EXTRACT TABLE AND COLUMN METADATA
# =============================================================================
from pyspark.sql import functions as F
import yaml
from collections import OrderedDict
from datetime import datetime

# Custom representer to maintain key order in YAML output
def represent_ordereddict(dumper, data):
    return dumper.represent_mapping('tag:yaml.org,2002:map', data.items())

yaml.add_representer(OrderedDict, represent_ordereddict)

# Get list of all tables in the schema
tables_df = spark.sql(f"""
    SELECT table_name, comment as table_comment
    FROM {CATALOG}.information_schema.tables
    WHERE table_schema = '{SCHEMA}'
    AND table_type = 'MANAGED'
    ORDER BY table_name
""")

tables = tables_df.collect()
print(f"Found {len(tables)} tables in {CATALOG}.{SCHEMA}")

# COMMAND ----------

# =============================================================================
# BUILD DOCUMENTATION STRUCTURE
# =============================================================================

documentation = OrderedDict()
documentation['_metadata'] = OrderedDict([
    ('catalog', CATALOG),
    ('schema', SCHEMA),
    ('exported_at', datetime.now().strftime('%Y-%m-%d %H:%M:%S')),
    ('exported_by', 'Unity Catalog Export Script'),
    ('description', 'SAP Mock Data schema documentation. This file is the source of truth for table and column descriptions.')
])

documentation['tables'] = OrderedDict()

for table_row in tables:
    table_name = table_row['table_name']
    table_comment = table_row['table_comment'] or ''

    print(f"\nProcessing: {table_name}")

    # Get column information
    columns_df = spark.sql(f"""
        SELECT
            column_name,
            data_type,
            comment as column_comment,
            is_nullable,
            ordinal_position
        FROM {CATALOG}.information_schema.columns
        WHERE table_schema = '{SCHEMA}'
        AND table_name = '{table_name}'
        ORDER BY ordinal_position
    """)

    columns = columns_df.collect()

    # Build table structure
    table_doc = OrderedDict()
    table_doc['description'] = table_comment
    table_doc['columns'] = OrderedDict()

    documented_count = 0
    for col_row in columns:
        col_name = col_row['column_name']
        col_comment = col_row['column_comment'] or ''
        col_type = col_row['data_type']
        is_nullable = col_row['is_nullable']

        if col_comment:
            documented_count += 1

        col_doc = OrderedDict()
        col_doc['description'] = col_comment
        col_doc['data_type'] = col_type
        col_doc['nullable'] = is_nullable == 'YES'

        table_doc['columns'][col_name] = col_doc

    documentation['tables'][table_name] = table_doc
    print(f"  - {len(columns)} columns ({documented_count} with descriptions)")

# COMMAND ----------

# =============================================================================
# GENERATE YAML OUTPUT
# =============================================================================

# Convert to YAML with nice formatting
yaml_content = yaml.dump(
    dict(documentation),  # Convert OrderedDict to regular dict for cleaner output
    default_flow_style=False,
    allow_unicode=True,
    sort_keys=False,
    width=120
)

# Preview first 100 lines
print("\n" + "=" * 70)
print("YAML PREVIEW (first 100 lines)")
print("=" * 70)
lines = yaml_content.split('\n')
for line in lines[:100]:
    print(line)
if len(lines) > 100:
    print(f"\n... ({len(lines) - 100} more lines)")

# COMMAND ----------

# =============================================================================
# SAVE TO FILE
# =============================================================================
import os

# Write to the output path
with open(OUTPUT_PATH, 'w') as f:
    f.write(yaml_content)

print(f"\n" + "=" * 70)
print("EXPORT COMPLETE")
print("=" * 70)
print(f"Documentation saved to: {OUTPUT_PATH}")
print(f"Total tables: {len(documentation['tables'])}")

# Count documentation coverage
total_columns = 0
documented_columns = 0
tables_with_desc = 0

for table_name, table_doc in documentation['tables'].items():
    if table_doc['description']:
        tables_with_desc += 1
    for col_name, col_doc in table_doc['columns'].items():
        total_columns += 1
        if col_doc['description']:
            documented_columns += 1

print(f"Tables with descriptions: {tables_with_desc}/{len(documentation['tables'])}")
print(f"Columns with descriptions: {documented_columns}/{total_columns} ({100*documented_columns/total_columns:.1f}%)")
print("=" * 70)

# COMMAND ----------

# =============================================================================
# DISPLAY SUMMARY
# =============================================================================

# Create summary dataframe
summary_data = []
for table_name, table_doc in documentation['tables'].items():
    col_count = len(table_doc['columns'])
    doc_count = sum(1 for c in table_doc['columns'].values() if c['description'])
    summary_data.append({
        'Table': table_name,
        'Description': table_doc['description'][:50] + '...' if len(table_doc['description']) > 50 else table_doc['description'],
        'Columns': col_count,
        'Documented': doc_count,
        'Coverage': f"{100*doc_count/col_count:.0f}%" if col_count > 0 else "0%"
    })

summary_df = spark.createDataFrame(summary_data)
display(summary_df)

# COMMAND ----------

# =============================================================================
# OPTIONAL: ALSO SAVE AS JSON FOR PROGRAMMATIC ACCESS
# =============================================================================
import json

json_path = OUTPUT_PATH.replace('.yaml', '.json')

with open(json_path, 'w') as f:
    json.dump(dict(documentation), f, indent=2)

print(f"JSON version saved to: {json_path}")
