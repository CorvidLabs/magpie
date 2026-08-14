#!/bin/sh
# args: $1 = device udid
# One retry after a short wait, each bounded to 20s — see README's Status
# section for the real CoreSimulator flake this handles. A real run
# showed this can genuinely HANG, not just fail fast, right after
# ios-record.sh's own SIGKILL fallback runs — an unbounded xcrun call
# here would silently eat the whole job's external 8-minute timeout
# instead of failing cleanly and letting the retry actually happen.
set -e
DEVICE="$1"

shutdown_once() {
	xcrun simctl shutdown "$DEVICE" &
	pid=$!
	( sleep 20; kill -9 "$pid" 2>/dev/null ) &
	watcher=$!
	wait "$pid" 2>/dev/null
	status=$?
	kill "$watcher" 2>/dev/null || true
	return $status
}

if ! shutdown_once; then
	echo "first shutdown attempt failed or hung after 20s, waiting 3s and retrying..." >&2
	sleep 3
	shutdown_once
fi
