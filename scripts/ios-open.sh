#!/bin/sh
# args: $1=device udid  $2=url
# `simctl openurl` has now failed outright even with one retry (on a real
# GitHub runner, after a run where ios/open itself also ran unusually
# slowly — 113s — suggesting general resource contention around the
# simulator that session, not a one-off). Bumped to two retries with a
# longer backoff. If all three attempts still fail, that's a real,
# honestly-reported result — this is Apple's simulator networking timing
# under CI load, not something magpie can fully control from here.
set -e
DEVICE="$1"
URL="$2"
attempt=1
while ! xcrun simctl openurl "$DEVICE" "$URL"; do
	if [ "$attempt" -ge 3 ]; then
		echo "openurl failed on all $attempt attempts" >&2
		exit 1
	fi
	wait_s=$((attempt * 5))
	echo "openurl attempt $attempt failed, waiting ${wait_s}s and retrying..." >&2
	sleep "$wait_s"
	attempt=$((attempt + 1))
done
