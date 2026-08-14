#!/bin/sh
# args: $1=device udid  $2=output path  $3=seconds
DEVICE="$1"
OUT="$2"
SECS="$3"
xcrun simctl io "$DEVICE" recordVideo --codec=h264 --force "$OUT" &
PID=$!
sleep "$SECS"
kill -INT "$PID" 2>/dev/null || true
# `wait "$PID"` here hung on a real CI run — confirmed by an orphaned
# simctl process the runner had to force-clean after the job's own timeout
# fired, well past when this step should have finished. SIGINT doesn't
# reliably make recordVideo exit promptly enough to trust a blocking wait.
# Poll for a few seconds instead, then SIGKILL if it's still alive — this
# step can now never block longer than SECS + ~5s, no matter what.
i=0
while kill -0 "$PID" 2>/dev/null; do
	i=$((i + 1))
	[ "$i" -ge 5 ] && break
	sleep 1
done
kill -KILL "$PID" 2>/dev/null || true
echo "recorded ${SECS}s to ${OUT}"
