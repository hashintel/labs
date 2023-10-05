[discord]: https://hash.ai/discord?utm_medium=organic&utm_source=github_readme_labs-repo_apps-sim-core
[github_star]: https://github.com/hashintel/labs#
[hash]: https://hash.ai/platform/hash?utm_medium=organic&utm_source=github_readme_labs-repo_apps-sim-core
[hash core]: https://hash.ai/platform/core?utm_medium=organic&utm_source=github_readme_labs-repo_apps-sim-core
[hash engine]: https://hash.ai/platform/engine?utm_medium=organic&utm_source=github_readme_labs-repo_apps-sim-core

[![discord](https://img.shields.io/discord/840573247803097118)][discord] [![github_star](https://img.shields.io/github/stars/hashintel/labs?label=Star%20on%20GitHub&style=social)][github_star]

# HASH Core

[HASH Core] (**hCore**) is a self-contained, in-browser environment for building and interfacing with agent-based simulations compatible with [HASH].

It uses a legacy version of hEngine which is no longer maintained, separate from the primary [HASH Engine] (**hEngine**) found in this repository.


## Project Status

**hCore** is currently in the process of transitioning from being closed-source and hosted on our internal infrastructure towards being a free, open-source IDE available to self-host. Much of this code dates from 2019-2020. While we're making it available at this time so that users can continue to work with and run existing simulations, additional migration work is ongoing, and we'll be changing the way simulations are created in the future. Upcoming tasks in 'phase one' of the migration include:

- [ ] Re-enabling 'new simulation' creation flow
- [ ] Allow for "Project Export" functionality in the development environment
- [ ] Direct GitHub integration for simulation management and storage
- [X] Removal of legacy UI elements which no longer function

While we work toward completing phase one, please be mindful of the software's current limitations.

Phase two of our migration process involves enabling users to create, work with and run [HASH Core] and [HASH Engine] simulations in the [HASH] application directly.

## Limitations

In its present form, the version of hCore published here is for the most part limited to providing a run-only environment for simulations. Current recommended use is as follows:

1) Run hCore (this `apps/sim-core` project) on `localhost` and view it in your browser
2) To open a simulation, use the 'import' functionality and target a .zip file containing a previously exported simluation.
3) You can now run and edit this simulation, however file storage is simply maintained within your browser (using `localstorage`), and changes you make will only be preserved within this web browser.
4) You can use the 'recent projects' menu to switch between other projects that you have imported.
5) To experiment with an example project, import an example project .zip file from the `example_projects` folder.

Please exercise caution if authoring work inside the self-hosted environment because any simulations you author are **not being presreved** outside of the browser environment.  These limitations will lift as the project status goals above are accomplished.

## Installation

Before running this software, your environment will need to have installed modern versions of:

[Node](https://nodejs.org/en/), [Rust](https://www.rust-lang.org/learn/get-started), and [Yarn](https://yarnpkg.com/lang/en/).

With these in place, you must use yarn to install wasm-pack:
```sh
yarn global add wasm-pack
```

To verify your installation, from the `sim-core` directory run
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

### Supported Environments

The above requirements are all cross-platform, and as such sim-core can build and run in modern Windows, OSX, and Ubuntu, as well as within common VM's and containers.
## Running `sim-core`

To run the sim-core IDE, run:

```sh
yarn serve:core
```

This will compile the application and host it for you at a default location of [localhost:8080](http://localhost:8080)

### Development and Troubleshooting

See the README in [`packages/core`](https://github.com/hashintel/labs/tree/main/apps/sim-core/packages/core) for more details


### Repository Structure

Several different packages in this repository are orchistrated as yarn workspaces.  The key packages are:
 - `core`, which is the React/Redux/Typescript frontend for the simulation engine. 
 - `engine`, which is the rust implementation of the simulation engine
 - `engine-web`, which bundles the rust-based `engine` into a webassembly-backed javascript interface using `wasm-bindgen`.

 Additional utility packages also exist to facilitate minor conveniences.

 While each package can be built and run separately using the `yarn` commands within its package (see the given package's package.json file for  guidance), in general they'll all be built together by running the `yarn` command from the `sim-core` folder.