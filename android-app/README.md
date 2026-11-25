# Android app

A thin Capacitor shell that opens vertexhash.com. The `android/` project is generated in CI (`.github/workflows/android.yml`), not stored here.

## Updates

The app updates itself (Android only installs the new file when it is signed with the SAME key as the installed app).

- CI (signed build on main) publishes a GitHub release `app-v<versionCode>` with `vertexhash-<n>.apk`, `patch-<from>-<n>.vxp` and `manifest.json` (`tools/release.py`).
- The site (`/api/app-update?code=<installed code>`, `lib/app-update.js`) reads the newest release and answers with the download links. Links are built by the site from a fixed GitHub address.
- The page (`components/AppUpdate.js`) shows a bar inside the app, asks the native plugin (`native/AppUpdaterPlugin.java`) to download, then opens the Android installer. The check is remembered for 3 hours.
- Partial downloads: a stopped download keeps its `.part` file and goes on from there (HTTP Range); 4 quick retries per start.
- Differential updates: when the installed app is the one the patch was made from (hash checked), only the patch is downloaded and applied (`native/VxPatch.java`); the result is checked against the hash from the manifest. Any mismatch falls back to the full file.
- No signing secrets = no release = no update offered. First time: the installed app must be a release-signed build that has the updater (older builds and debug builds cannot update; install the signed one once by hand).

Secrets (repo Settings > Secrets > Actions): `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEY_ALIAS`, `ANDROID_KEYSTORE_PASSWORD`, optional `ANDROID_KEY_PASSWORD`. Keep the keystore safe: losing it means nobody can update the app.

Check a patch by hand: `python3 tools/release.py make --code 12 --apk new.apk --out rel --prev-apk old.apk --prev-code 11` (needs the `bsdiff` tool).
