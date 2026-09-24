#!/usr/bin/env bash
# Install Stipple's animated wallpaper plugin into omarchy-shell:
#   compile the shaders, link this repo's plugin folder into ~/.config/omarchy/plugins, enable it,
#   and restart the shell if the plugin did not come up on its own.
# Re-run after changing shaders/*.frag (the compiled .qsb files are not in git).
#   shell-plugin/install.sh              install or update
#   shell-plugin/install.sh --uninstall  disable it and remove the link (wallpapers stay still PNGs)
set -euo pipefail

id=kivan.stipple
src=$(cd "$(dirname "$0")/$id" && pwd)
dest="$HOME/.config/omarchy/plugins/$id"
qsb=/usr/lib/qt6/bin/qsb

say() { printf '%s\n' "$*"; }
fail() { printf 'install.sh: %s\n' "$*" >&2; exit 1; }

running() { omarchy-shell stipple status >/dev/null 2>&1; }

if [[ ${1:-} == --uninstall ]]; then
  omarchy plugin disable "$id" 2>/dev/null || true
  if [[ -L $dest ]]; then rm "$dest"; say "Removed $dest"; fi
  omarchy-shell shell rescanPlugins >/dev/null 2>&1 || true
  say "Stipple's plugin is off: wallpapers show as their still PNGs."
  exit 0
fi

[[ -x $qsb ]] || fail "$qsb not found (it comes with qt6-shadertools)"
command -v inotifywait >/dev/null || fail "inotifywait not found (inotify-tools): the plugin watches the background with it"

# GLSL 330 / ES 300: older GLSL has no uint, which the dot hash needs
for f in "$src"/shaders/*.frag; do
  "$qsb" --glsl "330,300 es" -o "$f.qsb" "$f"
  say "Compiled shaders/${f##*/}.qsb"
done

omarchy plugin validate "$src" >/dev/null || fail "the manifest does not validate: omarchy plugin validate $src"

if [[ -e $dest && ! -L $dest ]]; then
  fail "$dest exists and is not a link; move it away first"
fi
ln -sfn "$src" "$dest"
say "Linked $dest -> $src"

omarchy-shell shell rescanPlugins >/dev/null
# the rescan finishes in the background
for _ in $(seq 1 20); do omarchy plugin list | grep -q "^$id " && break; sleep 0.5; done
omarchy plugin enable "$id"

# a service plugin can need a fresh shell to be instantiated
for _ in 1 2 3 4 5; do running && break; sleep 1; done
if ! running; then
  say "Restarting the shell to load the plugin…"
  omarchy restart shell
  for _ in $(seq 1 15); do running && break; sleep 1; done
fi
running || fail "the plugin did not start; see: journalctl --user -b | grep -i stipple"
say "Stipple's plugin is running: $(omarchy-shell stipple status)"
