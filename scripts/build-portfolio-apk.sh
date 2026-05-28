#!/usr/bin/env bash
set -euo pipefail

# ─── Config ───────────────────────────────────────────────────────────────────
APP_ID="portfolio"
PACKAGE="com.kisushotto.portfolio"
HOST="portfolio.kisushotto.com"
APP_NAME="Portfolio"
VERSION_CODE=1
VERSION_NAME="1.0"
THEME_COLOR="#9B70F0"
STATUS_BAR_COLOR="#0c0c14"
NAV_BAR_COLOR="#0c0c14"
BG_COLOR="#0c0c14"
KEY_ALIAS="${APP_ID}key"

# ─── Paths ────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
JDK="$HOME/.local/jdk17"
SDK="$HOME/.android-sdk"
GRADLE_HOME="$HOME/.local/gradle-8.4"
TWA="$ROOT/${APP_ID}-twa/build-src"
RES="$TWA/app/src/main/res"
KEYSTORE="$ROOT/${APP_ID}-twa.keystore"
KS_PASS_FILE="$ROOT/.ks_pass_${APP_ID}"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║  Portfolio TWA APK Builder               ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ─── Step 1: JDK 17 ───────────────────────────────────────────────────────────
if [ ! -f "$JDK/bin/java" ]; then
  echo "→ Downloading JDK 17 (Temurin, ~185MB)..."
  mkdir -p "$JDK"
  wget -q --show-progress -O /tmp/jdk17.tar.gz \
    "https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.9%2B9/OpenJDK17U-jdk_x64_linux_hotspot_17.0.9_9.tar.gz"
  tar -xzf /tmp/jdk17.tar.gz -C "$JDK" --strip-components=1
  rm /tmp/jdk17.tar.gz
  echo "  ✓ JDK 17 ready at $JDK"
else
  echo "✓ JDK 17 already installed"
fi
export JAVA_HOME="$JDK"
export PATH="$JAVA_HOME/bin:$PATH"

# ─── Step 2: Android SDK ──────────────────────────────────────────────────────
CMDTOOLS="$SDK/cmdline-tools/latest"
if [ ! -f "$CMDTOOLS/bin/sdkmanager" ]; then
  echo "→ Downloading Android SDK cmdline-tools..."
  mkdir -p "$SDK/cmdline-tools"
  wget -q --show-progress -O /tmp/cmdtools.zip \
    "https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip"
  unzip -q /tmp/cmdtools.zip -d /tmp/cmdtools_tmp
  mv /tmp/cmdtools_tmp/cmdline-tools "$CMDTOOLS"
  rm -rf /tmp/cmdtools.zip /tmp/cmdtools_tmp
  echo "  ✓ cmdline-tools ready"
else
  echo "✓ Android cmdline-tools already installed"
fi
export ANDROID_HOME="$SDK"
export PATH="$CMDTOOLS/bin:$SDK/platform-tools:$SDK/build-tools/34.0.0:$PATH"

if [ ! -d "$SDK/platforms/android-34" ]; then
  echo "→ Installing Android SDK packages (platform-tools, android-34, build-tools 34)..."
  yes | sdkmanager --licenses > /dev/null 2>&1 || true
  sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0"
  echo "  ✓ SDK packages installed"
else
  echo "✓ Android SDK packages already installed"
fi

# ─── Step 3: Gradle 8.4 ───────────────────────────────────────────────────────
if [ ! -f "$GRADLE_HOME/bin/gradle" ]; then
  echo "→ Downloading Gradle 8.4 (~130MB)..."
  wget -q --show-progress -O /tmp/gradle.zip \
    "https://services.gradle.org/distributions/gradle-8.4-bin.zip"
  unzip -q /tmp/gradle.zip -d "$HOME/.local/"
  rm /tmp/gradle.zip
  echo "  ✓ Gradle 8.4 ready at $GRADLE_HOME"
else
  echo "✓ Gradle 8.4 already installed"
