# TeachersPen

TeachersPen is a desktop app for annotating other applications while the content underneath continues to update in real time. Draw over presentations, websites, videos, and other desktop content without taking a screenshot first.

**Version 1.0** · Initial development and testing platform: macOS Monterey 12.7.6 on Intel.

![TeachersPen annotations over the Blender website, showing freehand marks, an arrow, a rectangle, and a circle](docs/images/example_blender.png)


## Toolbar

![TeachersPen horizontal toolbar with drawing tools, colors, stroke settings, and window controls](docs/images/bar.png)

The horizontal toolbar is **40 px high**. It has a six-dot drag handle (2 × 3), drawing tools, background buttons, timer, colors, stroke width, opacity, and drawing actions. Clear drawings is immediately after Hide/show drawings. Preferences, Collapse, Rotate, and Quit are grouped at the end. Controls have descriptive tooltips and show their shortcuts where applicable.

Drag the six-dot handle to move the toolbar, including to the top edge of the screen and into the macOS menu-bar area. Resizing or rotating the toolbar preserves its position.

**Rotate toolbar**, next to Collapse, switches between horizontal and vertical layouts. The vertical toolbar is **40 px wide**, with **36 px numeric fields** and no visible unit labels. The horizontal stroke-width and opacity fields are 47.6 px wide. Orientation is saved automatically. The vertical layout fits the available monitor height and supports scrolling when necessary.

In **Preferences → Drawing toolbar**, select a mode. Changes are applied and saved immediately:

- **Visible:** keeps the full toolbar on screen.
- **Minimal:** shows the editable TeachersPen SVG launcher at 42 px in diameter. Its alpha is **0.15** at rest and **0.4** on hover. Drag to move it; click to reveal the full toolbar from the launcher. The 240 ms opening animation follows the available space: right/left in horizontal layout and down/up in vertical layout. Reduced-motion preferences are respected. Collapse returns to the launcher. Its position is remembered between sessions and adjusted when a monitor is disconnected.
- **Hidden:** leaves only the macOS menu-bar icon or Windows/Linux system-tray icon. On macOS, the app also disappears from the Dock and app switcher. Shortcuts continue to work without the toolbar or launcher. Drawing hints follow their independent preference. Annotations and the stroke cursor preview remain available.

Collapsing a visible toolbar switches to Minimal mode. If you temporarily open the toolbar in Hidden mode, the collapse control hides it again.

The tray menu provides **Show full toolbar**, **Preferences**, and **Quit TeachersPen**. Launching TeachersPen again also recovers the toolbar. On Linux, tray placement and availability depend on the desktop environment.

## Drawing

Available tools are freehand pencil, line, arrow, rectangle, and circle. To draw a circle, drag from its center to define the radius.

Click a tool or color to enter drawing mode. Click the same selection again to exit; selecting another tool keeps drawing active. These toolbar controls work independently of the keyboard activation mode.

When drawing is ready, the pointer previews a circle with the current stroke diameter, color, and opacity. This preview is not part of the drawing or its undo history. It disappears while drawing a stroke and returns afterward.

Stroke opacity ranges from **100% opaque** to **0% invisible**. Changes are saved automatically and apply to new strokes. Each stroke retains its own opacity when undone or redone.

On macOS, the drawing canvas is a nonactivating panel: activating a drawing shortcut and drawing on the canvas preserve the focused application underneath. Escape is registered globally only while drawing, so it can exit without focusing the overlay. Preferences and other editable windows can still receive focus when used.

Annotations remain visible when you leave drawing mode, and clicks pass through to the applications underneath. Drawings stay fixed in screen coordinates and are held in memory only.

### Keyboard activation

In **Preferences → Activation**, choose:

- **Press to toggle:** press a shortcut to enter or leave drawing mode. This is the default.
- **Hold shortcut:** hold the shortcut while drawing. Releasing the main key or any modifier returns control to the desktop while preserving the annotations.

The activation setting is applied and saved immediately. Hold mode works with the activation, tool, color, and whiteboard/blackboard shortcuts. Esc interrupts drawing even if a shortcut is still held; release and press the shortcut again to reactivate it.

Key release is checked by a small native helper every 8 ms, only while a drawing shortcut is held. Four consecutive released samples (about 32 ms) confirm release, filtering transient key-up readings. On macOS, the helper prefers physical HID key state, with a session-input fallback selected before activation. There is no maximum hold duration; the two-second watchdog applies only to helper startup. It uses Core Graphics on macOS, `GetAsyncKeyState` on Windows, and X11 on Linux. It does not install a permanent keyboard monitor or record what you type. The macOS helper is built for Intel and Apple Silicon with a minimum deployment target of macOS 11.

### Default shortcuts

On macOS, **Ctrl means Control, not Command**.

