#!/bin/sh
# args: $1 = url
# Drives Google Chrome through System Events UI-scripting (keystrokes)
# rather than a browser's own AppleScript dictionary. `tell application
# "Chrome" to ...` sends an Apple Event straight to the browser, which
# needs a per-pair macOS Automation consent grant that a fresh CI runner
# doesn't have (confirmed: it hung ~126s then failed on the first real CI
# run, back when this targeted Safari). Going through System Events
# instead uses the Accessibility permission bucket, which GitHub's
# macos-latest runner already grants (confirmed working — this is the same
# mechanism scripts/macos-launch.sh already uses successfully).
#
# Targets Chrome, not Safari: this drives a real GUI browser window, and
# any run that isn't perfectly isolated risks interacting with whatever's
# actually open in the browser it targets. Chrome isn't the daily-driver
# browser here (Safari is), so it's the safe choice for something a script
# opens, navigates, and kills.
set -e
URL="$1"
open -a "Google Chrome"
sleep 1.5
osascript <<EOF
tell application "System Events"
	tell process "Google Chrome"
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
