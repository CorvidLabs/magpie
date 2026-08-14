#!/bin/sh
# args: $1 = app name
set -e
APP="$1"
open -a "$APP"
sleep 1.5
osascript <<EOF
tell application "System Events" to tell process "$APP" to get name of every UI element of window 1
EOF
