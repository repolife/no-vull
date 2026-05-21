#!/bin/bash
set -e

echo "Building no-vull menu bar app (release)..."
cd "$(dirname "$0")"
swift build -c release 2>&1

BINARY=".build/release/NoVull"
DEST="$HOME/.local/bin/NoVullMenuBar"
PLIST="$HOME/Library/LaunchAgents/com.no-vull.menubar.plist"

mkdir -p "$HOME/.local/bin"
cp "$BINARY" "$DEST"
chmod +x "$DEST"

# Create launchd plist so it auto-starts on login
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.no-vull.menubar</string>
    <key>ProgramArguments</key>
    <array>
        <string>$DEST</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$HOME/.no-vull/menubar.log</string>
    <key>StandardErrorPath</key>
    <string>$HOME/.no-vull/menubar.log</string>
</dict>
</plist>
EOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

echo ""
echo "Done. no-vull menu bar app is running."
echo "It auto-starts on login via launchd."
echo ""
echo "To uninstall: launchctl unload $PLIST && rm $PLIST $DEST"
