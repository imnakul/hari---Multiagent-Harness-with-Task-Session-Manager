// Fork (Hari, L-413): builds and installs "Hari Dev" (own package and scheme)
// beside Hari. Same as `npm run android` with APP_VARIANT=dev, which needs no
// cross-env on Windows. Extra arguments go through, e.g. `npm run android:dev -- --device`.
//
// `expo run:android` reuses an existing `android/` folder as it is, so one
// generated earlier for Hari (its package and version) would build plain Hari
// and fail to install over the newer one. The folder is generated (git-ignored),
// so it is regenerated for Hari Dev first.
import { spawnSync } from "node:child_process";

const env = { ...process.env, APP_VARIANT: "dev" };

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: true, env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("npx", ["expo", "prebuild", "--platform", "android", "--clean", "--no-install"]);
run("npm", ["run", "android", "--", ...process.argv.slice(2)]);
