module.exports = {
  presets: [
    "@babel/preset-react",
    ["@babel/preset-env", { useBuiltIns: "usage", corejs: { version: 3 } }],
    "@babel/preset-typescript",
  ],
  plugins: [],
};