| Shortcut | Action |
| --- | --- |
| `Ctrl+Shift+Space` | Enter or exit drawing mode |
| `Esc` | Exit drawing; on macOS it works globally while drawing is active |
| `Ctrl+Shift+A` | Freehand pencil |
| `Ctrl+Shift+Q` | Line |
| `Ctrl+Shift+W` | Arrow |
| `Ctrl+Shift+S` | Rectangle |
| `Ctrl+Shift+O` | Circle |
| `Ctrl+Shift+E/D/C/R/F` | Select one of the five colors and activate drawing |
| `Ctrl+Shift+L` | Cycle to the next preset color, wrapping after the fifth |
| `Ctrl+Shift+Z/Y` | Undo/redo on the active monitor |
| `Ctrl+Shift+X` | Clear drawings on all monitors; undo is available per monitor |
| `Ctrl+Shift+H` | Hide or show drawings |
| `Ctrl+Shift+V/B` | Toggle whiteboard/blackboard and transparent background |
| `Ctrl+Shift+T` | Show or hide the timer |

### Whiteboard and blackboard

The white and black background buttons are **20 × 20 px**. Their opaque backgrounds remain active until toggled off.

Opening a whiteboard or blackboard after hiding drawings starts with a clean canvas: hidden annotations are cleared and can be recovered explicitly with Undo. Switching between white and black preserves the drawings currently visible.

## Timer

The timer has its own floating window. The six-dot handle on the left moves it, and the double-ended arrow on the right resizes the clock proportionally. Both controls are inside the timer panel. Position and size are saved in `timer-window.json` in the application's data directory.

Above the clock is an editable caption, initially **“we continue in”** in English. The gear icon, with alpha **0.4**, opens a small configuration popup for the caption, duration in seconds, and caption/number color. These settings are saved automatically.

Three icon-only controls below the clock provide:

- **Reset:** stop and return to the initial value.
- **Change direction:** switch between countdown and counting up from zero, resetting the clock.
- **Start/pause:** start, pause, or resume the clock.

These buttons and the move/resize controls have alpha **0.5** at rest and **0.65** on hover. Tooltips identify each action. The default countdown duration is five minutes. A completed countdown stays visible at zero.

## Preferences and languages

<img src="docs/images/preferences.png" alt="TeachersPen preferences showing language, drawing settings, colors, and keyboard shortcuts" width="430" />

*Preferences shown with customized shortcuts.*

The first row in Preferences selects **English (default), Español, Italiano, Français, or Deutsch**. Language changes are applied and saved immediately across the interface, tooltips, and menus. Custom timer captions are preserved; the default caption follows the selected language. Editable translation catalogs are in `src/locales/`.

The compact preferences panel is 430 px wide and organized into **Drawing**, **Colors**, and **Functions**. The Stroke row combines width and opacity, and each color shares a row with its shortcut. The last row of Colors configures the Next color shortcut, which cycles through all five presets without changing the drawing tool. Timer duration is configured in the timer popup.

All preference changes are applied and saved automatically, including stroke settings, colors, shortcuts, activation, toolbar mode, language, and Drawing hints. There is no Save button or saved-status line. Invalid or occupied shortcuts leave the previous assignment in place and show an error. Restore defaults applies and saves the defaults immediately, preserving the selected language. Drawing hints are enabled by default and show the selected tool and how to return to interaction mode; they can be enabled or disabled independently of the Visible, Minimal, or Hidden toolbar mode.

The information button is on the left of the footer, with Restore defaults aligned to the right. Its popup shows the app icon, **TeachersPen v1.0**, the short build commit, and:

> developed with love by Pablo Gil Fernández

