[discord]: https://hash.ai/discord?utm_medium=organic&utm_source=github_readme_labs-repo_root
[github_star]: https://github.com/hashintel/labs#
[hash]: https://hash.ai/platform/hash?utm_medium=organic&utm_source=github_readme_labs-repo_root
[hash core]: https://hash.ai/platform/core?utm_medium=organic&utm_source=github_readme_labs-repo_root
[hash engine]: https://hash.ai/platform/engine?utm_medium=organic&utm_source=github_readme_labs-repo_root
[repository guidelines]: https://github.com/hashintel/labs/blob/main/.github/CONTRIBUTING.md

[![discord](https://img.shields.io/discord/840573247803097118)][discord] [![github_star](https://img.shields.io/github/stars/hashintel/labs?label=Star%20on%20GitHub&style=social)][github_star]

# Labs

**A public laboratory for HASH's experiments 🧪** 

This repository contains code snippets, examples and experimental work made public. Projects from our private [`internal-labs`](https://github.com/hashintel/internal-labs) (🔒) monorepo for experiments will be moved here and published when safe and practical to do so, in line with our [commitment to open-source](https://hash.dev/blog/open-source).

## Apps

The `apps` directory contains the source-code and/or content for a number of runnable applications.

### Simulation Tools

The [HASH] app seeks to enable its users to make better decisions by utilizing all of the information available to them. Generative simulation is a core part of realizing this vision. In anticipation of integrating these capabilities, we have developed a variety of standalone tools for agent-based modeling. These simulation tools remain experimental, but we are open to accepting contributions to these in line with our [repository guidelines].

- [`sim-core`](apps/sim-core) is an open-source, locally-runnable version of [HASH Core]  
- [`sim-core-plugins`](apps/sim-core-plugins) contains an example external plugin developed for hCore, which provides a visual interface for process modeling
- [`sim-engine`](apps/sim-engine) contains [HASH Engine], a versatile agent-based simulation engine written in Rust (with support for TypeScript & Python sims)

## Libs

### Block Protocol Libraries

- [`turbine`](libs/turbine)
- [`turbine-transformer`](libs/turbine-transformer) 

## POCs

The `pocs` folder contains **proof of concepts** and other one-off experiments.

- [`distributed_collab`](pocs/distributed_collab) - **Distributed Collab**: a BEAM VM based system for publishing/subscribing to JSON Patches with core logic implemented in Rust
- [`hash-agents`](pocs/hash-agents) - **HASH Agents**: an experimental setup for writing Python-based 'agents' that interface with LLMs
- [`hash_helm_chart`](pocs/hash_helm_chart) - **HASH Helm Charts**: An experimental [Helm](https://helm.sh) chart for deploying (now outdated, legacy) instances of HASH on Kubernetes

A number of older POCs can be found in our `hasharchives` organization, including:
- [`wasm-ts-esm-in-node-jest-and-nextjs`](https://github.com/hasharchives/wasm-ts-esm-in-node-jest-and-nextjs) - A **Wasm + TypeScript + ESM in Node.js, Jest and Next.js 13** example project
