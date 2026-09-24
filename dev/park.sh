#!/usr/bin/env bash
# Dev helper for Hyprland 0.56+ (Lua dispatch). See README "Dev bridge".
# park.sh : wait for the stipple window and move it silently to workspace 9.
for i in $(seq 1 240); do
  # only the dev build's window (an installed Stipple the user has open is left alone)
  A=$(hyprctl clients -j | python3 -c "
import json, os, sys
def dev(pid):
    try: return os.readlink(f'/proc/{pid}/exe').endswith('/target/debug/stipple')
    except OSError: return False
a = [c['address'] for c in json.load(sys.stdin) if c['class'] == 'stipple' and dev(c['pid'])]
print(a[0] if a else '')")
  [ -n "$A" ] && break; sleep 0.5
done
[ -z "$A" ] && { echo "no window"; exit 1; }
hyprctl dispatch "hl.dsp.window.move({ workspace = \"9\", follow = false, window = \"address:$A\" })" >/dev/null
echo "parked $A"
