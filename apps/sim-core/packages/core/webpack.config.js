const path = require("path");
const timestamp = require("time-stamp");
const urljoin = require("url-join");
const webpack = require("webpack");
const ForkTsCheckerWebpackPlugin = require("fork-ts-checker-webpack-plugin");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const ManifestPlugin = require("webpack-manifest-plugin");
const MonacoWebpackPlugin = require("monaco-editor-webpack-plugin");
const SentryWebpackPlugin = require("@sentry/webpack-plugin");
const WebpackMessages = require("webpack-messages");
const { RetryChunkLoadPlugin } = require("webpack-retry-chunk-load-plugin");
const { UnusedModulesWebpackPlugin } = require("unused-modules-webpack-plugin");
require("dotenv").config();

const {
  description: defaultMetaDescription,
  image: defaultMetaImage,
} = require("./src/metaTags.json");

module.exports = (_env, argv) => {
  const isProduction = argv.mode === "production";

  const BUILD_STAMP = [
    "hash",
    isProduction ? "prod" : "dev",
    timestamp.utc("YYYY-MM-DD-THHmm_ssms"),
  ]
    .concat(
      process && process.env && process.env.CIRCLE_PR_NUMBER
        ? ["pr", process.env.CIRCLE_PR_NUMBER]
        : []
    )
    .join("-");

  const OUTPUT_PATH = path.resolve(__dirname, `dist/${BUILD_STAMP}/`);
  const PUBLIC_PATH = `/${BUILD_STAMP}/`;

  const sharedManifest = { BUILD_STAMP: BUILD_STAMP };

  const browserConfig = {
    entry: {
      index: path.join(__dirname, "/src/index.tsx"),
      embed: path.join(__dirname, "/src/embed.tsx"),
    },
    output: {
      path: OUTPUT_PATH,
      filename: "[name].js",
      publicPath: PUBLIC_PATH,
    },
    resolve: {
      extensions: [
        ".ts", // Add typescript support
        ".tsx", // Add typescript + react support
        ".js", // Preserving webpack default
        ".jsx", // Preserving webpack default
        ".json", // Preserving webpack default
        ".css", // Preserving webpack default
      ],
      alias: {
        lodash: "lodash-es",
        "lodash.omit": "lodash-es/omit",
        "lodash.pick": "lodash-es/pick",

        // We want to control how this is included in the bundle
        "@juggle/resize-observer$": "empty-module",
      },
    },
    module: {
      rules: [
        /**
         * Work around an issue with simplebar CSS being incorrectly tree shaken
         * Remove when the below issue is fixed
         * @see https://github.com/Grsmto/simplebar/issues/511
         */
        {
          test: /node_modules\/simplebar-react\/dist\/simplebar.min.css/,
          sideEffects: true,
        },
        {
          test: /\.s?css$/i,
          use: [
            "style-loader",
            "css-loader",
            {
              loader: "postcss-loader",
              options: {
                postcssOptions: {
                  plugins: [["autoprefixer"]],
                },
              },
            },
            "sass-loader",
          ],
        },
        {
          test: /\.(t|j)sx?$/,
          exclude: /node_modules/,
          use: {
            loader: "babel-loader",
            options: {
              cacheDirectory: true,
              // cacheCompression: false
            },
          },
        },
        {
          test: /\.(png|woff|woff2|eot|ttf|svg)$/,
          loader: "url-loader",
          options: { limit: 100000 },
        },
      ],
    },
    plugins: [
      new webpack.DefinePlugin({
        // Share PUBLIC_PATH with our app to help us with dynamic loading, e.g. the webworker path.
        // ...The value is injected into the output verbatim, so we must manually put "'s on it.
        WEBPACK_PUBLIC_PATH: `"${PUBLIC_PATH}"`,
        WEBPACK_BUILD_STAMP: `"${BUILD_STAMP}"`,
        LOCAL_API: process.env.LOCAL_API === "true",
        MAPBOX_API_TOKEN: process.env.MAPBOX_API_TOKEN
          ? `"${process.env.MAPBOX_API_TOKEN}"`
          : `null`,
      }),
      /**
       * for a list of all available options/languages/features
       * @see https://github.com/microsoft/monaco-editor-webpack-plugin#options
       */
      new MonacoWebpackPlugin({
        languages: [
          "javascript",
          "json",
          "markdown",
          "python",
          "rust",
          "typescript", // Monaco javascript depends on typescript
        ],
      }),
      new WebpackMessages({
        name: "client",
        logger: (str) => console.log(`>> ${str}`),
      }),
      new HtmlWebpackPlugin({
        template: path.join(__dirname, "/src/index.html"),
        chunks: ["index"],
        templateParameters: {
          meta_description: defaultMetaDescription,
          meta_image: defaultMetaImage,
        },
      }),
      new HtmlWebpackPlugin({
        template: path.join(__dirname, "/src/index.html"),
        chunks: ["embed"],
        filename: "embed.html",
        templateParameters: {
          meta_description: defaultMetaDescription,
          meta_image: defaultMetaImage,
        },
      }),
      new ManifestPlugin({
        seed: sharedManifest,
      }),
      new ForkTsCheckerWebpackPlugin(),
      new UnusedModulesWebpackPlugin({
        patterns: [
          "src/**/**.ts",
          "src/**/**.tsx",
          "!src/**/types.ts",
          "!src/**/mocks.ts",
          "!src/util/simulation/mock-coreweb.ts",
          "!src/workers/analyzer-worker/index.ts",
          "!src/workers/simulation-worker/index.ts",
          "!src/setupTests.ts",
          "!src/**/**.spec.ts",
          "!src/**/**.spec.tsx",
          "!src/**/**.d.ts",
        ],
        globOptions: { ignore: "node_modules/**/*" },
      }),
      /**
       * v2.x of this plugin must be used if we upgrade to Webpack 5+.
       * @todo remove this comment when using Webpack 5+.
       * */
      new RetryChunkLoadPlugin({
        maxRetries: 2,
      }),
    ],
    devtool: "source-map",
    devServer: {
      // does not work with the sandbox iframe.
      disableHostCheck: true,
      hot: false,
      inline: false,
      stats: "errors-only",
      // https://stackoverflow.com/a/34125010
      // Instruct webpack-dev-server to behave like a SPA
      historyApiFallback: {
        rewrites: [
          { from: /^\/embed.html/, to: urljoin(PUBLIC_PATH, "embed.html") },
          { from: /./, to: urljoin(PUBLIC_PATH, "index.html") },
        ],
      },
    },
    optimization: {
      usedExports: true,
      splitChunks: {
        chunks: "all",
      },
    },
  };

  const simulationWorkerConfig = {
    entry: path.join(__dirname, "./src/workers/simulation-worker/index.ts"),
    target: "webworker",
    output: {
      path: OUTPUT_PATH,
      filename: "simulationworker.js",
      publicPath: PUBLIC_PATH,
    },
    resolve: {
      extensions: [
        ".ts", // Add typescript support
        // ".tsx", // Add typescript + react support
        ".js", // Preserving webpack default
        // ".jsx", // Preserving webpack default
        ".json", // Preserving webpack default
        ".css", // Preserving webpack default
      ],
    },
    module: {
      rules: [
        {
          test: /\.(j|t)sx?$/,
          exclude: /node_modules/,
          use: {
            loader: "babel-loader",
            options: {
              cacheDirectory: true,
            },
          },
        },
        {
          test: /\.py$/i,
          use: [
            {
              loader: "raw-loader",
              options: {
                esModule: false,
              },
            },
          ],
        },
      ],
    },
    devtool: "source-map",
    plugins: [
      new ManifestPlugin({
        seed: sharedManifest,
      }),
    ],
  };

  const analyzerWorkerConfig = {
    entry: path.join(__dirname, "./src/workers/analyzer-worker/index.ts"),
    target: "webworker",
    output: {
      path: OUTPUT_PATH,
      filename: "analyzerworker.js",
      publicPath: PUBLIC_PATH,
    },
    resolve: {
      extensions: [
        ".ts", // Add typescript support
        // ".tsx", // Add typescript + react support
        ".js", // Preserving webpack default
        // ".jsx", // Preserving webpack default
        ".json", // Preserving webpack default
        ".css", // Preserving webpack default
      ],
    },
    module: {
      rules: [
        {
          test: /\.(j|t)sx?$/,
          exclude: /node_modules/,
          use: {
            loader: "babel-loader",
            options: {
              cacheDirectory: true,
              // cacheCompression: false
            },
          },
        },
      ],
    },
    devtool: "source-map",
    plugins: [
      new ManifestPlugin({
        seed: sharedManifest,
      }),
    ],
  };

  // Migration shim
  // Sentry disabled during hCore migration
  if (isProduction && false) {
    const sentryPlugin = new SentryWebpackPlugin({
      authToken: process.env.SENTRY_AUTH_TOKEN,
      include: `./dist/${BUILD_STAMP}`,
      org: "hashintel",
      project: "hash-core",
      release: BUILD_STAMP,
      urlPrefix: `~/${BUILD_STAMP}/`,
    });
    browserConfig.plugins.push(sentryPlugin);
    simulationWorkerConfig.plugins.push(sentryPlugin);
    analyzerWorkerConfig.plugins.push(sentryPlugin);
  }

  if (argv["copy-index-to-root"]) {
    /**
     * Also output index.html to the root of the dist/ directory so that the contents of dist/
     * can be served directly by a webserver.
     *
     * This is necessary because JS scripts are injected into HTML files assuming a `/[BUILD_STAMP]/[filename]` path,
     * which means index.html must be located above `/[BUILD_STAMP]/`. The default config outputs it to `/[BUILD_STAMP]/`.
     * The default config is to allow for past versions of the app to be retained in the dist/ directory.
     */
    browserConfig.plugins.push(
      new HtmlWebpackPlugin({
        template: path.join(__dirname, "/src/index.html"),
        chunks: ["index"],
        filename: "../index.html",
        templateParameters: {
          meta_description: defaultMetaDescription,
          meta_image: defaultMetaImage,
        },
      })
    );
  }

  return [browserConfig, simulationWorkerConfig, analyzerWorkerConfig];
};
