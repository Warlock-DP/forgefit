# ForgeFit cloud-connected Android APK

The downloadable Android package uses `android-cloud/`, **not** the offline Capacitor
project in `frontend/android/`. It opens https://forgefit-rutvik.netlify.app/ using
[Android Browser Helper](https://github.com/GoogleChrome/android-browser-helper)'s
Trusted Web Activity. A compatible installed browser supplies the web runtime.

- Android 7.0+; Chrome or another Trusted Web Activity-compatible browser recommended.
- A small launcher package, without bundled exercise media or web application assets.
- Same hosted app, passkey sign-in, Neon sync and OpenRouter configuration as the website.
- Internet is required for cloud sync and AI; installing the APK does not enable AI or
  provide an API key. Guest-mode data remains local to the browser, as on the website.
- Only the Internet permission; no native exact-alarm, storage, location or camera access.
- Hosted updates are visible without reinstalling. Launcher changes need a new APK.

## Install

Open [ForgeFit Releases](https://github.com/Warlock-DP/forgefit/releases), download the
`ForgeFit-*.apk` asset on your Android phone, then open it. Android may ask you to allow
installation from the browser or file manager used to open the download. Install only
the asset from this repository. Do not disable Play Protect.

The first package is a **beta**, not a Play Store release. Compilation, Android lint,
alignment and the APK's release signature are checked before publication. Actual-device
passkey login, AI requests, notification behavior and full-screen launch still need a
phone test; build checks alone do not establish those behaviors.

## Full-screen verification

The website must serve `frontend/public/.well-known/assetlinks.json` at
`https://forgefit-rutvik.netlify.app/.well-known/assetlinks.json`. It contains only the
public package name and SHA-256 signing-certificate fingerprint, not a private key.

Merge/deploy this file to the hosted site to enable verification. Until the deployed
file matches the installed APK, the browser opens the site with a visible address bar
(Custom Tab fallback). Do not disable browser verification to work around this.

## Build an unsigned APK

Requires Java 21 and an Android SDK with platform/build-tools 36. Set `JAVA_HOME` and
`ANDROID_HOME` to their installation directories, then:

```sh
cd android-cloud
./gradlew --no-daemon assembleRelease lintRelease
```

On Windows, use `gradlew.bat`. Output:
`android-cloud/app/build/outputs/apk/release/app-release-unsigned.apk`.
The Android GitHub workflow builds/lints this same project and uploads an **unsigned**
CI artifact. That is not an installable release and must not be published as one.

## Sign on Windows

From the repository root, with PowerShell 7:

```powershell
./scripts/build-android-release.ps1 -JavaDirectory 'C:\path\to\jdk' -SdkDirectory 'D:\path\to\Android\Sdk'
```

The helper builds/lints, aligns, signs and verifies the APK. It generates a release
keystore once and reuses it, with its password encrypted by Windows DPAPI. Both are
kept outside the repository, under `%LOCALAPPDATA%\ForgeFit\AndroidSigning`, with an
ACL limited to the current user and SYSTEM. The password is not printed or passed on
the command line. No private key or password is uploaded to GitHub.

**Keep and back up the signing key.** Updates must use the same key; replacing it
prevents installation over the existing app. DPAPI's encrypted password file is tied
to this Windows user/machine: simply copying the XML to another computer is not a
portable password backup. Export a protected, portable backup before replacing this
computer/user account. Never commit the keystore or its password.

Generated public artifacts under `android-cloud/artifacts/`:

- `ForgeFit-<version>.apk`: installable, release-signed APK.
- `SHA256SUMS.txt`: the download's SHA-256 checksum.
- `assetlinks.generated.json`: public certificate association; compare with the
  committed website file before publishing. Do not publish a mismatching signature.

On other operating systems, keep the keystore in a protected location outside the
checkout and use the Android SDK's `zipalign` and `apksigner` tools with password
environment variables, never passwords in shell history.

## Publish and update

Increase `versionCode` and update `versionName` in `android-cloud/app/build.gradle`.
Build and sign with the original keystore; verify the signature and `SHA256SUMS.txt`.
Tag the exact source commit and attach only the signed APK and its checksum file to a
GitHub Release. Mark untested-device builds as prereleases and disclose pending
verification. The release source remains available under this repository's AGPL.

Primary references: [Android Trusted Web Activities](https://developer.android.com/develop/ui/views/layout/webapps/trusted-web-activities),
[verification and signing guide](https://developer.android.com/develop/ui/views/layout/webapps/guide-trusted-web-activities-version2).
