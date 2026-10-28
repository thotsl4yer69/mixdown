#!/usr/bin/env bash
# Each workflow runner invocation must be one command: avoid multi-line shell fragments
# being executed independently by android-emulator-runner.
set -euo pipefail

OUTPUT="native-android/smoke-output"
PACKAGE="au.com.mazlabz.mixdown.beta25"
mkdir -p "$OUTPUT"

capture_diagnostics() {
  adb logcat -d > "$OUTPUT/full-log.txt" 2>/dev/null || true
  adb logcat -d -s AndroidRuntime:E > "$OUTPUT/crash-log.txt" 2>/dev/null || true
  adb shell screencap -p /sdcard/mixdown.png 2>/dev/null || true
  adb pull /sdcard/mixdown.png "$OUTPUT/mixdown-emulator.png" >/dev/null 2>&1 || true
  adb shell uiautomator dump /sdcard/window.xml >/dev/null 2>&1 || true
  adb pull /sdcard/window.xml "$OUTPUT/window.xml" >/dev/null 2>&1 || true
  adb shell dumpsys activity activities > "$OUTPUT/activities.txt" 2>/dev/null || true
  adb shell dumpsys connectivity > "$OUTPUT/connectivity.txt" 2>/dev/null || true
}
trap capture_diagnostics EXIT

adb install -r native-android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -W -n "$PACKAGE/au.com.mazlabz.mixdown.MainActivity"

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
# Android 15's AOSP QuickstepLauncher sometimes ANRs on its first boot.
# Its system dialog obscures a healthy foreground app. Dismiss only that
# known launcher dialog, then independently recheck the actual Mixdown UI.
if grep -Eq '(Quickstep|Pixel Launcher) isn.t responding' "$OUTPUT/window.xml"; then
  echo "Launcher ANR after cold emulator boot; dismissing launcher dialog for app verification"
  TAP="$(python3 - "$OUTPUT/window.xml" <<'PY'
import re, sys
from xml.etree import ElementTree as ET
root = ET.parse(sys.argv[1]).getroot()
for node in root.iter("node"):
    if node.get("resource-id") == "android:id/aerr_close":
        nums = [int(x) for x in re.findall(r"\d+", node.get("bounds", ""))]
        if len(nums) == 4:
            print((nums[0] + nums[2]) // 2, (nums[1] + nums[3]) // 2)
            break
else:
    raise SystemExit("Launcher ANR has no close-dialog control")
PY
)"
  read -r TAP_X TAP_Y <<< "$TAP"
  adb shell input tap "$TAP_X" "$TAP_Y"
  sleep 3
  adb shell am start -W -n "$PACKAGE/au.com.mazlabz.mixdown.MainActivity"
  sleep 5
  capture_diagnostics
fi
if grep -Eq "FATAL EXCEPTION|Fatal signal" "$OUTPUT/crash-log.txt"; then
  echo "::error::Android runtime reported a fatal exception"
  exit 1
fi
if grep -Eqi "isn.t responding|not responding" "$OUTPUT/window.xml"; then
  echo "::error::The emulator displayed an ANR dialog; inspect saved diagnostics"
  exit 1
fi
if ! grep -Fq 'text="MIX"' "$OUTPUT/window.xml" || ! grep -Fq 'text="DOWN"' "$OUTPUT/window.xml"; then
  echo "::error::Mixdown UI content was not visible to Android accessibility"
  exit 1
fi
if grep -Fq 'Nothing to scroll yet' "$OUTPUT/window.xml"; then
  echo "::error::Native UI loads, but the real Supabase-backed scroll feed is empty"
  exit 1
fi
if ! grep -Fq 'text="Watch"' "$OUTPUT/window.xml" || ! grep -Fq 'text="Stories"' "$OUTPUT/window.xml"; then
  echo "::error::Expected Your Mix / Watch / Stories navigation is missing"
  exit 1
fi
if ! grep -Fq 'text="DISCOVER"' "$OUTPUT/window.xml"; then
  echo "::error::The app must always cold-launch into its regular discovery feed"
  exit 1
fi
if grep -Fq 'text="18+ FEED"' "$OUTPUT/window.xml"; then
  echo "::error::Adult content was visible on the opening screen"
  exit 1
fi
if ! grep -Fq 'content-desc="Open 18+ adult feed"' "$OUTPUT/window.xml"; then
  echo "::error::The separate adult tab is missing"
  exit 1
