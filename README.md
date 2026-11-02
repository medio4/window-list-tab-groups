# Window List Tab Groups

A GNOME Shell bottom window list with Chrome-style tab groups.

- **Group windows:** right-click a window → **Add to new group**, then name the group and pick a color.
- **Add or move:** right-click another window → **Add to “…”**, or drag it in next to the group's windows.
- **Collapse:** click a group's colored label to hide its windows; click again to show them.
  Switching to a window in a collapsed group (e.g. with Alt+Tab) opens the group.
- **Manage:** right-click the label to rename, recolor, collapse, ungroup or close the group.
- **Leave a group:** right-click → **Remove from group**, or drag the window away from it.

Grouped windows get an underline in their group's color. Groups survive screen lock and
extension reloads, and reset when you log out.

Supports GNOME Shell 50. Based on the GNOME Shell
[Window List](https://gitlab.gnome.org/GNOME/gnome-shell-extensions/-/tree/main/extensions/window-list)
extension (50.4); the first commit is the unmodified upstream copy.

## Install

From [extensions.gnome.org](https://extensions.gnome.org), or from source:

```bash
git clone https://github.com/medio4/window-list-tab-groups
cd window-list-tab-groups
glib-compile-schemas schemas
ln -s "$PWD" ~/.local/share/gnome-shell/extensions/window-list-tab-groups@jacobcorbley
```

Log out and back in, then:

```bash
gnome-extensions disable window-list@gnome-shell-extensions.gcampax.github.com
gnome-extensions enable window-list-tab-groups@jacobcorbley
```

## Development

- `./dev.sh` runs a nested GNOME Shell window with the extension (needs `mutter-devkit`).
- `./pack.sh` builds the zip for extensions.gnome.org.
- Logs: `journalctl -f -o cat /usr/bin/gnome-shell`

## License

GPL-2.0-or-later, like the upstream extension. See [LICENSE](LICENSE).