fi
export PATH="$GRADLE_HOME/bin:$PATH"

# ─── Step 4: Keystore ─────────────────────────────────────────────────────────
if [ ! -f "$KEYSTORE" ]; then
  echo ""
  echo "→ Generating signing keystore"
  echo "  ⚠️  Save the password — you need it to publish updates"
  echo ""
  read -sp "  Keystore password (min 6 chars): " KS_PASS; echo
  read -sp "  Confirm password: " KS_PASS2; echo
  [ "$KS_PASS" = "$KS_PASS2" ] || { echo "Passwords don't match"; exit 1; }
  keytool -genkeypair -v \
    -keystore "$KEYSTORE" \
    -keyalg RSA -keysize 2048 -validity 9125 \
    -alias "$KEY_ALIAS" \
    -storepass "$KS_PASS" -keypass "$KS_PASS" \
    -dname "CN=Portfolio, OU=App, O=KisuShotto, L=Unknown, ST=Unknown, C=US" \
    > /dev/null 2>&1
  echo "$KS_PASS" > "$KS_PASS_FILE"
  chmod 600 "$KS_PASS_FILE"
  echo "  ✓ Keystore: $KEYSTORE"
  echo "  ✓ Password saved to .ks_pass_${APP_ID} (gitignored)"
else
  echo "✓ Keystore already exists"
  KS_PASS=$(cat "$KS_PASS_FILE" 2>/dev/null || { read -sp "  Keystore password: " p; echo; echo "$p"; })
fi

# ─── Step 5: Android project structure ────────────────────────────────────────
echo "→ Generating Android project..."
rm -rf "$TWA"
mkdir -p "$TWA/app/src/main/java"
mkdir -p "$RES/values"
mkdir -p "$RES/mipmap-mdpi" "$RES/mipmap-hdpi" "$RES/mipmap-xhdpi"
mkdir -p "$RES/mipmap-xxhdpi" "$RES/mipmap-xxxhdpi" "$RES/mipmap-anydpi-v26"

# settings.gradle
cat > "$TWA/settings.gradle" << 'GRADLE'
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "portfolio-twa"
include ':app'
GRADLE

# build.gradle (root)
cat > "$TWA/build.gradle" << 'GRADLE'
plugins {
    id 'com.android.application' version '8.1.4' apply false
}
GRADLE

# gradle.properties
cat > "$TWA/gradle.properties" << 'PROPS'
org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8
android.useAndroidX=true
android.enableJetifier=true
PROPS

# local.properties (SDK path)
echo "sdk.dir=$SDK" > "$TWA/local.properties"

# app/build.gradle
cat > "$TWA/app/build.gradle" << GRADLE
plugins {
    id 'com.android.application'
}

android {
    namespace "$PACKAGE"
    compileSdk 34

    defaultConfig {
        applicationId "$PACKAGE"
        minSdk 21
        targetSdk 34
        versionCode $VERSION_CODE
        versionName "$VERSION_NAME"
    }

    signingConfigs {
        release {
            storeFile file("$KEYSTORE")
            storePassword "$KS_PASS"
            keyAlias "$KEY_ALIAS"
            keyPassword "$KS_PASS"
        }
    }

    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt')
        }
    }

    compileOptions {
        sourceCompatibility JavaVersion.VERSION_1_8
        targetCompatibility JavaVersion.VERSION_1_8
    }
}

dependencies {
    implementation 'com.google.androidbrowserhelper:androidbrowserhelper:2.5.0'
}
GRADLE

