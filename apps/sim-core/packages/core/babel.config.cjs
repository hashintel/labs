module.exports = {
  presets: [
    "@babel/preset-react",
    ["@babel/preset-env", { useBuiltIns: "usage", corejs: { version: "3.8" } }],
    "@babel/preset-typescript",
  ],
  plugins: [],
};
