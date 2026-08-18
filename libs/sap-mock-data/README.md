# SAP Mock Data

`sap-mock-data` generates deterministic, interconnected SAP-style master and
transaction data. The pandas generation engine is available through one Python
API and is shared by the CLI, local notebooks, and Databricks notebooks.

Generation has two layers. Pandas creates and mutates tables. A `TableStore`
decides where those tables live. Delta Lake is the default local store. The
Databricks notebook supplies a Unity Catalog adapter.

## Development environment

The library supports Python 3.11 through 3.13 and does not require Nix. Nix is
an optional way to provision the Python and system tools; Python dependencies
come from `pyproject.toml` and are locked in `uv.lock`.

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

The package also works with standard Python tooling when the lock file is not
needed:

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

Local Spark additionally requires a Java 17 or newer JDK available on `PATH`
with `JAVA_HOME` configured. Databricks supplies its own Spark and Java runtime.

### With Nix

The default Nix shell provides pinned Python and uv executables. It deliberately
keeps the same uv-managed Python dependency workflow as the non-Nix setup:

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

PySpark imports are confined to notebooks, so core library and CLI users do not
need Java or Spark in either environment.

## Library API

```python
from sap_mock_data import GenerationConfig, generate_dataset
from sap_mock_data.storage import DeltaTableStore

result = generate_dataset(
    GenerationConfig(random_seed=42, scale_factor=1, scenarios="demo"),
    DeltaTableStore(".mock-warehouse"),
)
print(result.table_count, result.row_counts)
```

Use a new or isolated warehouse path for each run. Generation overwrites its
tables and preserves unrelated tables in an existing store.

For embedding or quick checks, use `MemoryTableStore`. The generation API
accepts any pandas-oriented `TableStore`, including the Databricks adapter shown
in `notebooks/databricks/Generate SAP Mock Data.py`.

Scenario selection accepts `demo`, `none`, `all`, a comma-separated string, or
a sequence of IDs. Explicit scenarios need configuration strings:

```python
GenerationConfig(
    scenarios=["SCN003"],
    scenario_configs={"SCN003": "2000,ALL,20250615,30"},
)
```

## CLI

```console
uv run sap-mock generate .mock-warehouse --scale-factor 0.1 --scenarios none
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

Spark serves as a storage adapter. Generation logic lives under
`src/sap_mock_data`; notebooks call that package.
