#!/bin/sh
# args: $1 = url
# Drives a real GUI browser via System Events UI-scripting, not the
# browser's own AppleScript dictionary (needs a consent grant a fresh CI
# runner doesn't have — see README's Status section). Browser is
# $MAGPIE_BROWSER: Safari in CI (test.yml sets it explicitly — confirmed
# working; Chrome hung a real 8-minute CI timeout when tried), Google
# Chrome by default elsewhere so this never targets a daily-driver
# browser. See AGENTS.md: these scripts don't run locally regardless.
set -e
URL="$1"
BROWSER="${MAGPIE_BROWSER:-Google Chrome}"
open -a "$BROWSER"
sleep 1.5
osascript <<EOF
tell application "System Events"
	tell process "$BROWSER"
		set frontmost to true
		delay 0.5
		keystroke "l" using command down
		delay 0.3
		keystroke "$URL"
		keystroke return
		delay 2
		return name of front window
	end tell
end tell
EOF
