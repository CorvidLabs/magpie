#!/bin/sh
# args: $1 = device udid
# A real CI run saw this fail (real non-zero exit, not a hang) right after
# ios-record.sh's SIGKILL fallback ran — plausible transient CoreSimulator
# state from the hard kill. One retry after a short wait, same pattern as
# ios-open.sh's already-proven fix for a different simctl flake.
set -e
DEVICE="$1"
if ! xcrun simctl shutdown "$DEVICE"; then
	echo "first shutdown attempt failed, waiting 3s and retrying..." >&2
	sleep 3
	xcrun simctl shutdown "$DEVICE"
fi
