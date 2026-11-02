#!/bin/bash
# Build the extensions.gnome.org upload zip.
set -e
cd "$(dirname "$0")"
gnome-extensions pack --force --extra-source=LICENSE .
