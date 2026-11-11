const { withAndroidManifest } = require("expo/config-plugins");

// Fork (Hari, L-254): Hari's Live Update is a foreground service. Upstream
// blocks FOREGROUND_SERVICE (app.config.js unblocks it), and a manifest left
// by an earlier `expo prebuild` can still carry tools:node="remove" for it,
// which strips the hari-live module's own declaration at build time. Android
// then refuses startForeground and Live Updates turn themselves off.
const LIVE_UPDATE_PERMISSIONS = [
  "android.permission.FOREGROUND_SERVICE",
  "android.permission.FOREGROUND_SERVICE_SPECIAL_USE",
];

module.exports = function withLiveUpdatePermissions(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    const kept = (manifest["uses-permission"] ?? []).filter(
      (entry) => !LIVE_UPDATE_PERMISSIONS.includes(entry.$["android:name"]),
    );
    manifest["uses-permission"] = [
      ...kept,
      ...LIVE_UPDATE_PERMISSIONS.map((name) => ({ $: { "android:name": name } })),
    ];
    return config;
  });
};

module.exports.LIVE_UPDATE_PERMISSIONS = LIVE_UPDATE_PERMISSIONS;
