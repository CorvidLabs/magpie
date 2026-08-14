#!/bin/sh
# args: $1 = url
# Drives a real GUI browser through System Events UI-scripting (keystrokes)
# rather than the browser's own AppleScript dictionary. `tell application
# "<app>" to ...` sends an Apple Event straight to the browser, which
# needs a per-pair macOS Automation consent grant that a fresh CI runner
# doesn't have (confirmed: it hung ~126s then failed on the first real CI
# run, back when this targeted Safari's own dictionary). Going through
# System Events instead uses the Accessibility permission bucket.
#
# Which browser is configurable via $MAGPIE_BROWSER — deliberately, not
# hardcoded — because this script opens, navigates, and force-kills
# whatever it targets, and the safe target differs by context:
#   - CI: .github/workflows/test.yml sets MAGPIE_BROWSER=Safari explicitly
#     — confirmed working there (GitHub's macos-latest image already
#     grants System Events Accessibility control over it). Chrome was
#     tried there too and confirmed NOT working: a real run hung the full
#     8-minute step timeout with Chrome left as an orphan process — no
#     dialog to click on a disposable runner (root cause not fully pinned
#     down: an Accessibility grant Chrome doesn't have pre-authorized vs.
#     a first-launch Gatekeeper prompt are the two live theories).
#   - Everywhere else, default is "Google Chrome" — not the daily-driver
#     browser on the machines this gets developed on, so it's the safer
#     default for something that kills whatever it targets. This is a
#     second layer, not the actual control: see AGENTS.md — these scripts
#     don't run locally at all, regardless of which app they'd target.
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
