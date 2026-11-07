const { withAppBuildGradle } = require("expo/config-plugins");

// Fork (Hari, L-235): release APKs are signed with Hari's own key when
// HARI_KEYSTORE_PATH is set (GitHub Actions, or a local build with the backup
// key), so each new APK installs over the last one. Without it the release
// build keeps Expo's debug key, as before.
module.exports = function withHariSigning(config) {
  return withAppBuildGradle(config, (config) => {
    let gradle = config.modResults.contents;
    if (gradle.includes("hariRelease")) return config;
    const signing = `
        hariRelease {
            if (System.getenv("HARI_KEYSTORE_PATH")) {
                storeFile file(System.getenv("HARI_KEYSTORE_PATH"))
                storePassword System.getenv("HARI_KEYSTORE_PASSWORD")
                keyAlias System.getenv("HARI_KEY_ALIAS")
                keyPassword System.getenv("HARI_KEY_PASSWORD")
            }
        }`;
    const configs = /signingConfigs\s*\{/;
    if (!configs.test(gradle)) throw new Error("with-hari-signing couldn't find signingConfigs in build.gradle");
    gradle = gradle.replace(configs, (match) => match + signing);
    const release = /(release\s*\{[^}]*?)signingConfig signingConfigs\.debug/;
    if (!release.test(gradle)) throw new Error("with-hari-signing couldn't find the release signingConfig in build.gradle");
    gradle = gradle.replace(
      release,
      '$1signingConfig System.getenv("HARI_KEYSTORE_PATH") ? signingConfigs.hariRelease : signingConfigs.debug',
    );
    config.modResults.contents = gradle;
    return config;
  });
};
