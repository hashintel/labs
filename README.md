[github_star]: https://github.com/hashintel/labs#
[hash]: https://hash.ai/platform/hash?utm_medium=organic&utm_source=github_readme_labs-repo_apps-sim-core
[hash core]: https://hash.ai/platform/core?utm_medium=organic&utm_source=github_readme_labs-repo_apps-sim-core
[hash engine]: https://hash.ai/platform/engine?utm_medium=organic&utm_source=github_readme_labs-repo_apps-sim-core

[![github_star](https://img.shields.io/github/stars/hashintel/labs?label=Star%20on%20GitHub&style=social)][github_star]

# HASH Core

[HASH Core] (**hCore**) is a self-contained, in-browser environment for building and interfacing with agent-based simulations compatible with [HASH].

It uses a legacy version of hEngine which is no longer maintained, separate from the primary [HASH Engine] (**hEngine**) found in this repository.


## Project Status

**hCore** is currently in the process of transitioning from being closed-source and hosted on our internal infrastructure towards being a free, open-source IDE available to self-host. Much of this code dates from 2019-2020. While we're making it available at this time so that users can continue to work with and run existing simulations, additional migration work is ongoing, and we'll be changing the way simulations are created in the future. Upcoming tasks in 'phase one' of the migration include:

- [X] Temporary removal of legacy Git-based UI elements
- [x] Allow for "project export" functionality in the development environment
- [ ] Re-enable "new simulation" creation flow
- [ ] Introduce local file storage for working offline (outside of local storage)
- [ ] Introduce GitHub integration for simulation management and storage
- [ ] Introduce prompt to ask users to insert Mapbox keys (securely stored) where not provided as an environment variable
- [ ] Re-introduce "Example projects" accessible via the menus
- [ ] Re-enable Git-based UI elements (such as the resources and activity panes, as well as ability to fork projects)
- [ ] Re-enable executing simulations in hCloud from hCore itself (allowing access to cloud-only features such as optimization experiments)

While we work toward completing phase one, please be mindful of the software's current limitations.

Phase two of our migration process involves enabling users to create, work with and run [HASH Core] and [HASH Engine] simulations in the [HASH] application directly. This will involved re-enabling simulation/behavior/dataset publishing directly on HASH, and a whole new approach to using typed entities in simulations.


## Limitations

In its present form, the version of hCore published here is for the most part limited to providing a run-only environment for simulations. Current recommended use is as follows:

1. Run hCore (this `apps/sim-core` project) on `localhost` and view it in your browser
1. To open a simulation, use the 'import' functionality and target a `.zip` file containing a previously exported simulation. _This can be downloaded from a project's hIndex listing page._
1. You can now run and edit this simulation, however file storage is simply maintained within your browser (using `localstorage`), and changes you make will only be preserved within this web browser.
1. You can use the 'recent projects' menu to switch between other projects that you have imported.
1. To experiment with an example project, import an example project .zip file from the `example_projects` folder.

Please exercise caution if authoring work inside the self-hosted environment because any simulations you author are **not being preserved** outside of the browser environment.  These limitations will lift as the project status goals above are accomplished.

## Using hCore

You can either [self-host](#self-hosting) hCore on-prem or in your own cloud, or simply run it [locally](#run-or-develop-locally) on your machine.

A [hosted preview](#hosted) of hCore also exists for demonstration purposes.

## Self-hosting

To host hCore yourself, you need:
1. To build hCore with output suitable for serving directly from a webserver
2. A webserver

There are countless options for this, but we use [Vercel](https://vercel.com/), for which [instructions](#deploying-to-vercel) are below.

### Building the files

First, the environment in which you are building the files must have the correct dependencies available.

If doing so locally, you can follow the [installation instructions](#run-or-develop-locally) below.

If doing so remotely:
1. Ensure Node and Yarn are available in your environment, e.g. by
   - using a Docker image that already has them
   - use a runtime that already has them (e.g. the Vercel Node runtime)
   - installing them as part of your build script
1. Run `sh scripts/install-dependencies.sh`
1. Run `yarn ws:core build  --copy-index-to-root`

The output files will be at `packages/core/dist`. Serve the contents of this folder from your webserver.

### Deploying to Vercel

If you want to host hCore on Vercel, you should:
1. Create a fork of this repository.
1. Create a new project in Vercel, and select your fork.
1. Select 'Other' from framework.
1. In 'Settings' -> 'General', set the 'Root Directory' to `apps/sim-core
 
Deploy (or re-deploy) the project, then visit the preview URL. Future pushes to your fork will result in a new deployment.

## Hosted

A demonstration deployment of hCore can be [found in our sandbox](https://core.labs.hashsandbox.com/).

## Run or develop locally

### Installation

Before running this software, your environment will need to have installed modern versions of:

[Node](https://nodejs.org/en/), [Rust](https://www.rust-lang.org/learn/get-started), and [Yarn](https://yarnpkg.com/lang/en/).

With these in place, you must use yarn to install wasm-pack:
```sh
yarn global add wasm-pack
```

To verify your installation, from the `sim-core` directory run:
```sh
node -v
yarn -v
rustup default
```
If these commands output version numbers, you're all set.
For the first build, simply run:
```sh
yarn
```

#### Supported Environments

The required dependencies above are available (and consistent) across platforms. hCore can be built and run in modern Windows, macOS, and Ubuntu Linux environments, as well as within common VMs and containers.

### Running `sim-core`

To run hCore, after following the [installation](#installation) instructions , run:

```sh
yarn start:core
```

This will compile the application and host it for you at a default location of [`localhost:8080`](http://localhost:8080).

### Development and Troubleshooting

If you want to run the application in development mode, which will enable hot-reloading when you make changes, run:

```sh
yarn serve:core
```

See the README in [`packages/core`](https://github.com/hashintel/labs/tree/main/apps/sim-core/packages/core) for more details.

### Repository Structure

Several different packages in this repository are orchestrated as yarn workspaces. Important packages include:
 - `core`, which is the React/Redux/TypeScript frontend of hCore
 - `engine` contains the hCore simulation engine, written in Rust. This is a legacy engine that is less powerful than the newer [HASH Engine], which [can be found separately](https://github.com/hashintel/labs/tree/main/apps/sim-engine) in this repo.
 - `engine-web` bundles the `engine` package into a WebAssembly-backed JavaScript interface using `wasm-bindgen`.

 Additional utility packages also exist to facilitate minor conveniences.

 While each package can be built and run separately using the `yarn` commands within its package (see the given package's package.json file for guidance), the most common commands you will run are:
 - `yarn start:core`, to rebuild everything and then host the hCore application
 - `yarn serve:core`, to rebuild everything and then host the hCore application, in development mode
 - `yarn`, to rebuild everything.
 - `yarn fmt`, to apply formatting to source code when doing development work
