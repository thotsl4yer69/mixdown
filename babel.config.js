module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    plugins: [
      // Must stay last in the plugins array — Reanimated's Babel plugin
      // rewrites worklets and needs to run after everything else.
      "react-native-reanimated/plugin",
    ],
  };
};
