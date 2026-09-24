#!/usr/bin/env bash
# Dev helper for Hyprland 0.56+ (Lua dispatch). See README "Dev bridge".
# shot.sh OUT.png : screenshot the typist-wall window, returning to the current workspace after.
set -euo pipefail
out=$1
cur=$(hyprctl activeworkspace -j | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
read -r ws geom < <(hyprctl clients -j | python3 -c "
import json,sys
c=[c for c in json.load(sys.stdin) if c['class']=='typist-wall'][0]
print(c['workspace']['id'], f\"{c['at'][0]},{c['at'][1]} {c['size'][0]}x{c['size'][1]}\")")
hyprctl dispatch "hl.dsp.focus({ workspace = \"$ws\" })" >/dev/null
sleep "${SHOT_DELAY:-0.35}"
grim -g "$geom" "$out" || true
hyprctl dispatch "hl.dsp.focus({ workspace = \"$cur\" })" >/dev/null
echo "$out ($geom on ws $ws)"
