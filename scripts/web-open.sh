#!/bin/sh
# args: $1 = url
# Drives Safari through System Events UI-scripting (keystrokes) rather than
# Safari's own AppleScript dictionary. `tell application "Safari" to ...`
# sends an Apple Event straight to Safari, which needs a per-pair macOS
# Automation consent grant that a fresh CI runner doesn't have (confirmed:
# it hung ~126s then failed on the first real CI run). Going through System
# Events instead uses the Accessibility permission bucket, which GitHub's
# macos-latest runner already grants (confirmed working — this is the same
# mechanism scripts/macos-launch.sh already uses successfully).
set -e
URL="$1"
open -a Safari
sleep 1.5
osascript <<EOF
tell application "System Events"
	tell process "Safari"
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
