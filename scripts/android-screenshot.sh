#!/bin/sh
# args: $1 = output path
set -e
OUT="$1"
mkdir -p "$(dirname "$OUT")"
adb exec-out screencap -p > "$OUT"
echo "screenshot written to $OUT"