It also includes adjacent donation buttons for [GitHub Sponsors](https://github.com/sponsors/pgilfernandez) and [PayPal](https://www.paypal.com/donate?hosted_button_id=6N7UZHDQW3J6A), plus the [GitHub project](https://github.com/pgilfernandez/teachersPen), opened in the default browser.

## Lightweight desktop host

The default build uses **Tauri 1.8.3** and the operating system's WebView, instead of shipping Electron, Chromium, and Node.js with each app. The React interface, editable SVG assets, Canvas 2D drawing, and native key-release helper are shared with the Electron fallback. Preferences and saved window geometry use the same `TeachersPen` data directory as before.

The migration needs manual device checks before replacing an existing installation. A successful package build does not verify drawing, transparency, global shortcuts, full-screen behavior, or multiple monitors.

## Compatibility

| Platform | Target baseline | Validation status |
| --- | --- | --- |
| macOS | Big Sur 11+, Intel x64 and Apple Silicon arm64; system WKWebView | Lightweight Intel package builds on Monterey; runtime checks, Big Sur and arm64 checks pending |
| Windows | Windows 10+, x64, Microsoft WebView2 | Installer downloads WebView2 if missing; device testing pending |
| Linux | x64, X11, GTK 3 and WebKitGTK **4.0**; packages built on Ubuntu 20.04 | Runtime and distribution compatibility pending |
| Linux Wayland | X11 backend through XWayland | Experimental; overlays over native Wayland applications are not guaranteed |

Tauri 1 is pinned to retain the older WebKitGTK 4.0 baseline. Linux distributions that provide only WebKitGTK 4.1 need a compatible 4.0 package or a different desktop build; 4.1 is not a drop-in runtime replacement. The macOS deployment target and bundle minimum are both **11.0**. The frontend targets Safari 14 and includes compatibility handling for the original Big Sur WebView.

The WebView is supplied and updated by the operating system (WebView2 on Windows). A small installer does not remove the disk space used by that shared runtime. The Windows installer can require an internet connection to install WebView2. Linux may need system WebKit/GTK dependencies installed; an AppImage does not guarantee portability across all distributions.

Windows 7/8/8.1 are outside the target baseline. Older hardware, graphics drivers, full-screen applications, and multiple monitors still require checks on the actual devices. Drawing uses Canvas 2D and on-demand rendering, without WebGPU or continuous animation.

The Electron fallback remains pinned to **37.10.3**, the last Electron major supporting Big Sur. That runtime is outside upstream support and is retained as a migration fallback. Upgrading either desktop host requires reviewing the compatibility baseline. The app loads local content and allows only the three configured project/donation links to open externally.

## Run from source

Use **Node.js 22.12+**, **Rust 1.91.1** (the CI version), and the native prerequisites in the [Tauri 1 setup guide](https://v1.tauri.app/v1/guides/getting-started/prerequisites/):

- **macOS:** Xcode Command Line Tools.
- **Windows:** Visual Studio C++ x64 Build Tools, Windows SDK, and WebView2. Run the build from the x64 Native Tools command prompt.
- **Linux:** a C compiler, `pkg-config`, X11 development headers, GTK 3, WebKitGTK 4.0, OpenSSL, AppIndicator/Ayatana, and SVG development libraries. The workflow contains the Ubuntu 20.04 dependency list.

```sh
npm ci
npm start
```

`npm start` builds a release app and opens it normally; it does not run tests. On macOS it opens `src-tauri/target/release/bundle/macos/TeachersPen.app`. The packaged app includes its native helper and does not need Node.js, Rust, or a compiler on the destination computer.

To run the Electron fallback:

```sh
npm run start:electron
```

Its optional `--software-rendering` argument disables Electron hardware acceleration. This option is specific to the fallback host.

## Build and package

```sh
npm run build       # Frontend, icons, helper, and third-party notices
npm run pack        # Release application
npm run dist:mac    # DMG
npm run dist:win    # NSIS installer
npm run dist:linux  # AppImage and DEB
```

Build each platform on its own operating system. For an explicit macOS architecture, append `-- --target x86_64-apple-darwin` or `-- --target aarch64-apple-darwin`. Install the corresponding Rust target when cross-compiling. Each job builds and uploads only its own architecture's installer.

Packages are written under `src-tauri/target/release/bundle/`, or `src-tauri/target/<target>/release/bundle/` when an explicit target is selected. The macOS installer command also keeps the `.app` for local use. Local macOS builds are unsigned and not notarized.

Electron packaging remains available through `npm run pack:electron` and `npm run dist:electron:mac`, `dist:electron:win`, or `dist:electron:linux`; those packages go to `release/`.

### GitHub Actions

The **Build desktop apps** workflow runs on pushes to `main`, `v*` tags, pull requests, and manual dispatch. It builds Intel/Apple Silicon DMGs, a Windows x64 NSIS installer, and Linux x64 AppImage/DEB packages. Artifacts are retained for 14 days. The workflow compiles and packages; it does not run tests, sign packages, or publish releases.

The Linux job uses Ubuntu 20.04 to avoid raising glibc and WebKitGTK requirements to those of a newer runner. Rust dependencies are locked in `src-tauri/Cargo.lock`, and build output is cached per platform and architecture.

The version comes from `package.json` (currently `1.0.0`, displayed as `1.0`). The build embeds the current short Git commit; source archives without Git metadata display `unknown`.

## License

TeachersPen's original code is licensed under the **[PolyForm Noncommercial License 1.0.0](LICENSE.md)**. Copyright 2026 Pablo Gil Fernández. See [NOTICE.md](NOTICE.md) for the required attribution notice and third-party licensing information.

The license permits use, modification, and redistribution for permitted noncommercial purposes. Copies and modified distributions must retain the license terms or their URL and the required notice. Commercial use, including commercializing or selling the app or modified versions, is not granted by this license and requires separate permission from the copyright holder. The license also explicitly permits use by educational institutions and the other organizations listed in its terms, regardless of funding.

This is source-available software with a noncommercial restriction, rather than unrestricted open-source software. Third-party dependencies and Lucide artwork retain their own licenses. This summary does not replace the full license text.