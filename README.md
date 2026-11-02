# TeachersPen

TeachersPen lets you draw and write over your desktop while the applications underneath keep running. Highlight part of a presentation, point out details on a website, or explain something over a video without taking a screenshot first.

Designed for teachers and educators, it is also useful for demonstrations, tutorials, and screen sharing.

![TeachersPen annotations over the Blender website, showing freehand marks, an arrow, a rectangle, and a circle](docs/images/example_blender.png)

## What you can do

- **Draw on screen:** use the freehand pencil, lines, arrows, rectangles, and circles.
- **Make your annotations stand out:** choose colors, stroke width, and transparency.
- **Use a whiteboard or blackboard:** switch to a plain background for explanations and exercises.
- **Keep control of your desktop:** leave drawing mode to interact with other apps while your annotations remain visible.
- **Manage your drawings:** undo, redo, hide, show, or clear annotations.
- **Time an activity or a break:** use a floating timer with countdown and count-up modes, plus a customizable caption.

Annotations stay in place on the screen; they do not follow the content when you scroll or move a window. Drawings are temporary and are not saved when you close the app.

## A toolbar that fits your workspace

![TeachersPen horizontal toolbar with drawing tools, colors, stroke settings, and window controls](docs/images/bar.png)

Move the toolbar wherever it suits you and choose a horizontal or vertical layout. Keep it visible, collapse it to a small floating button, or hide it and use keyboard shortcuts. You can reopen it from the menu-bar or system-tray icon.

To get started, select a drawing tool and draw on the screen. Press **Ctrl+Shift+Space** to switch between drawing and interacting with your desktop. On macOS, use the **Control** key for this shortcut.

## Preferences

<img src="docs/images/preferences.png" alt="TeachersPen preferences showing language, drawing settings, colors, and keyboard shortcuts" width="430" />

Customize colors, drawing settings, keyboard shortcuts, and toolbar behavior. Choose whether a shortcut toggles drawing mode or activates it only while you hold the keys. Your preferences are saved automatically.

The interface is available in **English, Spanish, Italian, French, and German**.

## Operating systems

TeachersPen targets the following desktop systems:

| System | Requirements | Installation format |
| --- | --- | --- |
| **macOS** | macOS 11 Big Sur or later; Intel or Apple Silicon | `.dmg` |
| **Windows** | Windows 10 or later; 64-bit Intel/AMD | `.exe` installer |
| **Linux** | 64-bit Intel/AMD; X11 desktop and compatible system libraries | `.AppImage` or `.deb` |

Compatibility testing is still in progress across systems and devices. On Linux, Wayland support is experimental; an X11 session is recommended. Linux packages require WebKitGTK 4.0, which is not available by default on every distribution.

## Installation

Download a package for your system from a successful run of [Build desktop apps on GitHub Actions](https://github.com/pgilfernandez/teachersPen/actions/workflows/build-desktop.yml). Open the run, find **Artifacts**, and download the appropriate ZIP file. A GitHub account is required to download these files; packages are kept for 14 days.

Extract the ZIP, then follow the steps for your system:

- **macOS:** choose `x64` for an Intel Mac or `arm64` for Apple Silicon. Open the `.dmg` and drag TeachersPen into **Applications**. Packages are unsigned and not notarized, so macOS may block the first launch.
- **Windows:** run the `.exe` installer and follow the instructions. Installation may need an internet connection to set up Microsoft WebView2, a component required by the app.
- **Linux:** make the `.AppImage` executable in its file properties and open it, or install the `.deb` on a compatible Debian/Ubuntu system. Additional system libraries may be required.

You do not need development tools to use an installed package.

## License

TeachersPen is available under the **[PolyForm Noncommercial License 1.0.0](LICENSE.md)**.

The license permits use, modification, and sharing for noncommercial purposes. It also explicitly permits use by educational institutions, regardless of their funding. Commercial uses outside the license's permitted purposes require separate permission from the author.

When sharing the app or modified versions, retain the license and required notices. See [LICENSE.md](LICENSE.md) for the full terms and [NOTICE.md](NOTICE.md) for attribution and third-party licenses.

## Support

Report problems or suggest improvements through [GitHub Issues](https://github.com/pgilfernandez/teachersPen/issues). If you would like to support development, you can contribute through [GitHub Sponsors](https://github.com/sponsors/pgilfernandez) or [PayPal](https://www.paypal.com/donate?hosted_button_id=6N7UZHDQW3J6A).