# AndroidManifest.xml
cat > "$TWA/app/src/main/AndroidManifest.xml" << MANIFEST
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <uses-permission android:name="android.permission.INTERNET"/>
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>

    <application
        android:label="@string/app_name"
        android:icon="@mipmap/ic_launcher"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:allowBackup="false"
        android:supportsRtl="false"
        android:theme="@style/AppTheme">

        <activity
            android:name="com.google.androidbrowserhelper.trusted.LauncherActivity"
            android:exported="true"
            android:label="@string/app_name">

            <meta-data
                android:name="android.support.customtabs.trusted.DEFAULT_URL"
                android:value="https://$HOST/"/>
            <meta-data
                android:name="android.support.customtabs.trusted.STATUS_BAR_COLOR"
                android:resource="@color/status_bar_color"/>
            <meta-data
                android:name="android.support.customtabs.trusted.NAVIGATION_BAR_COLOR"
                android:resource="@color/nav_bar_color"/>
            <meta-data
                android:name="android.support.customtabs.trusted.SPLASH_SCREEN_BACKGROUND_COLOR"
                android:resource="@color/bg_color"/>

            <intent-filter>
                <action android:name="android.intent.action.MAIN"/>
                <category android:name="android.intent.category.LAUNCHER"/>
            </intent-filter>

            <intent-filter android:autoVerify="true">
                <action android:name="android.intent.action.VIEW"/>
                <category android:name="android.intent.category.DEFAULT"/>
                <category android:name="android.intent.category.BROWSABLE"/>
                <data android:scheme="https" android:host="$HOST"/>
            </intent-filter>
        </activity>

        <service
            android:name="com.google.androidbrowserhelper.trusted.DelegationService"
            android:exported="true"
            android:enabled="true">
            <intent-filter>
                <action android:name="android.support.customtabs.trusted.TRUSTED_WEB_ACTIVITY_SERVICE"/>
                <category android:name="android.intent.category.DEFAULT"/>
            </intent-filter>
        </service>

    </application>
</manifest>
MANIFEST

# res/values/strings.xml
cat > "$RES/values/strings.xml" << XML
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">$APP_NAME</string>
</resources>
XML

# res/values/colors.xml
cat > "$RES/values/colors.xml" << XML
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="status_bar_color">$STATUS_BAR_COLOR</color>
    <color name="nav_bar_color">$NAV_BAR_COLOR</color>
    <color name="bg_color">$BG_COLOR</color>
    <color name="ic_launcher_background">$BG_COLOR</color>
</resources>
XML

# res/values/styles.xml
cat > "$RES/values/styles.xml" << XML
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="AppTheme" parent="Theme.AppCompat.DayNight.NoActionBar">
        <item name="colorPrimary">$THEME_COLOR</item>
    </style>
</resources>
XML

# mipmap-anydpi-v26/ic_launcher.xml (adaptive icon)
cat > "$RES/mipmap-anydpi-v26/ic_launcher.xml" << XML
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
XML

cat > "$RES/mipmap-anydpi-v26/ic_launcher_round.xml" << XML
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
XML

echo "  ✓ Android project files created"

# ─── Step 6: Icons with sharp ─────────────────────────────────────────────────
echo "→ Generating icons..."
SVG_PATH="$ROOT/portfolio_logo.svg" RES_DIR="$RES" node << 'NODESCRIPT'
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const svg = fs.readFileSync(process.env.SVG_PATH);
const out = process.env.RES_DIR;

// Regular launcher icons: icon + opaque dark background
const regular = { 'mipmap-mdpi':48,'mipmap-hdpi':72,'mipmap-xhdpi':96,'mipmap-xxhdpi':144,'mipmap-xxxhdpi':192 };
// Adaptive foreground: transparent bg, icon at 83% of 108dp*density
const foreground = { 'mipmap-mdpi':108,'mipmap-hdpi':162,'mipmap-xhdpi':216,'mipmap-xxhdpi':324,'mipmap-xxxhdpi':432 };

