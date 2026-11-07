// Fork (Hari, L-235): the phone app ships as "Hari" from this fork's GitHub
// releases. app.json stays upstream's file so merges stay clean; this file
// layers the fork's name, icons, version, signing and update check on top.
const { version } = require("../package.json");

const HARI_REPO = "imnakul/hari---Multiagent-Harness-with-Task-Session-Manager";

/**
 * Android's build number, which must grow with every release:
 * 0.16.0-local27 → 160027 (minor·10000 + patch·100 + local).
 */
function versionCode(text) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-local(\d+))?$/.exec(text);
  if (!match) throw new Error(`Hari can't read the version ${text}`);
  const [, major, minor, patch, local = "0"] = match.map((part) => part ?? "0");
  const local_ = Number(local);
  if (Number(patch) > 99 || local_ > 99) throw new Error(`Version ${text} is outside Hari's build number range`);
  return Number(major) * 1_000_000 + Number(minor) * 10_000 + Number(patch) * 100 + local_;
}

module.exports = ({ config }) => {
  const code = versionCode(version);
  const plugins = config.plugins.map((plugin) =>
    Array.isArray(plugin) && plugin[0] === "expo-splash-screen"
      ? [
          "expo-splash-screen",
          {
            backgroundColor: "#f3f6f4",
            image: "./assets/images/hari-splash.png",
            imageWidth: 160,
            dark: { backgroundColor: "#000000", image: "./assets/images/hari-splash.png" },
          },
        ]
      : plugin,
  );
  return {
    ...config,
    name: "Hari",
    version,
    icon: "./assets/images/hari-icon.png",
    ios: {
      ...config.ios,
      infoPlist: { ...config.ios?.infoPlist, CFBundleDisplayName: "Hari" },
    },
    android: {
      ...config.android,
      versionCode: code,
      adaptiveIcon: {
        backgroundColor: "#e8f1f2",
        foregroundImage: "./assets/images/hari-android-foreground.png",
        backgroundImage: "./assets/images/hari-android-background.png",
        monochromeImage: "./assets/images/hari-android-monochrome.png",
      },
      permissions: [...(config.android?.permissions ?? []), "android.permission.REQUEST_INSTALL_PACKAGES"],
    },
    plugins: [...plugins, "./plugins/with-hari-signing"],
    // Updates come as whole APKs from GitHub releases, not Expo's update service.
    updates: { enabled: false },
    extra: {
      ...config.extra,
      hari: { version, versionCode: code, repo: HARI_REPO },
    },
  };
};

module.exports.versionCode = versionCode;
