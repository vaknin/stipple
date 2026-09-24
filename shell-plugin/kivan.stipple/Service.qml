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
// come from a Timer at the effect's own rate, drawn only when the picture changes, and none
// while nothing can see them: a fullscreen window, windows covering 90% of the screen,
// 60 s idle (screensaver, lock, screen off), or `stipple pause`.
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
  /** Dev only: keep the session from idling while the surface is shown (power measurements). */
  property bool inhibitIdle: false

  /** Resolved path of the current background. */
  property string current: ""
  /** The parsed sidecar when it belongs to `current` and has motion on, else null. */
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
  readonly property string fieldPath: root.isPng ? root.dir + "/.stipple/" + root.stem + "/field.png" : ""
  readonly property string framesPath: root.isPng ? root.dir + "/.stipple/" + root.stem + "/frames.png" : ""
  readonly property string glyphsPath: root.isPng ? root.dir + "/.stipple/" + root.stem + "/glyphs.png" : ""

  readonly property var motion: root.spec ? root.spec.motion : null
  readonly property bool dots: !!root.spec && !!root.motion && root.spec.grid.mode === "braille"
    && (root.motion.twinkle.on || root.motion.shimmer.on || root.motion.pan.on)
  /** Columns (Letters): keyframes at other column counts, drawn from frames.png and glyphs.png. */
  readonly property bool letters: !!root.spec && !!root.motion && !!root.motion.columns && root.motion.columns.on
    && !!root.spec.columns && root.spec.columns.frames.length > 0
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

  readonly property color ink: root.spec ? root.spec.colours.ink : "black"
  readonly property color paper: root.spec ? root.spec.colours.paper : "white"
  // the surround: its own colour, or the paper's
  readonly property color surround: {
    const c = root.spec ? root.spec.colours : null
    const own = !!c && !!c.surround && String(c.surround).toLowerCase() !== String(c.paper).toLowerCase()
    return own ? c.surround : root.paper
  }

  // ------------------------------------------------------------------ frame rate

  /** Frames per second the effects ask for (0: nothing moves). */
  readonly property real baseFps: {
    const m = root.motion
    // Columns: a new keyframe every period / (2 (n - 1)) s, ticked four times as often so each
    // shows for its own time within a quarter frame (a tick that finds no change draws nothing)
    if (m && root.letters) return Math.min(60, Math.max(1, 8 * (root.spec.columns.frames.length - 1) / Math.max(m.columns.period, 1)))
    if (!m || !root.dots) return 0
    if (m.pan.on) return m.pan.fps
    return Math.max(m.twinkle.on ? m.twinkle.rate : 0, m.shimmer.on ? m.shimmer.rate : 0)
  }

  /** Share of the screen windows cover at which "slow" treats it as "still": only gaps show. */
  readonly property real coveredStill: 0.9

  function fpsFor(hasWindows, covered, fullscreen) {
    const m = root.motion
    if (!m || root.paused || root.idle || fullscreen) return 0
    let f = root.baseFps
    if (hasWindows && m.windows === "slow" && covered >= root.coveredStill) f = 0
    if (hasWindows) f = m.windows === "still" ? 0 : m.windows === "slow" ? Math.min(f, 2) : f
    if (UPower.onBattery) f = m.battery === "still" ? 0 : m.battery === "half" ? f / 2 : f
    return f
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
    onLoadFailed: root.spec = null
    onFileChanged: reload()
  }

  function load(raw) {
    let s = null
    try { s = JSON.parse(raw) } catch (e) { s = null }
    const m = s && s.motion
    const on = !!m && (m.twinkle.on || m.shimmer.on || m.pan.on || (!!m.columns && m.columns.on))
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
    function resume(): string { root.frozen = -1; root.paused = false; return "running" }

    /** Pause on the frame for `seconds` after time 0 (checks). `resume` goes back to the clock. */
    function at(seconds: real): string {
      root.paused = true
      root.frozen = seconds
      surfaces.instances.forEach(w => w.tick())
      return "at " + seconds
    }

    function status(): string {
      return JSON.stringify({
        current: root.current,
        animated: !!root.spec,
        version: root.version,
        paused: root.paused,
        idle: root.idle,
        onBattery: UPower.onBattery,
        screens: surfaces.instances.map(w => ({ name: w.screen ? w.screen.name : "", shown: w.visible, field: w.fieldStatus, fps: w.fps, keyframe: w.keyframe, fullscreen: w.fullscreen, windows: w.hasWindows, covered: Math.round(w.covered * 1000) / 1000, frames: w.frameCount })),
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
      readonly property int fieldStatus: fieldImg.status
      readonly property bool ready: (!root.dots || fieldImg.status === Image.Ready)
        && (!root.letters || (framesImg.status === Image.Ready && glyphsImg.status === Image.Ready))
      visible: !!root.spec && ready
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
      /** Time (s, only while panning), twinkle tick, shimmer tick: what the frame shows. */
      property vector4d clock: Qt.vector4d(0, 0, 0, 0)
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

      // Set the clock for now. A tick that has not moved leaves the clock alone, so no frame is
      // drawn for it. The timer repeats at a fixed interval: re-arming a one-shot timer after
      // every frame makes Qt Quick render each frame twice.
      function tick() {
        const m = root.motion
        if (!m) return
        const t = root.frozen >= 0 ? root.frozen : Math.max(0, (Date.now() - root.epoch) / 1000)
        if (root.letters) {
          const k = root.columnFrameAt(t, root.spec.columns.frames.length, m.columns.period, root.spec.columns.start)
          if (k !== win.keyframe) {
            win.keyframe = k
            win.frameCount++
          }
          return
        }
        const c = Qt.vector4d(m.pan.on ? t : 0, m.twinkle.on ? Math.floor(t * m.twinkle.rate) : 0,
          m.shimmer.on ? Math.floor(t * m.shimmer.rate) : 0, 0)
        if (c.x !== win.clock.x || c.y !== win.clock.y || c.z !== win.clock.z) {
          win.clock = c
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
        id: fieldImg
        visible: false
        asynchronous: false
        cache: false
        smooth: false
        source: root.dots ? "file://" + encodeURI(root.fieldPath) + "?v=" + root.version : ""
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
        property vector4d canvas: Qt.vector4d(cw, ch, root.letters ? 2 : 1, sp ? (sp.motion.seed >>> 0) % 65536 : 0)
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
        property vector4d inner: {
          const r = sp && sp.layout.inner
          return r ? Qt.vector4d(r.x, r.y, r.x + r.w, r.y + r.h) : Qt.vector4d(0, 0, cw, ch)
        }
        property color surround: root.surround
        property vector4d clock: win.clock
        // Columns: the keyframe shown and the two glyph levels nearest its cell height
        readonly property var kf: root.letters ? root.spec.columns.frames[Math.min(win.keyframe, root.spec.columns.frames.length - 1)] : null
        readonly property var lv: kf ? root.levelsFor(kf.cellH) : null
        property vector4d fcell: kf ? Qt.vector4d(kf.x, kf.y, kf.cellW, kf.cellH) : Qt.vector4d(0, 0, 1, 1)
        property vector4d fgrid: kf ? Qt.vector4d(kf.cols, kf.rows, kf.ax, kf.ay) : Qt.vector4d(0, 0, 0, 0)
        property vector4d lvA: lv ? Qt.vector4d(lv.a.y, lv.a.cellW, lv.a.cellH, lv.a.tileW) : Qt.vector4d(0, 1, 1, 1)
        property vector4d lvB: lv ? Qt.vector4d(lv.b.y, lv.b.cellW, lv.b.cellH, lv.b.tileW) : Qt.vector4d(0, 1, 1, 1)
        property vector4d lvX: lv ? Qt.vector4d(lv.a.tileH, lv.a.perRow, lv.b.tileH, lv.b.perRow) : Qt.vector4d(1, 1, 1, 1)
        property vector4d lvMix: Qt.vector4d(lv ? lv.w : 0, 0, 0, 0)
        property var fieldTex: fieldImg
        property var framesTex: framesImg
        property var glyphTex: glyphsImg
      }
    }
  }
}
