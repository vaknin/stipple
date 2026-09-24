#!/usr/bin/env bash
# Dev helper for Hyprland 0.56+ (Lua dispatch). See README "Dev bridge".
# visible.sh SNIPPET : run a dev-bridge snippet while the app's workspace is shown, then go back.
cur=$(hyprctl activeworkspace -j | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
ws=$(hyprctl clients -j | python3 -c "import json,sys; print([c['workspace']['id'] for c in json.load(sys.stdin) if c['class']=='typist-wall'][0])")
hyprctl dispatch "hl.dsp.focus({ workspace = \"$ws\" })" >/dev/null
sleep 0.3
TIMEOUT=${TIMEOUT:-120} "$(dirname "$0")/tw.sh" "$1"
if [ -n "${SHOT:-}" ]; then
  geom=$(hyprctl clients -j | python3 -c "import json,sys; c=[c for c in json.load(sys.stdin) if c['class']=='typist-wall'][0]; print(f\"{c['at'][0]},{c['at'][1]} {c['size'][0]}x{c['size'][1]}\")")
  grim -g "$geom" "$SHOT"
fi
hyprctl dispatch "hl.dsp.focus({ workspace = \"$cur\" })" >/dev/null
