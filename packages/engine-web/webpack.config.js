const path = require("path");

module.exports = {
  entry: "./src/stdlib/ts/stdlib.ts",
  output: {
    filename: "hash_stdlib.js",
    path: path.join(__dirname, "dist"),
    library: "hash_stdlib",
    libraryTarget: "var",
  },
  resolve: {
    extensions: [".ts", ".js"],
  },
  module: {
    rules: [
      {
        test: /\.(t|j)s$/,
        exclude: /node_modules/,
        use: {
          loader: "babel-loader",
          options: {
            cacheDirectory: true,
          },
        },
      },
    ],
  },
};
