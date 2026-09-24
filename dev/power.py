#!/usr/bin/env python3
"""Mean power and GPU/CPU use over a window, for the animated wallpaper's efficiency work.

    dev/power.py SECONDS [PID...]

Samples every 50 ms: package power (amdgpu hwmon power1_input, 1 W steps, so only its mean over
many samples means anything), and when the GPU exposes gpu_metrics v2 (AMD APUs), the CPU and SoC
rail power in mW and the graphics activity; on battery, the whole laptop's draw (voltage x current,
which the battery updates only every few seconds). Also the CPU use of each PID. Keep the screen on and
still (no input) while it runs.
"""
import glob, os, struct, sys, time

def card():
    for d in glob.glob('/sys/class/drm/card*/device'):
        if os.path.exists(f'{d}/hwmon') and glob.glob(f'{d}/hwmon/hwmon*/power1_input'):
            return d
    sys.exit('no amdgpu power1_input')

def cpu(pid):
    f = open(f'/proc/{pid}/stat').read().rsplit(')', 1)[1].split()
    return int(f[11]) + int(f[12])  # utime + stime, ticks

secs = float(sys.argv[1]) if len(sys.argv) > 1 else 20
pids = sys.argv[2:]
dev = card()
power = glob.glob(f'{dev}/hwmon/hwmon*/power1_input')[0]
metrics = f'{dev}/gpu_metrics'
try:
    m = open(metrics, 'rb').read()
    has_metrics = struct.unpack_from('<HBB', m, 0)[1] == 2
except OSError:
    has_metrics = False
bat = next((d for d in glob.glob('/sys/class/power_supply/BAT*')
            if open(f'{d}/status').read().strip() == 'Discharging'
            and os.path.exists(f'{d}/current_now') and os.path.exists(f'{d}/voltage_now')), None)
tick = os.sysconf('SC_CLK_TCK')
c0 = {p: cpu(p) for p in pids}
t0, W, CPU, SOC, GFX, B = time.monotonic(), [], [], [], [], []
while time.monotonic() - t0 < secs:
    W.append(int(open(power).read()) / 1e6)
    if has_metrics:
        m = open(metrics, 'rb').read()
        gfx, = struct.unpack_from('<H', m, 28)          # average_gfx_activity
        _, c, s, _ = struct.unpack_from('<HHHH', m, 40)  # socket, cpu, soc (mW), gfx
        CPU.append(c); SOC.append(s); GFX.append(gfx)
    if bat:
        B.append(int(open(f'{bat}/current_now').read()) * int(open(f'{bat}/voltage_now').read()) / 1e12)
    time.sleep(0.05)
dt = time.monotonic() - t0
mean = lambda v: sum(v) / len(v)
out = f'pkg {mean(W):.3f} W'
if has_metrics:
    out += f'  cpu {mean(CPU):.0f} mW  soc {mean(SOC):.0f} mW  gfx {mean(GFX) / 100:.2f}%'
if bat:
    out += f'  battery {mean(B):.3f} W'
for p in pids:
    out += f'  cpu[{p}] {100 * (cpu(p) - c0[p]) / tick / dt:.1f}%'
print(out + f'  (n={len(W)})')
