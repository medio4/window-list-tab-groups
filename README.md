# Window List (Previews)

Fork of the GNOME `window-list` bottom-bar extension (Fedora package 50.4), with the goal of
adding thumbnail previews when hovering window buttons.

- Source of truth: this folder. It's symlinked to
  `~/.local/share/gnome-shell/extensions/window-list-previews@jacobcorbley`.
- Base: `/usr/share/gnome-shell/extensions/window-list@gnome-shell-extensions.gcampax.github.com`
  (first commit is the unmodified upstream copy, so `git diff <first-commit>` shows our changes).
- Hover hook: `BaseButton` in `extension.js` (`notify::hover` → `showLabel()`).
  Reference for building previews with `Clutter.Clone` of window actors:
  `~/.local/share/gnome-shell/extensions/dock-window-preview@quivio/extension.js` (it only hooks the overview Dash).

## Testing
- `./dev.sh` — nested devkit shell, safe.
- Real session (Wayland): log out/in once so the shell discovers the new UUID, then
  `gnome-extensions disable window-list@gnome-shell-extensions.gcampax.github.com`
  `gnome-extensions enable window-list-previews@jacobcorbley`
  After code edits, log out/in again (Wayland can't reload extensions in place).
- Logs: `journalctl -f -o cat /usr/bin/gnome-shell`
