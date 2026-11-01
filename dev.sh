#!/bin/bash
# Test the extension in a windowed GNOME Shell (devkit) without touching your real session.
# Open apps inside it with: WAYLAND_DISPLAY=wayland-1 gnome-text-editor &
set -e
cd "$(dirname "$0")"
glib-compile-schemas schemas
UUID=$(python3 -c "import json;print(json.load(open('metadata.json'))['uuid'])")
export MUTTER_DEBUG_DUMMY_MODE_SPECS=1600x900
dbus-run-session -- bash -c "gnome-extensions enable $UUID; gnome-shell --devkit --wayland"
