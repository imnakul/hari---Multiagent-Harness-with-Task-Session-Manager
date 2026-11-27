const fs = require("fs");
const path = require("path");
const { AndroidConfig, withAndroidManifest, withDangerousMod, withStringsXml } = require("expo/config-plugins");

// Fork (Hari, L-406): Hari's app shortcuts, declared in the manifest. Apps that
// run shortcuts (edge-swipe launchers like Hinata) read only these static ones
// from an app's manifest, not shortcuts an app publishes while it runs. The
// file is written here, not in the hari-live module, because each intent must
// name the app's own package, which only the app config knows.

const FILE = "hari_shortcuts";

const STRINGS = {
  hari_shortcut_send: "Send to computer",
  hari_shortcut_send_long: "Send the clipboard to your computer",
  hari_shortcut_share: "Open Share",
  hari_shortcut_share_long: "Open Share with your computer",
};

function shortcutsXml(pkg) {
  return `<?xml version="1.0" encoding="utf-8"?>
<shortcuts xmlns:android="http://schemas.android.com/apk/res/android">
  <!-- The clipboard's text, link or picture, sent even when it repeats (as the tile does). -->
  <shortcut
    android:shortcutId="send-clipboard"
    android:enabled="true"
    android:icon="@mipmap/ic_launcher"
    android:shortcutShortLabel="@string/hari_shortcut_send"
    android:shortcutLongLabel="@string/hari_shortcut_send_long">
    <intent
      android:action="expo.modules.harilive.SHARE_CLIPBOARD"
      android:targetPackage="${pkg}"
      android:targetClass="expo.modules.harilive.HariShareActivity" />
  </shortcut>
  <shortcut
    android:shortcutId="open-share"
    android:enabled="true"
    android:icon="@mipmap/ic_launcher"
    android:shortcutShortLabel="@string/hari_shortcut_share"
    android:shortcutLongLabel="@string/hari_shortcut_share_long">
    <intent
      android:action="android.intent.action.VIEW"
      android:data="monocode://share"
      android:targetPackage="${pkg}"
      android:targetClass="${pkg}.MainActivity" />
  </shortcut>
</shortcuts>
`;
}

module.exports = function withHariShortcuts(config) {
  config = withStringsXml(config, (config) => {
    for (const [name, value] of Object.entries(STRINGS)) {
      config.modResults = AndroidConfig.Strings.setStringItem(
        [AndroidConfig.Resources.buildResourceItem({ name, value })],
        config.modResults,
      );
    }
    return config;
  });
  config = withAndroidManifest(config, (config) => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(config.modResults);
    const kept = (activity["meta-data"] ?? []).filter((entry) => entry.$["android:name"] !== "android.app.shortcuts");
    activity["meta-data"] = [
      ...kept,
      { $: { "android:name": "android.app.shortcuts", "android:resource": `@xml/${FILE}` } },
    ];
    return config;
  });
  return withDangerousMod(config, [
    "android",
    (config) => {
      const pkg = config.android?.package;
      if (!pkg) throw new Error("with-hari-shortcuts: android.package is not set");
      const dir = path.join(config.modRequest.platformProjectRoot, "app", "src", "main", "res", "xml");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${FILE}.xml`), shortcutsXml(pkg));
      return config;
    },
  ]);
};
