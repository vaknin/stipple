#!/usr/bin/env bash
# The Stipple theme's glue, run by Service.qml (the plugin writes colors.toml itself).
#   apply-theme.sh apply          re-apply the Stipple theme so every app picks up colors.toml
#   apply-theme.sh preview <png>  make <png> the theme's tile in the theme picker, and its background:
#                                 picking Stipple there brings back the last Stipple wallpaper
#
# `apply` runs `omarchy theme set stipple` with the wallpaper kept: every step after it reloads in
# place (terminals, btop, nvim, borders, the browser's policy), nothing exits. It gives way instead
# of racing: exit 75 (try later) while the screensaver runs (`hyprctl reload` would show its hidden
# cursor) or another theme change holds Omarchy's lock, and exit 0 without doing anything when the
# theme is no longer Stipple.
set -euo pipefail

theme_dir="$HOME/.config/omarchy/themes/stipple"
state="$HOME/.local/state/omarchy/current"
lock="${XDG_RUNTIME_DIR:-/tmp}/omarchy-theme-set.lock"
bin="${OMARCHY_PATH:-/usr/share/omarchy}/bin"
export PATH="$bin:$PATH"

case "${1:-}" in
apply)
  [[ $(cat "$state/theme.name" 2>/dev/null) == stipple ]] || exit 0
  [[ -f $theme_dir/colors.toml ]] || { echo "no $theme_dir/colors.toml" >&2; exit 1; }
  pgrep -f '[o]rg.omarchy.screensaver' >/dev/null && exit 75
  # omarchy-theme-set takes this lock itself: only look whether someone holds it now
  if ! flock -n "$lock" true; then exit 75; fi
  OMARCHY_THEME_SKIP_BACKGROUND=1 omarchy-theme-set stipple >/dev/null
  ;;
preview)
  [[ -f ${2:-} ]] || { echo "usage: apply-theme.sh preview <png>" >&2; exit 2; }
  mkdir -p "$theme_dir"
  cp -f "$2" "$theme_dir/preview.png.tmp"
  mv -f "$theme_dir/preview.png.tmp" "$theme_dir/preview.png"
  # a link, so the background resolves to the wallpaper itself and the plugin finds its sidecar
  mkdir -p "$theme_dir/backgrounds"
  ln -sfn "$(realpath "$2")" "$theme_dir/backgrounds/stipple.png"
  ;;
*)
  echo "usage: apply-theme.sh apply | preview <png>" >&2
  exit 2
  ;;
esac
