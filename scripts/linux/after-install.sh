#!/bin/bash

# Post-installation script for CrawBot on Linux

set -e

# Update desktop database
if command -v update-desktop-database &> /dev/null; then
    update-desktop-database -q /usr/share/applications || true
fi

# Update icon cache
if command -v gtk-update-icon-cache &> /dev/null; then
    gtk-update-icon-cache -q /usr/share/icons/hicolor || true
fi

# Create symbolic link for CLI access (optional)
if [ -x /opt/CrawBot/crawbot ]; then
    ln -sf /opt/CrawBot/crawbot /usr/local/bin/crawbot 2>/dev/null || true
fi

echo "CrawBot has been installed successfully."
