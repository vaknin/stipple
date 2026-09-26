// Stipple's animated wallpaper for omarchy-shell.
//
// Omarchy keeps drawing the wallpaper PNG on the Background layer, as always. When the current
// background is a Stipple wallpaper whose sidecar (<name>.stipple.json) turns motion on, this
// plugin puts a surface of its own on the Bottom layer, above the PNG and below every window,
// and draws the moving version there with one shader (shaders/wall.frag). Anything else (bg next,
// a theme change, a plain picture, motion off, this plugin disabled) hides the surface, and the
// PNG underneath is already the right still picture.
//
// Nothing polls: the background symlink is watched with inotifywait, the sidecar with a watched
// FileView (the app rewrites it when motion changes), Hyprland state arrives as events. Frames
// come from a Timer at the effect's own rate (at most 2 a second with windows open on the
// screen), drawn only when the picture changes, and none while nothing can see them: a
// fullscreen window, windows covering 90% of the screen,
// 60 s idle (screensaver, lock, screen off), or `stipple pause`.
//
// The Stipple theme: while Omarchy's theme is `stipple`, the whole desktop takes its colours from
// the current Stipple wallpaper and the sun (palette.mjs; the wallpaper's Theme settings are the
// sidecar's `theme` block). Every minute the plugin works out the sun's elevation (from the weather
// location), shifts the wallpaper's ink and paper for it, and derives the palette:
//   - the shell (bar, menus, popups, notifications, lock) gets it in place, as `omarchy-shell shell
//     applyTheme` would, whenever it has visibly moved;
//   - the wallpaper surface redraws with the shifted ink and paper, a still wallpaper included
//     (shader mode 0 re-inks the PNG). When the hour takes ink and paper across each other (Custom's
//     night), it switches to the art drawn the other way round, which the sidecar's `night` block
//     brings (night.png, and the G of frames.png), so the night is a positive too;
//   - ~/.config/omarchy/themes/stipple/colors.toml is rewritten on a new wallpaper or settings, and
//     when the palette has drifted far enough (at most every 30 min), and `apply-theme.sh apply`
//     re-applies the theme so terminals, borders and apps follow. Each of those reloads in place.
import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import Quickshell.Hyprland
import qs.Commons
import "palette.mjs" as Palette