async function run() {
  const bg = { r:18, g:17, b:26, alpha:1 };
  const transparent = { r:0, g:0, b:0, alpha:0 };

  for (const [dir, size] of Object.entries(regular)) {
    const logoSize = Math.round(size * 0.75);
    const pad = Math.round((size - logoSize) / 2);
    const logo = await sharp(svg).resize(logoSize, logoSize).png().toBuffer();
    await sharp({ create:{ width:size, height:size, channels:4, background:bg } })
      .composite([{ input:logo, top:pad, left:pad }])
      .png().toFile(path.join(out, dir, 'ic_launcher.png'));
    // Round icon: same but with circular mask
    await sharp({ create:{ width:size, height:size, channels:4, background:bg } })
      .composite([{ input:logo, top:pad, left:pad }])
      .png().toFile(path.join(out, dir, 'ic_launcher_round.png'));
  }

  for (const [dir, size] of Object.entries(foreground)) {
    const logoSize = Math.round(size * 0.83);
    const pad = Math.round((size - logoSize) / 2);
    const logo = await sharp(svg).resize(logoSize, logoSize).png().toBuffer();
    await sharp({ create:{ width:size, height:size, channels:4, background:transparent } })
      .composite([{ input:logo, top:pad, left:pad }])
      .png().toFile(path.join(out, dir, 'ic_launcher_foreground.png'));
  }

  console.log('  ✓ Icons generated (5 densities + adaptive foreground)');
}
run().catch(e => { console.error(e); process.exit(1); });
NODESCRIPT

# ─── Step 7: Build APK ────────────────────────────────────────────────────────
echo "→ Building release APK (first build ~5min, subsequent ~1min)..."
cd "$TWA"
JAVA_HOME="$JDK" ANDROID_HOME="$SDK" \
  "$GRADLE_HOME/bin/gradle" assembleRelease \
  --no-daemon \
  -Dorg.gradle.java.home="$JDK" \
  2>&1 | grep -E "BUILD|FAILED|error:|Error|warning:|> Task|Downloading" || true

APK_PATH="$TWA/app/build/outputs/apk/release/app-release.apk"
[ -f "$APK_PATH" ] || { echo "✗ Build failed — APK not found"; exit 1; }
echo "  ✓ APK built: $APK_PATH"

# ─── Step 8: assetlinks.json ──────────────────────────────────────────────────
echo "→ Extracting SHA256 fingerprint..."
SHA256=$("$JDK/bin/keytool" -list -v \
  -keystore "$KEYSTORE" \
  -alias "$KEY_ALIAS" \
  -storepass "$KS_PASS" 2>/dev/null \
  | grep "SHA256:" | head -1 | sed 's/.*SHA256: //' | tr -d '[:space:]')

mkdir -p "$ROOT/public/.well-known"
cat > "$ROOT/public/.well-known/assetlinks.json" << JSON
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "$PACKAGE",
    "sha256_cert_fingerprints": ["$SHA256"]
  }
}]
JSON
echo "  ✓ assetlinks.json written"
echo "  SHA256: $SHA256"

# ─── Step 9: Rebuild PWA dist ────────────────────────────────────────────────
echo "→ Rebuilding PWA dist with assetlinks.json..."
cd "$ROOT"
npm run build > /dev/null
echo "  ✓ PWA rebuilt"

# ─── Done ────────────────────────────────────────────────────────────────────
APK_DEST="$ROOT/${APP_ID}-release.apk"
cp "$APK_PATH" "$APK_DEST"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║  ✓ BUILD COMPLETE                        ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "  APK:  $APK_DEST"
echo "  Size: $(du -sh "$APK_DEST" | cut -f1)"
echo ""
echo "  Next steps:"
echo "  1. git add public/.well-known/assetlinks.json && git commit -m 'feat: add assetlinks.json for TWA' && git push"
echo "     ↳ Add CF Access bypass for /.well-known/assetlinks.json in Cloudflare"
echo "  2. Transfer $APP_ID-release.apk to phone and install"
echo "  3. Wait ~24h for Digital Asset Links verification"
echo "     ↳ Test: adb shell pm get-app-links $PACKAGE"
echo ""
echo "  ⚠️  Keep $KEYSTORE and .ks_pass_${APP_ID} safe — needed for updates"
echo "  ⚠️  Bump VERSION_CODE ($VERSION_CODE → $((VERSION_CODE+1))) for next update"
echo ""
