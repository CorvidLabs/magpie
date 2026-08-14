#!/bin/sh
# args: $1=device udid  $2=url
# `simctl openurl` timed out on the first attempt in two separate
# environments (a sandboxed dev machine and a real GitHub macos-latest
# runner) right after boot — reads as the simulator's virtual network
# needing a few more seconds to settle post-`bootstatus`, not an
# environment fluke. One retry after a short wait is the cheap fix; if it
# still fails twice, that's a real result worth reporting, not swallowed.
set -e
DEVICE="$1"
URL="$2"
if ! xcrun simctl openurl "$DEVICE" "$URL"; then
	echo "first openurl attempt failed, waiting 5s and retrying..." >&2
	sleep 5
	xcrun simctl openurl "$DEVICE" "$URL"
fi
