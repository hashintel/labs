# Databricks notebook source
# MAGIC %md
# MAGIC # Generate SAP Mock Data
# MAGIC
# MAGIC Install the project wheel on the cluster first. Databricks supplies Spark;
# MAGIC do not install the optional local `spark` extra.

# COMMAND ----------

dbutils.widgets.text("catalog", "sample_synthetic_sap")
dbutils.widgets.text("schema", "sap")
dbutils.widgets.text("scale_factor", "1")
dbutils.widgets.text("random_seed", "42")
dbutils.widgets.dropdown("scenarios", "demo", ["demo", "none", "all"])

# COMMAND ----------

import pandas as pd
from pyspark.sql.types import (
    BooleanType,
    DoubleType,
    LongType,
    StringType,
    StructField,
    StructType,
    TimestampType,
)

from sap_mock_data import GenerationConfig, generate_dataset


class SparkCatalogStore:
    """Notebook-only pandas adapter for Unity Catalog tables."""

    def __init__(self, spark_session, catalog: str, schema: str):
        self.spark = spark_session
        self.catalog = catalog
        self.schema = schema
        self.spark.sql(f"CREATE SCHEMA IF NOT EXISTS `{catalog}`.`{schema}`")

    def _name(self, table: str) -> str:
        return f"`{self.catalog}`.`{self.schema}`.`{table.lower()}`"

    def save(self, name: str, frame: pd.DataFrame, mode: str = "overwrite") -> None:
        normalized = frame.rename(columns=str.upper).reset_index(drop=True)
        if normalized.empty:
            def spark_type(dtype):
                if pd.api.types.is_bool_dtype(dtype):
                    return BooleanType()
                if pd.api.types.is_integer_dtype(dtype):
                    return LongType()
                if pd.api.types.is_float_dtype(dtype):
                    return DoubleType()
                if pd.api.types.is_datetime64_any_dtype(dtype):
                    return TimestampType()
                return StringType()

            schema = StructType(
                [StructField(column, spark_type(dtype), True)
                 for column, dtype in normalized.dtypes.items()]
            )
            spark_frame = self.spark.createDataFrame([], schema)
        else:
            spark_frame = self.spark.createDataFrame(normalized)
        writer = spark_frame.write.format("delta").mode(mode)
        if mode == "overwrite":
            writer = writer.option("overwriteSchema", "true")
        writer.saveAsTable(self._name(name))

    def read(self, name: str) -> pd.DataFrame:
        return self.spark.table(self._name(name)).toPandas()

    def exists(self, name: str) -> bool:
        return self.spark.catalog.tableExists(
            f"{self.catalog}.{self.schema}.{name.lower()}"
        )

    def tables(self) -> list[str]:
        return sorted(
            row.tableName
            for row in self.spark.sql(
                f"SHOW TABLES IN `{self.catalog}`.`{self.schema}`"
            ).collect()
        )


store = SparkCatalogStore(
    spark,
    dbutils.widgets.get("catalog"),
    dbutils.widgets.get("schema"),
)
result = generate_dataset(
    GenerationConfig(
        random_seed=int(dbutils.widgets.get("random_seed")),
        scale_factor=float(dbutils.widgets.get("scale_factor")),
        scenarios=dbutils.widgets.get("scenarios"),
    ),
    store,
)
display(pd.DataFrame(result.row_counts.items(), columns=["table", "rows"]))
