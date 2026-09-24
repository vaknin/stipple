// Run the plugin on its own, outside omarchy-shell: `quickshell -p shell-plugin/dev`.
// A crash here cannot take the bar or the lock screen with it. STIPPLE_CURRENT=<png> shows that
// wallpaper instead of following Omarchy's background. STIPPLE_AWAKE=1 keeps the session from idling
// while it is shown (for power measurements).
import Quickshell
import "stipple" as Stipple

ShellRoot {
  Stipple.Service {
    override: Quickshell.env("STIPPLE_CURRENT") || ""
    inhibitIdle: Quickshell.env("STIPPLE_AWAKE") === "1"
  }
}
