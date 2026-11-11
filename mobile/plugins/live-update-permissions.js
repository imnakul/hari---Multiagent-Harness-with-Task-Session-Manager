// Fork (Hari, L-254): the permissions Hari's Live Update foreground service
// needs. A file of its own with no imports: app.config.js reads it, and the
// release workflow loads app.config.js before any package is installed.
module.exports = [
  "android.permission.FOREGROUND_SERVICE",
  "android.permission.FOREGROUND_SERVICE_SPECIAL_USE",
];
