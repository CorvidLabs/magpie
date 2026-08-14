#!/bin/sh
# args: $1=device udid  $2=url
# `simctl openurl` is a real, structural networking flake on GitHub's
# macOS runners (see README's Status section) — retries with backoff,
# but a failure here after all attempts is a real, honestly-reported
# result, not a bug to keep chasing.
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
