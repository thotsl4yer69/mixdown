#!/usr/bin/env bash
# Each workflow runner invocation must be one command: avoid multi-line shell fragments
# being executed independently by android-emulator-runner.
set -euo pipefail

OUTPUT="native-android/smoke-output"
PACKAGE="au.com.mazlabz.mixdown"
mkdir -p "$OUTPUT"

capture_diagnostics() {
  adb logcat -d > "$OUTPUT/full-log.txt" 2>/dev/null || true
  adb logcat -d -s AndroidRuntime:E > "$OUTPUT/crash-log.txt" 2>/dev/null || true
  adb shell screencap -p /sdcard/mixdown.png 2>/dev/null || true
  adb pull /sdcard/mixdown.png "$OUTPUT/mixdown-emulator.png" >/dev/null 2>&1 || true
  adb shell uiautomator dump /sdcard/window.xml >/dev/null 2>&1 || true
  adb pull /sdcard/window.xml "$OUTPUT/window.xml" >/dev/null 2>&1 || true
  adb shell dumpsys activity activities > "$OUTPUT/activities.txt" 2>/dev/null || true
}
trap capture_diagnostics EXIT

adb install -r native-android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -W -n "$PACKAGE/.MainActivity"

# A cold emulator may need a few seconds to initialize Compose.
PID=""
for attempt in $(seq 1 15); do
  PID="$(adb shell pidof -s "$PACKAGE" 2>/dev/null | tr -d '\r' || true)"
  if [[ -n "$PID" ]]; then
    break
  fi
  sleep 2
done

if [[ -z "$PID" ]]; then
  echo "::error::Mixdown process did not remain alive after launch"
  exit 1
fi

sleep 8
PID="$(adb shell pidof -s "$PACKAGE" 2>/dev/null | tr -d '\r' || true)"
if [[ -z "$PID" ]]; then
  echo "::error::Mixdown process exited shortly after initial render"
  exit 1
fi

capture_diagnostics
if grep -Eq "FATAL EXCEPTION|Fatal signal" "$OUTPUT/crash-log.txt"; then
  echo "::error::Android runtime reported a fatal exception"
  exit 1
fi
if grep -Eqi "isn.t responding|not responding" "$OUTPUT/window.xml"; then
  echo "::error::The emulator displayed an ANR dialog; inspect saved diagnostics"
  exit 1
fi
if ! grep -Fq 'MIXDOWN' "$OUTPUT/window.xml"; then
  echo "::error::Mixdown UI content was not visible to Android accessibility"
  exit 1
fi
if ! test -s "$OUTPUT/mixdown-emulator.png"; then
  echo "::error::Missing installed-app screenshot"
  exit 1
fi

echo "Mixdown installed-app smoke passed; PID=$PID; captured UI, screenshot and logs."
