#!/bin/sh
# args: $1 = local output path, $2 = seconds
# A real CI run failed here with zero stderr and the output file never
# created — not enough to tell which of the three adb calls actually
# failed. Each is labeled explicitly now so the next failure (if this
# recurs) says which one, instead of a silent flake. record/record's own
# critical: false in run.ts means this can't block the job while it's
# still being diagnosed — cleanup (rm) failing has zero real consequence
# either way, since this emulator is destroyed right after this one step.
OUT="$1"
SECS="$2"
mkdir -p "$(dirname "$OUT")"

if ! adb shell screenrecord --time-limit "$SECS" /sdcard/magpie-recording.mp4; then
	echo "screenrecord failed" >&2
	exit 1
fi
if ! adb pull /sdcard/magpie-recording.mp4 "$OUT"; then
	echo "pull failed" >&2
	exit 1
fi
adb shell rm /sdcard/magpie-recording.mp4 || echo "cleanup rm failed (harmless — emulator is destroyed after this step)" >&2

echo "recorded ${SECS}s to $OUT"
