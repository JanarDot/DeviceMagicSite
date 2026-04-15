#!/usr/bin/env bash
# Device Magic — macOS installer
# Downloads via curl (no Gatekeeper quarantine) and installs to Applications.

set -e

APP_NAME="Device Magic"
ZIP_URL="https://janardot.github.io/DeviceMagic/downloads/device-magic-mac.zip"
TMP_ZIP="/tmp/device-magic-mac.zip"
TMP_DIR="/tmp/device-magic-install"

echo ""
echo "  Installing Device Magic..."
echo ""

# Download
curl -fSL --progress-bar "$ZIP_URL" -o "$TMP_ZIP"

# Unzip
rm -rf "$TMP_DIR"
mkdir -p "$TMP_DIR"
unzip -q "$TMP_ZIP" -d "$TMP_DIR"

# Move to Applications (prefer user ~/Applications, fall back to /Applications)
APP_DEST=~/Applications
if [ ! -d "$APP_DEST" ]; then
  APP_DEST=/Applications
fi

# Remove old version if present
rm -rf "$APP_DEST/$APP_NAME.app"

mv "$TMP_DIR/$APP_NAME.app" "$APP_DEST/"

# Clean up
rm -rf "$TMP_ZIP" "$TMP_DIR"

echo "  Done — Device Magic is in your Applications folder."
echo "  Open it from there or Spotlight (Cmd+Space → Device Magic)."
echo ""