fi
if grep -Fq 'text="Social"' "$OUTPUT/window.xml"; then
  echo "::error::Stale Social category is still exposed as a main tab"
  exit 1
fi
if ! grep -Eq 'Published [0-9]+ [A-Za-z]+ 20[0-9]{2}' "$OUTPUT/window.xml"; then
  echo "::error::The publication date must include the full year"
  exit 1
fi
if ! test -s "$OUTPUT/mixdown-emulator.png"; then
  echo "::error::Missing installed-app screenshot"
  exit 1
fi


# Exercise a real user journey. UI coordinates are discovered from Android's
# accessibility tree, not hardcoded for a particular emulator screen size.
tap_accessible() {
  local label="$1"
  adb shell uiautomator dump /sdcard/window.xml >/dev/null 2>&1
  adb pull /sdcard/window.xml "$OUTPUT/window.xml" >/dev/null 2>&1
  local tap
  tap="$(python3 - "$OUTPUT/window.xml" "$label" <<'PY'
import re, sys
from xml.etree import ElementTree as ET
root = ET.parse(sys.argv[1]).getroot()
for node in root.iter("node"):
    if node.get("content-desc", "") == sys.argv[2]:
        nums = [int(n) for n in re.findall(r"\d+", node.get("bounds", ""))]
        if len(nums) == 4:
            print((nums[0] + nums[2]) // 2, (nums[1] + nums[3]) // 2)
            break
else:
    raise SystemExit("Missing accessible control: " + sys.argv[2])
PY
)"
  local x y
  read -r x y <<< "$tap"
  adb shell input tap "$x" "$y"
  sleep 2
}

tap_accessible "SAVE"
tap_accessible "Open saved library"
adb shell uiautomator dump /sdcard/window.xml >/dev/null 2>&1
adb pull /sdcard/window.xml "$OUTPUT/window.xml" >/dev/null 2>&1
if ! grep -Fq 'SAVED / MIXDOWN' "$OUTPUT/window.xml"; then
  echo "::error::Saved library did not open"
  exit 1
fi
if grep -Fq 'Nothing saved yet' "$OUTPUT/window.xml"; then
  echo "::error::Saved library did not retain the bookmarked item"
  exit 1
fi
tap_accessible "Close saved library"

# The saved item must survive a full process restart, not just Compose state.
adb shell am force-stop "$PACKAGE"
adb shell am start -W -n "$PACKAGE/au.com.mazlabz.mixdown.MainActivity"
sleep 6
tap_accessible "Open saved library"
adb shell uiautomator dump /sdcard/window.xml >/dev/null 2>&1
adb pull /sdcard/window.xml "$OUTPUT/window.xml" >/dev/null 2>&1
if grep -Fq 'Nothing saved yet' "$OUTPUT/window.xml"; then
  echo "::error::Saved item disappeared after restarting the application"
  exit 1
fi
tap_accessible "Close saved library"

# The Stories tab must offer actual readable articles.
tap_text() {
  local label="$1"
  adb shell uiautomator dump /sdcard/window.xml >/dev/null 2>&1
  adb pull /sdcard/window.xml "$OUTPUT/window.xml" >/dev/null 2>&1
  local tap
  tap="$(python3 - "$OUTPUT/window.xml" "$label" <<'PY'
import re, sys
from xml.etree import ElementTree as ET
root = ET.parse(sys.argv[1]).getroot()
for node in root.iter("node"):
    if node.get("text", "") == sys.argv[2]:
        nums = [int(n) for n in re.findall(r"\d+", node.get("bounds", ""))]
        if len(nums) == 4:
            print((nums[0] + nums[2]) // 2, (nums[1] + nums[3]) // 2)
            break
else:
    raise SystemExit("Missing text control: " + sys.argv[2])
PY
)"
  local x y
  read -r x y <<< "$tap"
  adb shell input tap "$x" "$y"
  sleep 2
}

tap_text "Stories"
adb shell uiautomator dump /sdcard/window.xml >/dev/null 2>&1
adb pull /sdcard/window.xml "$OUTPUT/window.xml" >/dev/null 2>&1
if ! grep -Fq 'READ STORY' "$OUTPUT/window.xml"; then
  echo "::error::Stories tab does not show a readable story"
  exit 1
fi
capture_diagnostics

echo "Mixdown installed-app smoke passed: live feed, bookmark, restart persistence and accessible controls."

