on run argv
	set targetURL to item 1 of argv
	tell application "Safari"
		activate
		set newDoc to make new document with properties {URL:targetURL}
		delay 2
		return name of newDoc
	end tell
end run
