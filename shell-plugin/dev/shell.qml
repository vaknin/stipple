// Run the plugin on its own, outside omarchy-shell: `quickshell -p shell-plugin/dev`.
// A crash here cannot take the bar or the lock screen with it. STIPPLE_CURRENT=<png> shows that
// wallpaper instead of following Omarchy's background.
import Quickshell
import "stipple" as Stipple

ShellRoot {
  Stipple.Service {
    override: Quickshell.env("STIPPLE_CURRENT") || ""
  }
}
