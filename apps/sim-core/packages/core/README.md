# Developing sim-core

### Getting started

From a fresh clone, with [Node](https://nodejs.org/en/), [Rust](https://www.rust-lang.org/learn/get-started) and [Yarn](https://yarnpkg.com/lang/en/) installed, from the root directory of the repository run:

```sh
$ yarn global add wasm-pack && yarn && yarn serve:core
```

### Troubleshooting

### MapBox and the Geospatial tab
To make use of the Geospatial tab in the sim-core IDE, a MapBox API key is needed. 
To provide the key, specify an environment variable of the form `MAPBOX_API_TOKEN=your-mapbox-api-token-here` when running node.  Your operating system's standard ways to provide this variable should all work, however an easy way that works in all environments is as follows:
 1. create a new file `.env` located here in `packages/core/`.
 2. Place your environment variable in this file as a new line in the form above.
 3. Restart node.js (repeat `yarn serve:core`) and refresh your sim-core browser page.

 The Geospatial tab should now be active for you. If there was an issue with the token, MapBox will throw an error indicating the problem.

 You can retrieve your MapBox token from https://account.mapbox.com/access-tokens/. They have a generous free tier.

#### Missing latest XCode Dev Tools?

If the build gets stuck while running `wasm-pack build --target bundler --out-dir wasm/bundler --out-name hash` on macOS, make sure you have installed the latest XCode Dev Tools using"
```
xcode-select --install
```
If you need further debugging info, create a new file in `~/.cargo/config` with contents
```
[net]
git-fetch-with-cli = true
```

#### Issues with cookies

Our APIs are served via HTTPs and browsers are getting increasingly restrictive with regard to sending cookies between different domains when not using HTTPS. You may need to disable a browser flag in order to be able to load the IDE in your browser while developing locally (e.g. at `http://localhost:8080`). You may experience login redirect loops if you do not do this.

- **Chrome:** go to [`chrome://flags`](chrome://flags) and disabling the `SameSite by default` flag
- **Safari:** go to `Preferences > Privacy` and disable `Prevent cross-site tracking`

### Useful scripts

`yarn ws:core` and `yarn ws:core` are sort of workspace helper scripts that you can use to run scripts defined in those repos' `package.json`. All of the scripts described below, and `build:core` and `serve:core` described above are run through one of these helpers.

`yarn start:core` will serve `@hashintel/core` locally, but in production mode

`yarn build:core` will build `@hashintel/core` in production mode, putting assets in `packages/core/dist`

`fmt:core` will run prettier on `@hashintel/core`'s code

`test:core` will run `@hashintel/core`'s tests

`yarn deploy:core` will deploy `@hashintel/core` to staging (`yarn deploy:core production` will deploy to production). To use this, you need to have the aws cli installed and have it configured to an account.

`fmt:engine-web` will run prettier on `@hashintel/engine-web`'s code

`test:engine-web` will run the tests on `@hashintel/engine-web`'s code

### Upgrading Pyodide

Follow these steps to upgrade Pyodide:

  1. Download the desired Pyodide release from the [official GitHub repository](https://github.com/pyodide/pyodide).
  2. Extract the archive and save the directory as `pyodide-<VERSION NUMBER>`. For example `pyodide-0.17.0`.
  3. Upload the directory to S3. For example:
     ```
     aws s3 cp --recursive --acl "public-read" --dryrun pyodide-0.17.0  s3://cdn-us1.hash.ai/pyodide-0.17.0/
     ```
     Remove `--dryrun` for the command to take effect.
  4. Copy the contents of `pyodide.js` from the downloaded archive and place it
     into the function `getPyodideLoader` in `packages/engine-web/src/engine-web/simulation/python/pyodide.js`.
  5. Update `PYODIDE_URL` in `packages/engine-web/src/engine-web/simulation/buildpython.ts`.

