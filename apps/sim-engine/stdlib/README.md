# HASH Standard Library

[HASH](https://hash.ai/?utm_medium=organic&utm_source=github_readme_labs-repo_sim-engine-stdlib) is a platform for building and running simulations, and the [standard library](https://hash.dev/docs/simulations/create/libraries?utm_medium=organic&utm_source=github_readme_labs-repo_sim-engine-stdlib) contains helper functions for simulations.

The HASH Standard Library (or **stdlib**) is available by default within HASH's browser-based IDE, [hCore](https://hash.ai/platform/core?utm_medium=organic&utm_source=github_readme_labs-repo_sim-engine-stdlib).

You can call HASH stdlib functions from within [behaviors](https://hash.dev/docs/simulations/create/behaviors?utm_medium=organic&utm_source=github_readme_labs-repo_sim-engine-stdlib) using `hstd.[function name]`. For example, to get the distance between two agents in JavaScript, use `hstd.distanceBetween(agentA, agentB)`.

## Developing

The repo is split between [JavaScript functions](https://github.com/hashintel/labs/tree/main/apps/engine/stdlib/src/ts) — written in TypeScript — and [Python functions](https://github.com/hashintel/labs/tree/main/apps/engine/stdlib/src/py).

### JavaScript

To contribute to the JavaScript standard library, please install [npm](https://www.npmjs.com/get-npm), and run `npm install` at the base directory of this repo to get set up.

Some useful commands:

```shell
# Build the standard library
npm run build

# Run the tests (you may need to install jest globally: npm install -g jest)
npm run test
```

We use ESLint to help find errors and enforce code style. Your editor or IDE likely has an ESLint plugin which will show these errors and warnings automatically. Alternatively, you can run ESLint from your terminal:

```shell
npm run lint
```

### Python

To contribute to the Python standard library, we recommend using a Python virtual
environment.

To install the development dependencies run:

```shell
pip install -r src/py/dev_requirements.txt
```

Useful commands:

```shell
# Run the tests
pytest

# Code formatting
black ./src/py

# Type checking
mypy ./src/py
```

## Discussion

You can open an [issue](https://github.com/hashintel/labs/issues) or create a [discussion](https://github.com/hashintel/labs/discussions) on our public [`labs` repository](https://github.com/hashintel/labs) to get support with or discuss HASH and the HASH stdlib.
