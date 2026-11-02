#!/bin/bash
# Build the extensions.gnome.org upload zip.
set -e
cd "$(dirname "$0")"
gnome-extensions pack --force \
    --extra-source=workspaceIndicator.js \
    --extra-source=workspacePrefs.js \
    --extra-source=stylesheet-dark.css \
    --extra-source=stylesheet-light.css \
    --extra-source=stylesheet-workspace-switcher-dark.css \
    --extra-source=stylesheet-workspace-switcher-light.css \
    --extra-source=LICENSE \
    .
