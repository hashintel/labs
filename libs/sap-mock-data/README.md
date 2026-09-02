# SAP Mock Data

`sap-mock-data` generates deterministic, interconnected SAP-style master and
transaction data. The `generate_dataset` function generates it. The CLI,
local notebooks, and Databricks notebooks all call that function.

Pandas creates and mutates tables. A `TableStore` persists them. Delta Lake
is the default local store. The Databricks notebook supplies a Unity Catalog
adapter.

## Development environment

The library supports Python 3.11 through 3.13. Nix is an optional way to
provision the Python and system tools. Python dependencies come from
`pyproject.toml` and are locked in `uv.lock`.

### Without Nix

For a reproducible development environment, install
[uv](https://docs.astral.sh/uv/) and run:

```console
uv sync --frozen
uv run sap-mock --help
uv build
```

The checked-in `.python-version` selects Python 3.13. By default, uv downloads
that runtime when it is not already installed.

The package also installs with venv and pip, without the lock file:

```console
python -m venv .venv
. .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -e .
sap-mock --help
```

For notebooks and local Spark, install the optional dependencies with uv:

```console
uv sync --frozen --extra spark --group notebook
uv run jupyter lab
```

Local Spark requires a Java 17 or newer JDK on `PATH` with `JAVA_HOME` set.
Databricks supplies its own Spark and Java runtime.

### With Nix

The default Nix shell provides pinned Python and uv executables. The uv
commands are the same as without Nix:

```console
nix develop
uv sync --frozen
uv run sap-mock --help
uv build
```

For local Spark work, enter the JVM-enabled shell and install the Python extra:

```console
nix develop .#spark
uv sync --frozen --extra spark --group notebook
uv run jupyter lab
```

Only the notebooks import PySpark. The library and CLI run without Java or
Spark in either environment.

## Library API

```python
from sap_mock_data import GenerationConfig, generate_dataset
from sap_mock_data.storage import DeltaTableStore

result = generate_dataset(
    GenerationConfig(
        random_seed=42,
        scale_factor=1,
        scenarios="demo",
        currency="EUR",
    ),
    DeltaTableStore(".mock-warehouse"),
)
print(result.table_count, result.row_counts)
```

Use a new or isolated warehouse path for each run. Generation overwrites its
tables and preserves unrelated tables in an existing store.

For embedding or quick checks, use `MemoryTableStore`. `generate_dataset`
accepts any `TableStore` implementation, including the Databricks adapter in
`notebooks/databricks/Generate SAP Mock Data.py`.

Scenario selection accepts `demo`, `none`, `all`, a comma-separated string, or
a sequence of IDs. Explicit scenarios need configuration strings:

```python
GenerationConfig(
    scenarios=["SCN003"],
    scenario_configs={"SCN003": "2000,ALL,20250615,30"},
)
```

### Dataset size

`scale_factor` is a positive number or one of the size identifiers `S`,
`M`, `L`, `XL`. For a size identifier, `GenerationConfig` samples each count
from the ranges below, seeded by `random_seed`. The same seed produces the
same dataset. A number multiplies the default order, customer, material,
vendor, and site counts.

| size | products | suppliers | sites   | BOM depth | raw materials | customers | orders      |
| ---- | -------- | --------- | ------- | --------- | ------------- | --------- | ----------- |
| S    | 3        | 3-5       | 1-2     | 1         | 6-10          | 4-8       | 200-400     |
| M    | 10-50    | 20-30     | 4-5     | 1         | 27-42         | 25-40     | 4000-6000   |
| L    | 100-200  | 50-100    | 20-40   | 1         | 72-112        | 80-120    | 12000-20000 |
| XL   | 400-800  | 150-300   | 100-120 | 1         | 180-280       | 250-400   | 40000-80000 |

- The products column includes two fixed BOM parent materials, and the raw
  materials column includes three fixed BOM components.
- `num_customers`, `num_finished_goods`, `num_raw_materials`, `num_vendors`,
  `num_sites`, and `num_orders` set their counts directly, whichever form
  `scale_factor` takes.
- The first five sites are fixed plants. Further sites are synthesized with
  ids from 6000 in steps of 10, and every fifth one is a production plant.
- The demo scenarios target ids that exist at every size.
- Generation time grows with products times sites. `XL` takes over an hour.

### Currency

`GenerationConfig.currency` sets the three-letter currency code used by all
monetary tables. It defaults to `EUR` and stores the code in uppercase. The CLI
accepts the same setting through `--currency`.

## CLI

```console
uv run sap-mock generate .mock-warehouse --scale-factor 0.1 --scenarios none --currency EUR
uv run sap-mock manifest .mock-warehouse --integrity --output manifest.json
uv run sap-mock --help
```

The manifest records schemas, row and null counts, and canonical content hashes.

## Notebooks

- `notebooks/Generate SAP Mock Data.ipynb` calls the library with Delta storage.
- `notebooks/Explore SAP Mock Data.ipynb` reads and summarizes generated tables.
- `notebooks/databricks/Generate SAP Mock Data.py` defines a notebook-local
  `SparkCatalogStore` and calls the same API.
- `notebooks/databricks/Node Impact Analysis.py` runs the node-impact analysis.

Spark is a storage adapter. Generation logic is in `src/sap_mock_data`.
Notebooks call that package.
