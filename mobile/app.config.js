// Fork (Hari, L-235): the phone app ships as "Hari" from this fork's GitHub
// releases. app.json stays upstream's file so merges stay clean; this file
// layers the fork's name, icons, version, signing and update check on top.
const { version } = require("../package.json");

// No package imports here: the release workflow loads this file before npm install.
const LIVE_UPDATE_PERMISSIONS = require("./plugins/live-update-permissions");

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

/**
 * Fork (Hari, L-413): "dev" installs beside Hari as "Hari Dev" (own package
 * and link scheme) so a debug build can run next to the release. Anything
 * else leaves the config exactly as the release build has it.
 */
function applyVariant(built, variant) {
  if (variant !== "dev") return built;
  return {
    ...built,
    name: "Hari Dev",
    scheme: "hari-dev",
    ios: {
      ...built.ios,
      infoPlist: { ...built.ios?.infoPlist, CFBundleDisplayName: "Hari Dev" },
    },
    android: { ...built.android, package: `${built.android.package}.dev` },
    extra: { ...built.extra, hari: { ...built.extra.hari, variant: "dev" } },
  };
}

function buildConfig(config, variant) {
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
  // Fork (Hari, L-254): upstream blocks FOREGROUND_SERVICE (no background
  // audio there); Hari's Live Update needs it. See with-live-update-permissions.
  const blockedPermissions = (config.android?.blockedPermissions ?? []).filter(
    (permission) => !LIVE_UPDATE_PERMISSIONS.includes(permission),
  );
  return applyVariant({
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
      blockedPermissions,
      permissions: [
        ...(config.android?.permissions ?? []),
        "android.permission.REQUEST_INSTALL_PACKAGES",
        ...LIVE_UPDATE_PERMISSIONS,
      ],
    },
    plugins: [
      ...plugins,
      "./plugins/with-hari-signing",
      "./plugins/with-system-bars",
      "./plugins/with-live-update-permissions",
      "./plugins/with-hari-shortcuts",
    ],
    // Updates come as whole APKs from GitHub releases, not Expo's update service.
    updates: { enabled: false },
    extra: {
      ...config.extra,
      hari: { version, versionCode: code, repo: HARI_REPO },
    },
  }, variant);
}

module.exports = ({ config }) =>
  buildConfig(config, process.env.APP_VARIANT === "dev" ? "dev" : "release");

module.exports.versionCode = versionCode;
module.exports.buildConfig = buildConfig;
