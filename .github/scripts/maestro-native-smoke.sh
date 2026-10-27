#!/usr/bin/env bash
# Run as the single script argument to android-emulator-runner.
set -euo pipefail
mkdir -p native-android/maestro-output
capture() {
  adb exec-out screencap -p > native-android/maestro-output/final-screen.png 2>/dev/null || true
  adb logcat -d -s AndroidRuntime:E > native-android/maestro-output/android-crashes.txt 2>/dev/null || true
  adb shell uiautomator dump /sdcard/maestro-ui.xml >/dev/null 2>&1 || true
  adb pull /sdcard/maestro-ui.xml native-android/maestro-output/ui.xml >/dev/null 2>&1 || true
}
trap capture EXIT
adb install -r native-android/app/build/outputs/apk/debug/app-debug.apk
# Official open-source CLI installer; no Maestro Cloud account or API key.
curl --fail --location --silent --show-error --retry 3 https://get.maestro.mobile.dev | bash
export PATH="$HOME/.maestro/bin:$PATH"
maestro --version
maestro test .maestro/native-feed.yaml