Item {
  id: root

  // Injected by omarchy-shell's plugin loader; unused.
  property var shell: null
  property var manifest: null

  readonly property string home: Quickshell.env("HOME")
  readonly property string stateDir: root.home + "/.local/state/omarchy/current"
  /** Injected by omarchy-shell's plugin loader (it must stay writable). */
  property string omarchyPath: Quickshell.env("OMARCHY_PATH") || "/usr/share/omarchy"
  readonly property string themeDir: root.home + "/.config/omarchy/themes/stipple"
  readonly property string glue: decodeURIComponent(String(Qt.resolvedUrl("apply-theme.sh")).replace(/^file:\/\//, ""))
  /** Dev only (shell-plugin/dev): show this PNG instead of following the background symlink. */
  property string override: ""
  /** Dev only: keep the session from idling while the surface is shown (power measurements). */
  property bool inhibitIdle: false
  /** False in the dev harness: it never writes the theme or re-applies it. */
  property bool writes: true
  /** Dev only: act as if Omarchy's theme were Stipple. */
  property bool forceTheme: false

  /** Resolved path of the current background. */
  property string current: ""
  /** The parsed sidecar when it belongs to `current`, else null. */
  property var doc: null
  /** `doc` when it has motion on, else null. */
  property var spec: null
  /** Bumped on every sidecar load, so the images reload with it. */
  property int version: 0
  /** Frames count time from here: time 0 is the saved PNG. */
  property real epoch: Date.now()
  property bool paused: false
  /** Dev only (`stipple at`): show this time (s) instead of the clock's, when >= 0. */
  property real frozen: -1

  readonly property bool isPng: /\.png$/i.test(root.current)
  readonly property string stem: root.isPng ? root.current.replace(/^.*\//, "").replace(/\.png$/i, "") : ""
  readonly property string dir: root.current.replace(/\/[^/]*$/, "")
  readonly property string sidecarPath: root.isPng ? root.dir + "/" + root.stem + ".stipple.json" : ""
  readonly property string framesPath: root.isPng ? root.dir + "/.stipple/" + root.stem + "/frames.png" : ""
  readonly property string glyphsPath: root.isPng ? root.dir + "/.stipple/" + root.stem + "/glyphs.png" : ""
  readonly property string nightPath: root.isPng ? root.dir + "/.stipple/" + root.stem + "/night.png" : ""

  readonly property var motion: root.spec ? root.spec.motion : null
  /** Columns: keyframes at other column counts, drawn from frames.png and glyphs.png. */
  readonly property bool letters: !!root.spec && !!root.motion && !!root.motion.columns && root.motion.columns.on
    && !!root.spec.columns && root.spec.columns.frames.length > 0
  /** Columns does not play but the colours follow the sun: the PNG re-inked (shader mode 0). */
  readonly property bool still: root.recolour && !root.letters
  /**
   * How far the hour's colours have turned the art over (palette.mjs flipAt): 0 draws the saved
   * art, 1 the art drawn the other way round, from the night textures the way it is drawn now has.
   */
  readonly property real flip: {
    const n = root.doc ? root.doc.night : null
    if (!root.recolour || !n) return 0
    const has = root.letters ? !!root.spec.columns.night : true
    return has ? root.themed.wall.flip : 0
  }
  readonly property bool idle: idleMonitor.isIdle

  /** The keyframe shown at time t: there and back once per period at an even pace, from `start` (motion.ts columnFrameAt). */
  function columnFrameAt(t, n, period, start) {
    if (n < 2) return 0
    const P = Math.max(period, 1)
    const s0 = Math.min(1, Math.max(0, start / (n - 1)))
    const u = (((t / P + s0 / 2) % 1) + 1) % 1
    const i = Math.round((n - 1) * (u < 0.5 ? 2 * u : 2 - 2 * u))
    return Math.min(n - 1, Math.max(0, i))
  }

  /** Glyph levels to draw a cell `h` px tall with: the smallest level at least h, the next one down, and its weight. */
  function levelsFor(h) {
    const ls = root.spec.columns.glyphs.levels
    let a = ls.length - 1
    for (let i = 0; i < ls.length; i++) if (ls[i].cellH >= h) { a = i; break }
    const b = Math.max(0, a - 1)
    const w = a === b || h >= ls[a].cellH ? 0 : Math.min(1, Math.log(ls[a].cellH / h) / Math.log(ls[a].cellH / ls[b].cellH))
    return { a: ls[a], b: ls[b], w: w }
  }

  // -------------------------------------------------------------------- colours

  /** The wallpaper's Theme settings (defaults for a sidecar without them). */
  readonly property var themeOpts: Palette.cleanTheme(root.doc ? root.doc.theme : null)
  /** The wallpaper's colours and the palette for the sun now. */
  readonly property var themed: root.doc && root.doc.colours ? Palette.themeAt(root.doc.colours, root.themeOpts, root.sunNow) : null
  /** The surface draws the wallpaper in the colours of the hour. */
  readonly property bool recolour: !!root.themed && root.themeActive && root.themeOpts.wallpaper && root.themeOpts.day !== "off"

  readonly property color ink: root.recolour ? root.themed.wall.ink : root.doc ? root.doc.colours.ink : "black"
  readonly property color paper: root.recolour ? root.themed.wall.paper : root.doc ? root.doc.colours.paper : "white"
  // the surround: its own colour, or the paper's
  readonly property color surround: {
    if (root.recolour) return root.themed.wall.surround
    const c = root.doc ? root.doc.colours : null
    const own = !!c && !!c.surround && String(c.surround).toLowerCase() !== String(c.paper).toLowerCase()
    return own ? c.surround : root.paper
  }

  // ------------------------------------------------------------------ the sun

  /** { name, latitude, longitude } of the weather location, or null (a 06:00-18:00 sun then). */
  property var location: null
  property var sunNow: Palette.clockSun(new Date())
  /** Dev (`stipple dayAt`): the minute of today to show instead of now, when >= 0. Never written. */
  property int dayMinute: -1

  function updateSun() {
    const now = new Date()
    const d = root.dayMinute >= 0 ? new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, root.dayMinute) : now
    const l = root.location
    root.sunNow = l ? Palette.sun(d, l.latitude, l.longitude) : Palette.clockSun(d)
  }

  FileView {
    path: root.home + "/.local/state/omarchy/settings/weather.json"
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: {
      let w = null
      try { w = JSON.parse(text()) } catch (e) { w = null }
      const lat = w ? Number(w.latitude) : NaN, lon = w ? Number(w.longitude) : NaN
      root.location = w && w.latitude !== undefined && Number.isFinite(lat) && Number.isFinite(lon)
        ? { name: String(w.name || ""), latitude: lat, longitude: lon } : null
      root.updateSun()
      Qt.callLater(root.themeTick)
    }
    onLoadFailed: { root.location = null; root.updateSun() }
  }

  Timer {
    interval: 60000
    repeat: true
    running: true
    triggeredOnStart: true
    onTriggered: { root.updateSun(); root.themeTick() }
  }

  // ---------------------------------------------------------------- the theme

  property string themeName: ""
  readonly property bool themeActive: root.themeName === "stipple" || root.forceTheme

  FileView {
    path: root.stateDir + "/theme.name"
    watchChanges: true
    blockLoading: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: root.themeName = text().trim()
    onLoadFailed: root.themeName = ""
  }

  // shell.toml is rendered from Omarchy's own template (a user override first), as theme set does
  property string userTpl: ""
  property string stockTpl: ""
  readonly property string shellTpl: root.userTpl || root.stockTpl
  FileView {
    path: root.home + "/.config/omarchy/themed/shell.toml.tpl"
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: root.userTpl = text()
    onLoadFailed: root.userTpl = ""
  }
  FileView {
    path: root.omarchyPath + "/default/themed/shell.toml.tpl"
    printErrors: false
    onLoaded: { root.stockTpl = text(); root.livePalette = null; Qt.callLater(root.themeTick) }
  }

  /** The last Stipple wallpaper's colours and settings: the palette keeps following the sun under a plain picture. */
  property var source: null
  /** The palette for now. */
  property var palette: null
  /** What the shell was last given, and when. */
  property var livePalette: null
  property real liveAt: 0
  /** What colors.toml was last written for (wallpaper, colours, settings), its palette, and when. */
  property string committedKey: ""
  property var committed: null
  property real committedAt: 0
  /** colors.toml as on disk, and as Omarchy last applied it. */
  property string onDisk: ""
  property string appliedText: ""
  property real lastAttempt: 0
  property string previewPng: ""

  /** Colours in the shell move when the palette has moved this far (OKLab; ~0.02 is just visible). */
  readonly property real liveStep: 0.004
  /** A drift this far rewrites colors.toml and re-applies the theme, */
  readonly property real commitStep: 0.04
  /** at most this often. */
  readonly property int commitEvery: 30 * 60000

  FileView {
    id: colorsOut
    path: root.themeDir + "/colors.toml"
    blockLoading: true
    atomicWrites: true
    printErrors: false
    // what is on disk at start is what the theme was last applied with
    onLoaded: if (!root.onDisk) { root.onDisk = text(); root.appliedText = root.onDisk }
  }

  onThemeActiveChanged: {
    root.livePalette = null
    // `omarchy theme set stipple` has just applied colors.toml and pushes it to the shell right
    // after writing theme.name: let that land before the live palette goes over it
    if (root.themeActive) { root.appliedText = root.onDisk; activated.restart() }
  }
  Timer { id: activated; interval: 2000; onTriggered: root.themeTick() }

  onDocChanged: Qt.callLater(root.themeTick)

  function applyLive(p) {
    if (!root.shellTpl) return
    Color.loadColors(Palette.colorsToml(p))
    Color.loadShell(Palette.renderTemplate(root.shellTpl, p))
    Style.scheduleRefresh()
    root.livePalette = p
    root.liveAt = Date.now()
  }

  function themeTick() {
    if (root.doc && root.doc.colours) {
      root.source = { colours: root.doc.colours, opts: root.themeOpts, png: root.current,
                      key: JSON.stringify([root.current, root.doc.colours, root.themeOpts]) }
    }
    const src = root.source
    if (!src) return
    const p = Palette.themeAt(src.colours, src.opts, root.sunNow).palette
    root.palette = p
    if (root.themeActive && !activated.running && Palette.paletteDistance(p, root.livePalette) > root.liveStep) root.applyLive(p)
    if (!root.writes || root.dayMinute >= 0) return

    const fresh = src.key !== root.committedKey
    const drift = Palette.paletteDistance(p, root.committed) > root.commitStep
    if (fresh || (drift && Date.now() - root.committedAt >= root.commitEvery)) {
      root.committedKey = src.key
      root.committed = p
      root.committedAt = Date.now()
      const text = Palette.colorsToml(p)
      if (text !== root.onDisk) { colorsOut.setText(text); root.onDisk = text }
      if (src.png !== root.previewPng) {
        root.previewPng = src.png
        preview.command = [root.glue, "preview", src.png]
        preview.running = true
      }
      if (fresh) root.lastAttempt = 0
    }
    root.maybeApply()
  }

  /** Re-apply the theme when colors.toml is newer than what Omarchy applied (retrying a deferral each minute). */
  function maybeApply() {
    if (!root.writes || !root.themeActive || apply.running || !root.onDisk || root.onDisk === root.appliedText) return
    if (Date.now() - root.lastAttempt < 55000) return
    root.lastAttempt = Date.now()
    apply.pending = root.onDisk
    apply.running = true
  }

  Process {
    id: preview
    stderr: StdioCollector { onStreamFinished: if (text.trim()) console.warn("stipple: preview:", text.trim()) }
  }

  Process {
    id: apply
    property string pending: ""
    command: [root.glue, "apply"]
    stderr: StdioCollector { onStreamFinished: if (text.trim()) console.warn("stipple: apply-theme:", text.trim()) }
    onExited: (code, status) => {
      // 75: the screensaver or another theme change was in the way; the next minute retries
      if (code === 75) return
      if (code !== 0) console.warn("stipple: apply-theme.sh apply exited", code)
      root.appliedText = apply.pending
      // theme set pushed colors.toml to the shell: put the palette of this minute back
      root.livePalette = null
      root.themeTick()
    }
  }

  // ------------------------------------------------------------------ frame rate

  /** Frames per second the effects ask for (0: nothing moves). */
  readonly property real baseFps: {
    const m = root.motion
    // Columns: a new keyframe every period / (2 (n - 1)) s, ticked four times as often so each
    // shows for its own time within a quarter frame (a tick that finds no change draws nothing)
    if (!m || !root.letters) return 0
    return Math.min(60, Math.max(1, 8 * (root.spec.columns.frames.length - 1) / Math.max(m.columns.period, 1)))
  }

  /** Share of the screen windows cover at which motion stops: only gaps show. */
  readonly property real coveredStill: 0.9

  function fpsFor(hasWindows, covered, fullscreen) {
    const m = root.motion
    if (!m || root.paused || root.idle || fullscreen) return 0
    // with windows open on the screen: at most 2 frames a second, none when they cover it
    if (hasWindows) return covered >= root.coveredStill ? 0 : Math.min(root.baseFps, 2)
    return root.baseFps
  }

  IdleMonitor {
    id: idleMonitor
    timeout: 60
  }

  // Quickshell refreshes workspaces on lifecycle events only; fullscreen and window counts are
  // read off the same snapshot (see kivan.dictation-osd), window geometry off the toplevels'.
  Connections {
    target: Hyprland
    function onRawEvent(event) {
      switch (String(event.name || "")) {
      case "fullscreen":
      case "openwindow":
      case "closewindow":
      case "movewindow":
      case "movewindowv2":
      case "workspace":
      case "workspacev2":
      case "focusedmon":
        Hyprland.refreshWorkspaces()
        Hyprland.refreshToplevels()
        break
      case "changefloatingmode":
      case "activewindowv2": // the scrolling layout moves columns into view on focus
        Hyprland.refreshToplevels()
        break
      case "monitoradded":
      case "monitorremoved":
      case "configreloaded":
        Hyprland.refreshMonitors()
        break
      }
    }
  }

  /** Window borders count as covered (they are outside a window's at/size). */
  property int borderSize: 2
  Process {
    running: true
    command: ["hyprctl", "getoption", "general:border_size", "-j"]
    stdout: StdioCollector {
      onStreamFinished: {
        try { root.borderSize = JSON.parse(text).int || 0 } catch (e) {}
      }
    }
  }

  /** Area of the union of [x0, y0, x1, y1] rectangles. */
  function unionArea(rects) {
    const xs = [...new Set(rects.map(r => r[0]).concat(rects.map(r => r[2])))].sort((a, b) => a - b) // no flatMap in QML
    let area = 0
    for (let i = 0; i + 1 < xs.length; i++) {
      const x0 = xs[i], x1 = xs[i + 1]
      const ys = rects.filter(r => r[0] <= x0 && r[2] >= x1).map(r => [r[1], r[3]]).sort((a, b) => a[0] - b[0])
      let len = 0, end = -Infinity
      for (const [a, b] of ys) {
        if (b <= end) continue
        len += b - Math.max(a, end)
        end = b
      }
      area += len * (x1 - x0)
    }
    return area
  }

  /** Share (0-1) of a monitor that the windows of workspace `ws` and its reserved edges (the bar) cover. */
  function coverage(mon, ws) {
    if (!mon || !ws || !mon.width || !mon.height) return 0
    const sc = mon.scale || 1
    const rot = (mon.transform || 0) % 2 === 1
    const W = (rot ? mon.height : mon.width) / sc, H = (rot ? mon.width : mon.height) / sc
    const res = mon.reserved || [0, 0, 0, 0]
    const clip = r => [Math.max(0, r[0]), Math.max(0, r[1]), Math.min(W, r[2]), Math.min(H, r[3])]
    const rects = [[0, 0, res[0], H], [0, 0, W, res[1]], [W - res[2], 0, W, H], [0, H - res[3], W, H]]
    const b = root.borderSize
    for (const t of Hyprland.toplevels.values) {
      const o = t.lastIpcObject
      if (!o || !o.at || !o.size || o.hidden || o.mapped === false || !o.workspace || o.workspace.id !== ws.id) continue
      const x = o.at[0] - mon.x, y = o.at[1] - mon.y
      rects.push([x - b, y - b, x + o.size[0] + b, y + o.size[1] + b])
    }
    const inside = rects.map(clip).filter(r => r[2] > r[0] && r[3] > r[1])
    return root.unionArea(inside) / (W * H)
  }

  // ------------------------------------------------------------ current background

  Process {
    id: resolve
    command: ["readlink", "-f", root.stateDir + "/background"]
    stdout: StdioCollector {
      onStreamFinished: {
        const p = String(text || "").trim()
        if (p !== root.current) {
          root.doc = null
          root.spec = null
          root.current = p
        }
      }
    }
  }

  function refresh() {
    if (root.override) {
      if (root.current !== root.override) { root.doc = null; root.spec = null; root.current = root.override }
      return
    }
    if (!resolve.running) resolve.running = true
  }

  // `omarchy theme bg set` re-points the symlink with `ln -nsf`: a create in this directory.
  Process {
    id: watch
    running: !root.override
    command: ["inotifywait", "-m", "-q", "-e", "create,moved_to,delete", "--format", "%f", root.stateDir]
    stdout: SplitParser {
      onRead: data => { if (String(data).trim() === "background") root.refresh() }
    }
    onExited: if (!root.override) rewatch.restart()
  }

  Timer {
    id: rewatch
    interval: 5000
    onTriggered: { watch.running = true; root.refresh() }
  }

  Component.onCompleted: {
    refresh()
    Hyprland.refreshMonitors()
    Hyprland.refreshToplevels()
  }

  FileView {
    id: sidecar
    path: root.sidecarPath
    watchChanges: true
    printErrors: false
    onLoaded: root.load(text())
    onLoadFailed: { root.doc = null; root.spec = null }
    onFileChanged: reload()
  }

  function load(raw) {
    let s = null
    try { s = JSON.parse(raw) } catch (e) { s = null }
    if (!s || !/^stipple\//.test(String(s.format)) || !s.colours || !s.image || !s.layout) {
      root.doc = null
      root.spec = null
      return
    }
    // Columns is the only motion (an older Dots wallpaper's Twinkle shows still, re-inked)
    const m = s.motion
    const on = !!m && !!m.columns && m.columns.on
    root.version++
    root.epoch = Date.now()
    root.doc = s
    root.spec = on ? s : null
  }

  // ------------------------------------------------------------------------ IPC

  IpcHandler {
    target: "stipple"

    function pause(): string { root.paused = true; return "paused" }
    function resume(): string { root.frozen = -1; root.paused = false; return "running" }

    /** Pause on the frame for `seconds` after time 0 (checks). `resume` goes back to the clock. */
    function at(seconds: real): string {
      root.paused = true
      root.frozen = seconds
      surfaces.instances.forEach(w => w.tick())
      return "at " + seconds
    }

    /** Show the colours of `minute` (0-1439) today instead of now; -1 goes back to the clock. Writes nothing. */
    function dayAt(minute: int): string {
      root.dayMinute = minute >= 0 ? Math.min(1439, minute) : -1
      root.updateSun()
      root.themeTick()
      return JSON.stringify({ at: root.dayMinute, sun: root.sunNow, wall: root.themed ? root.themed.wall : null, background: root.palette ? root.palette.background : null })
    }

    /** Rewrite colors.toml now and re-apply the theme (checks). */
    function retheme(): string {
      root.committedKey = ""
      root.appliedText = ""
      root.lastAttempt = 0
      root.themeTick()
      return root.themeActive ? "applying" : "written (the theme is not active)"
    }

    function status(): string {
      return JSON.stringify({
        current: root.current,
        animated: !!root.spec,
        theme: {
          name: root.themeName,
          active: root.themeActive,
          day: root.themeOpts.day,
          strength: root.themeOpts.strength,
          recolour: root.recolour,
          flip: Math.round(root.flip * 1000) / 1000,
          location: root.location,
          sun: { elevation: Math.round(root.sunNow.elevation * 10) / 10, rising: root.sunNow.rising, at: root.dayMinute },
          palette: root.palette ? { background: root.palette.background, foreground: root.palette.foreground, accent: root.palette.accent } : null,
          wall: root.recolour ? root.themed.wall : null,
          live: root.liveAt ? new Date(root.liveAt).toISOString() : null,
          committed: root.committedAt ? new Date(root.committedAt).toISOString() : null,
          applied: !!root.onDisk && root.onDisk === root.appliedText,
        },
        version: root.version,
        paused: root.paused,
        idle: root.idle,
        screens: surfaces.instances.map(w => ({ name: w.screen ? w.screen.name : "", shown: w.visible, art: w.artStatus, fps: w.fps, keyframe: w.keyframe, fullscreen: w.fullscreen, windows: w.hasWindows, covered: Math.round(w.covered * 1000) / 1000, frames: w.frameCount })),
      })
    }

    /** Render the first screen's current frame at `width` x `height` into `path` (for checks). */
    function grab(path: string, width: int, height: int): string {
      const w = surfaces.instances[0]
      if (!w || !w.visible) return "not shown"
      w.grab(path, width, height)
      return "ok"
    }
  }

  // ---------------------------------------------------------------------- surfaces

  Variants {
    id: surfaces
    model: Quickshell.screens

    PanelWindow {
      id: win
      required property var modelData

      screen: modelData
      readonly property int artStatus: artImg.status
      readonly property bool ready: (!root.still || artImg.status === Image.Ready)
        && (!root.letters || (framesImg.status === Image.Ready && glyphsImg.status === Image.Ready))
        && (!root.still || root.flip <= 0 || nightImg.status === Image.Ready)
      visible: (!!root.spec || root.recolour) && ready
      color: root.paper
      anchors { top: true; bottom: true; left: true; right: true }
      exclusionMode: ExclusionMode.Ignore
      WlrLayershell.namespace: "stipple"
      WlrLayershell.layer: WlrLayer.Bottom
      WlrLayershell.keyboardFocus: WlrKeyboardFocus.None
      // click-through: double-clicking the desktop still reaches Omarchy's background
      mask: Region {}

      readonly property var monitor: Hyprland.monitorFor(win.modelData)
      readonly property var workspace: win.monitor && win.monitor.activeWorkspace ? win.monitor.activeWorkspace.lastIpcObject : null
      readonly property bool fullscreen: !!win.workspace && win.workspace.hasfullscreen === true
      readonly property bool hasWindows: !!win.workspace && (win.workspace.windows || 0) > 0
      readonly property real covered: win.hasWindows && win.visible ? root.coverage(win.monitor.lastIpcObject, win.workspace) : 0
      readonly property real fps: root.fpsFor(win.hasWindows, win.covered, win.fullscreen)
      readonly property bool animating: win.visible && win.fps > 0
      /** Frames asked for so far (status, to check the pacing). */
      property int frameCount: 0
      /** Columns: the keyframe shown. */
      property int keyframe: root.letters ? root.spec.columns.start : 0

      IdleInhibitor {
        window: win
        enabled: root.inhibitIdle && win.visible
      }

      function grab(path, w, h) {
        shader.grabToImage(r => r.saveToFile(path), Qt.size(w, h))
      }

      // Show the keyframe for now. A tick that has not moved leaves it alone, so no frame is
      // drawn for it. The timer repeats at a fixed interval: re-arming a one-shot timer after
      // every frame makes Qt Quick render each frame twice.
      function tick() {
        const m = root.motion
        if (!m || !root.letters) return
        const t = root.frozen >= 0 ? root.frozen : Math.max(0, (Date.now() - root.epoch) / 1000)
        const k = root.columnFrameAt(t, root.spec.columns.frames.length, m.columns.period, root.spec.columns.start)
        if (k !== win.keyframe) {
          win.keyframe = k
          win.frameCount++
        }
      }

      Timer {
        interval: Math.max(16, Math.round(1000 / Math.max(win.fps, 0.1)))
        repeat: true
        running: win.animating
        triggeredOnStart: true
        onTriggered: win.tick()
      }

      Connections {
        target: root
        function onEpochChanged() { win.tick() }
      }

      Image {
        id: artImg
        visible: false
        asynchronous: false
        cache: false
        smooth: true
        source: root.still ? "file://" + encodeURI(root.current) + "?v=" + root.version : ""
      }

      Image {
        id: framesImg
        visible: false
        asynchronous: false
        cache: false
        smooth: false
        source: root.letters ? "file://" + encodeURI(root.framesPath) + "?v=" + root.version : ""
      }

      Image {
        id: glyphsImg
        visible: false
        asynchronous: false
        cache: false
        smooth: false
        source: root.letters ? "file://" + encodeURI(root.glyphsPath) + "?v=" + root.version : ""
      }

      Image {
        id: nightImg
        visible: false
        asynchronous: false
        cache: false
        smooth: true
        // loaded from the first hour it is needed on, and kept for the rest of this wallpaper
        property bool wanted: false
        source: wanted ? "file://" + encodeURI(root.nightPath) + "?v=" + root.version : ""
        Connections {
          target: root
          function onFlipChanged() { if (root.still && root.flip > 0) nightImg.wanted = true }
          function onVersionChanged() { nightImg.wanted = root.still && root.flip > 0 }
          function onStillChanged() { if (root.still && root.flip > 0) nightImg.wanted = true }
        }
        Component.onCompleted: wanted = root.still && root.flip > 0
      }

      ShaderEffect {
        id: shader
        anchors.fill: parent
        fragmentShader: Qt.resolvedUrl("shaders/wall.frag.qsb")

        readonly property var sp: root.doc
        readonly property real cw: sp ? sp.image.width : 1
        readonly property real ch: sp ? sp.image.height : 1
        // PreserveAspectCrop, as Omarchy draws the PNG: wallpaper px = uv * map.xy + map.zw
        readonly property real k: Math.max(width / cw, height / ch)

        property color ink: root.ink
        property color paper: root.paper
        property color srcInk: sp ? sp.colours.ink : "black"
        property color srcPaper: sp ? sp.colours.paper : "white"
        property vector4d canvas: Qt.vector4d(cw, ch, root.letters ? 2 : 0, 0)
        property vector4d map: Qt.vector4d(width / k, height / k, cw / 2 - width / k / 2, ch / 2 - height / k / 2)
        property vector4d clipRect: {
          const c = sp && sp.layout.clip
          return c ? Qt.vector4d(Math.max(0, Math.floor(c.x)), Math.max(0, Math.floor(c.y)), Math.min(cw, Math.ceil(c.x + c.w)), Math.min(ch, Math.ceil(c.y + c.h)))
                   : Qt.vector4d(0, 0, cw, ch)
        }
        property vector4d effects: Qt.vector4d(0, root.flip, 0, 0)
        property vector4d inner: {
          const r = sp && sp.layout.inner
          return r ? Qt.vector4d(r.x, r.y, r.x + r.w, r.y + r.h) : Qt.vector4d(0, 0, cw, ch)
        }
        property color surround: root.surround
        // Columns: the keyframe shown and the two glyph levels nearest its cell height
        readonly property var kf: root.letters ? root.spec.columns.frames[Math.min(win.keyframe, root.spec.columns.frames.length - 1)] : null
        readonly property var lv: kf ? root.levelsFor(kf.cellH) : null
        property vector4d fcell: kf ? Qt.vector4d(kf.x, kf.y, kf.cellW, kf.cellH) : Qt.vector4d(0, 0, 1, 1)
        property vector4d fgrid: kf ? Qt.vector4d(kf.cols, kf.rows, kf.ax, kf.ay) : Qt.vector4d(0, 0, 0, 0)
        property vector4d lvA: lv ? Qt.vector4d(lv.a.y, lv.a.cellW, lv.a.cellH, lv.a.tileW) : Qt.vector4d(0, 1, 1, 1)
        property vector4d lvB: lv ? Qt.vector4d(lv.b.y, lv.b.cellW, lv.b.cellH, lv.b.tileW) : Qt.vector4d(0, 1, 1, 1)
        property vector4d lvX: lv ? Qt.vector4d(lv.a.tileH, lv.a.perRow, lv.b.tileH, lv.b.perRow) : Qt.vector4d(1, 1, 1, 1)
        property vector4d lvMix: Qt.vector4d(lv ? lv.w : 0, 0, 0, 0)
        property var artTex: artImg
        property var framesTex: framesImg
        property var glyphTex: glyphsImg
        property var nightTex: nightImg
      }
    }
  }
}
