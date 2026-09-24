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
// come from a Timer at the effect's own rate, and it stops whenever nothing can see them:
// a fullscreen window, 60 s idle (screensaver, lock, screen off), or `stipple pause`.
import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import Quickshell.Hyprland
import Quickshell.Services.UPower

Item {
  id: root

  // Injected by omarchy-shell's plugin loader; unused.
  property var shell: null
  property var manifest: null

  readonly property string stateDir: Quickshell.env("HOME") + "/.local/state/omarchy/current"
  /** Dev only (shell-plugin/dev): show this PNG instead of following the background symlink. */
  property string override: ""

  /** Resolved path of the current background. */
  property string current: ""
  /** The parsed sidecar when it belongs to `current` and has motion on, else null. */
  property var spec: null
  /** Bumped on every sidecar load, so the images reload with it. */
  property int version: 0
  /** Frames count time from here: time 0 is the saved PNG. */
  property real epoch: Date.now()
  property bool paused: false
  /** Minutes since midnight, for Colour over the day. */
  property int minuteNow: 0

  readonly property bool isPng: /\.png$/i.test(root.current)
  readonly property string stem: root.isPng ? root.current.replace(/^.*\//, "").replace(/\.png$/i, "") : ""
  readonly property string dir: root.current.replace(/\/[^/]*$/, "")
  readonly property string sidecarPath: root.isPng ? root.dir + "/" + root.stem + ".stipple.json" : ""
  readonly property string fieldPath: root.isPng ? root.dir + "/.stipple/" + root.stem + "/field.png" : ""

  readonly property var motion: root.spec ? root.spec.motion : null
  readonly property bool dots: !!root.spec && !!root.motion && root.spec.grid.mode === "braille"
    && (root.motion.twinkle.on || root.motion.shimmer.on || root.motion.pan.on)
  readonly property bool idle: idleMonitor.isIdle

  // -------------------------------------------------------------------- colours

  function hexRgb(h) {
    const n = parseInt(String(h).replace("#", ""), 16) || 0
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }

  function mixHex(a, b, t) {
    const x = hexRgb(a), y = hexRgb(b)
    const c = i => Math.round(x[i] + (y[i] - x[i]) * t)
    return Qt.rgba(c(0) / 255, c(1) / 255, c(2) / 255, 1)
  }

  /** 0 by day, 1 by night, ramping over `fade` minutes centred on each boundary (motion.ts nightWeight). */
  function nightWeight(m, start, end, fade) {
    const fwd = (a, b) => (((a - b) % 1440) + 1440) % 1440
    const inside = start <= end ? (m >= start && m < end) : (m >= start || m < end)
    if (fade > 0) {
      const h = fade / 2, s = fwd(m, start), e = fwd(m, end)
      if (s < h) return 0.5 + s / fade
      if (1440 - s <= h) return 0.5 - (1440 - s) / fade
      if (e < h) return 0.5 - e / fade
      if (1440 - e <= h) return 0.5 + (1440 - e) / fade
    }
    return inside ? 1 : 0
  }

  readonly property real night: {
    const d = root.motion ? root.motion.day : null
    if (!d || !d.on) return 0
    return root.nightWeight(root.minuteNow, d.nightStart, d.nightEnd, d.fade)
  }
  readonly property color ink: root.spec && root.motion ? root.mixHex(root.spec.colours.ink, root.motion.day.nightInk, root.night) : "black"
  readonly property color paper: root.spec && root.motion ? root.mixHex(root.spec.colours.paper, root.motion.day.nightPaper, root.night) : "white"

  Timer {
    interval: 30000
    repeat: true
    running: !!root.motion && root.motion.day.on
    triggeredOnStart: true
    onTriggered: {
      const d = new Date()
      root.minuteNow = d.getHours() * 60 + d.getMinutes()
    }
  }

  // ------------------------------------------------------------------ frame rate

  /** Frames per second the effects ask for (0: nothing moves between colour updates). */
  readonly property real baseFps: {
    const m = root.motion
    if (!m || !root.dots) return 0
    if (m.pan.on) return m.pan.fps
    return Math.max(m.twinkle.on ? m.twinkle.rate : 0, m.shimmer.on ? m.shimmer.rate : 0)
  }

  function fpsFor(hasWindows, fullscreen) {
    const m = root.motion
    if (!m || root.paused || root.idle || fullscreen) return 0
    let f = root.baseFps
    if (hasWindows) f = m.windows === "still" ? 0 : m.windows === "slow" ? Math.min(f, 2) : f
    if (UPower.onBattery) f = m.battery === "still" ? 0 : m.battery === "half" ? f / 2 : f
    return f
  }

  IdleMonitor {
    id: idleMonitor
    timeout: 60
  }

  // Quickshell refreshes workspaces on lifecycle events only; fullscreen and window counts are
  // read off the same snapshot (see kivan.dictation-osd).
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
        break
      }
    }
  }

  // ------------------------------------------------------------ current background

  Process {
    id: resolve
    command: ["readlink", "-f", root.stateDir + "/background"]
    stdout: StdioCollector {
      onStreamFinished: {
        const p = String(text || "").trim()
        if (p !== root.current) {
          root.spec = null
          root.current = p
        }
      }
    }
  }

  function refresh() {
    if (root.override) {
      if (root.current !== root.override) { root.spec = null; root.current = root.override }
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

  Component.onCompleted: refresh()

  FileView {
    id: sidecar
    path: root.sidecarPath
    watchChanges: true
    printErrors: false
    onLoaded: root.load(text())
    onLoadFailed: root.spec = null
    onFileChanged: reload()
  }

  function load(raw) {
    let s = null
    try { s = JSON.parse(raw) } catch (e) { s = null }
    const m = s && s.motion
    const on = !!m && (m.twinkle.on || m.shimmer.on || m.pan.on || m.day.on)
    const colourBlocks = !!s && !!s.grid && !!s.grid.fg
    if (!s || !/^stipple\//.test(String(s.format)) || !on || colourBlocks) {
      root.spec = null
      return
    }
    root.version++
    root.epoch = Date.now()
    root.spec = s
  }

  // ------------------------------------------------------------------------ IPC

  IpcHandler {
    target: "stipple"

    function pause(): string { root.paused = true; return "paused" }
    function resume(): string { root.paused = false; return "running" }

    function status(): string {
      return JSON.stringify({
        current: root.current,
        animated: !!root.spec,
        paused: root.paused,
        idle: root.idle,
        onBattery: UPower.onBattery,
        screens: surfaces.instances.map(w => ({ name: w.screen ? w.screen.name : "", shown: w.visible, art: w.artStatus, field: w.fieldStatus, fps: w.fps, fullscreen: w.fullscreen, windows: w.hasWindows })),
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
      readonly property int fieldStatus: fieldImg.status
      readonly property bool ready: artImg.status === Image.Ready && (!root.dots || fieldImg.status === Image.Ready)
      visible: !!root.spec && ready
      color: root.paper
      anchors { top: true; bottom: true; left: true; right: true }
      exclusionMode: ExclusionMode.Ignore
      WlrLayershell.namespace: "stipple"
      WlrLayershell.layer: WlrLayer.Bottom
      WlrLayershell.keyboardFocus: WlrKeyboardFocus.None
      // click-through: double-clicking the desktop still reaches Omarchy's background
      mask: Region {}

      readonly property var workspace: {
        const mon = Hyprland.monitorFor(win.modelData)
        return mon && mon.activeWorkspace ? mon.activeWorkspace.lastIpcObject : null
      }
      readonly property bool fullscreen: !!win.workspace && win.workspace.hasfullscreen === true
      readonly property bool hasWindows: !!win.workspace && (win.workspace.windows || 0) > 0
      readonly property real fps: root.fpsFor(win.hasWindows, win.fullscreen)
      property real now: 0

      function grab(path, w, h) {
        shader.grabToImage(r => r.saveToFile(path), Qt.size(w, h))
      }

      Timer {
        interval: Math.max(16, Math.round(1000 / Math.max(win.fps, 0.1)))
        repeat: true
        running: win.visible && win.fps > 0
        triggeredOnStart: true
        onTriggered: win.now = (Date.now() - root.epoch) / 1000
      }

      Connections {
        target: root
        function onEpochChanged() { win.now = 0 }
      }

      Image {
        id: artImg
        visible: false
        asynchronous: false
        cache: false
        smooth: true
        source: root.spec ? "file://" + encodeURI(root.current) + "?v=" + root.version : ""
      }

      Image {
        id: fieldImg
        visible: false
        asynchronous: false
        cache: false
        smooth: false
        source: root.dots ? "file://" + encodeURI(root.fieldPath) + "?v=" + root.version : ""
      }

      ShaderEffect {
        id: shader
        anchors.fill: parent
        fragmentShader: Qt.resolvedUrl("shaders/wall.frag.qsb")

        readonly property var sp: root.spec
        readonly property real cw: sp ? sp.image.width : 1
        readonly property real ch: sp ? sp.image.height : 1
        // PreserveAspectCrop, as Omarchy draws the PNG: wallpaper px = uv * map.xy + map.zw
        readonly property real k: Math.max(width / cw, height / ch)

        property color ink: root.ink
        property color paper: root.paper
        property color srcInk: sp ? sp.colours.ink : "black"
        property color srcPaper: sp ? sp.colours.paper : "white"
        property vector4d canvas: Qt.vector4d(cw, ch, root.dots ? 1 : 0, sp ? (sp.motion.seed >>> 0) % 65536 : 0)
        property vector4d map: Qt.vector4d(width / k, height / k, cw / 2 - width / k / 2, ch / 2 - height / k / 2)
        property vector4d lattice: sp ? Qt.vector4d(sp.layout.x, sp.layout.y, sp.layout.cellW / 2, sp.layout.cellH / 4) : Qt.vector4d(0, 0, 1, 1)
        property vector4d clipRect: {
          const c = sp && sp.layout.clip
          return c ? Qt.vector4d(Math.max(0, Math.floor(c.x)), Math.max(0, Math.floor(c.y)), Math.min(cw, Math.ceil(c.x + c.w)), Math.min(ch, Math.ceil(c.y + c.h)))
                   : Qt.vector4d(0, 0, cw, ch)
        }
        property vector4d field: {
          if (!sp) return Qt.vector4d(1, 1, 0, 0)
          const px = sp.layout.cellW / 2, py = sp.layout.cellH / 4
          return Qt.vector4d(sp.grid.cols * 2, sp.grid.rows * 4, Math.min(sp.layout.dotR * px, 0.46 * py, 0.46 * px), 0)
        }
        property vector4d effects: {
          const m = sp ? sp.motion : null
          if (!m) return Qt.vector4d(0, 0, 0, 1)
          return Qt.vector4d(m.twinkle.on ? m.twinkle.amount : 0, m.shimmer.on ? m.shimmer.amount : 0,
            m.pan.on ? m.pan.zoom : 0, m.pan.period)
        }
        property vector4d clock: {
          const m = sp ? sp.motion : null
          const t = win.now
          return Qt.vector4d(t, m ? Math.floor(t * m.twinkle.rate) : 0, m ? Math.floor(t * m.shimmer.rate) : 0, 0)
        }
        property var fieldTex: fieldImg
        property var artTex: artImg
      }
    }
  }
}
