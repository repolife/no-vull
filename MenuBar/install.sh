#!/bin/bash
set -e

echo "Building no-vull menu bar app (release)..."
cd "$(dirname "$0")"
swift build -c release 2>&1

BINARY=".build/release/NoVull"
BUNDLE="$HOME/Applications/NoVull.app"
CONTENTS="$BUNDLE/Contents"
MACOS="$CONTENTS/MacOS"
PLIST_PATH="$HOME/Library/LaunchAgents/com.no-vull.menubar.plist"

# Build .app bundle
rm -rf "$BUNDLE"
mkdir -p "$MACOS"
cp "$BINARY" "$MACOS/NoVull"
chmod +x "$MACOS/NoVull"

cat > "$CONTENTS/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleIdentifier</key>
    <string>com.no-vull.menubar</string>
    <key>CFBundleName</key>
    <string>NoVull</string>
    <key>CFBundleExecutable</key>
    <string>NoVull</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>0.1.0</string>
    <key>LSMinimumSystemVersion</key>
    <string>13.0</string>
    <key>LSUIElement</key>
    <true/>
    <key>NSPrincipalClass</key>
    <string>NSApplication</string>
</dict>
</plist>
EOF

mkdir -p "$HOME/.no-vull"

# Copy .env.example to ~/.no-vull/.env if it doesn't exist yet
if [ ! -f "$HOME/.no-vull/.env" ]; then
  cp "$(dirname "$0")/../.env.example" "$HOME/.no-vull/.env"
  echo "Created ~/.no-vull/.env — add your API keys and X Bearer token there."
fi

# launchd agent — opens the .app bundle
cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.no-vull.menubar</string>
    <key>ProgramArguments</key>
    <array>
        <string>$MACOS/NoVull</string>
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

launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl load "$PLIST_PATH"

echo ""
echo "Done. no-vull menu bar app is running from $BUNDLE"
echo "It auto-starts on login via launchd."
echo ""
echo "To uninstall:"
echo "  launchctl unload $PLIST_PATH"
echo "  rm -rf $PLIST_PATH $BUNDLE"
