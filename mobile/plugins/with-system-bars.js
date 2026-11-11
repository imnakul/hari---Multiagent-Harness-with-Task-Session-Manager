const { AndroidConfig, withAndroidStyles } = require("expo/config-plugins");

// Fork (Hari, L-245): no contrast scrim on the 3-button navigation bar, so a
// wallpaper shows under it as it does under the status bar. React Native
// reads this from the theme as it turns edge-to-edge on; the buttons then
// follow the app's scheme (modules/hari-system-bars).
module.exports = function withSystemBars(config) {
  return withAndroidStyles(config, (config) => {
    config.modResults = AndroidConfig.Styles.assignStylesValue(config.modResults, {
      add: true,
      parent: AndroidConfig.Styles.getAppThemeGroup(),
      name: "android:enforceNavigationBarContrast",
      value: "false",
      targetApi: "29",
    });
    return config;
  });
};
