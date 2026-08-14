#!/bin/sh
# args: $1=device udid  $2=output path  $3=seconds
set -e
DEVICE="$1"
OUT="$2"
SECS="$3"
xcrun simctl io "$DEVICE" recordVideo --codec=h264 --force "$OUT" &
PID=$!
sleep "$SECS"
kill -INT "$PID" 2>/dev/null || true
wait "$PID" 2>/dev/null || true
echo "recorded ${SECS}s to ${OUT}"
