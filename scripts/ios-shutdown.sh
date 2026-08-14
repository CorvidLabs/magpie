#!/bin/sh
# args: $1 = device udid
# One retry after a short wait — see README's Status section for the
# real CoreSimulator flake this handles.
set -e
DEVICE="$1"
if ! xcrun simctl shutdown "$DEVICE"; then
	echo "first shutdown attempt failed, waiting 3s and retrying..." >&2
	sleep 3
	xcrun simctl shutdown "$DEVICE"
fi
