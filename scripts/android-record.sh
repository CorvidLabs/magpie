#!/bin/sh
# args: $1 = local output path, $2 = seconds
set -e
OUT="$1"
SECS="$2"
mkdir -p "$(dirname "$OUT")"
adb shell screenrecord --time-limit "$SECS" /sdcard/magpie-recording.mp4
adb pull /sdcard/magpie-recording.mp4 "$OUT"
adb shell rm /sdcard/magpie-recording.mp4
echo "recorded ${SECS}s to $OUT"
