# Licensing and release checks

## License boundaries

| Code | License |
| --- | --- |
| Original desktop application, unless explicitly marked otherwise | PolyForm Noncommercial 1.0.0 |
| src/model.ts | PolyForm Noncommercial 1.0.0 OR MIT |
| extensions/gnome/extension.js, drawing.js, build-model.mjs | GPL-2.0-or-later |
| tests/gnome.test.mjs | GPL-2.0-or-later |
| Third-party dependencies and artwork | Original upstream licenses |

The model's MIT alternative is intentionally available for commercial use.
It allows the model to be included in the GPL extension without imposing
PolyForm restrictions on that extension. The desktop host is a separate process
communicating with the GNOME extension over D-Bus; it does not embed GNOME Shell
code. This documents the intended separation, rather than providing a legal
determination about every possible future integration.

GNOME license requirements:
https://gjs.guide/extensions/review-guidelines/review-guidelines.html#licensing

MPL distribution obligations:
https://www.mozilla.org/en-US/MPL/2.0/FAQ/

## Automated dependency checks

    npm run licenses:check
    npm run licenses:check -- --all-targets
    npm run licenses:check -- --target x86_64-pc-windows-msvc

These inspect the locked Cargo graph and every npm lockfile entry, including
optional platform variants and build tools. The policy rejects missing,
unknown and incompatible licenses. OR expressions may select an allowed
alternative; AND expressions require every license to be allowed.

MPL is accepted only for named reviewed packages. `option-ext` 0.2.0 is an
unmodified MPL-2.0 dependency of Tauri 2 via `dirs-sys`; its manifest and full
license text were checked and its exact sources are included with the other MPL
components. Their exact sources are
included in the application resources. @resvg/resvg-js is reviewed as a build
tool; it is not included in the frontend bundle.

licenses/third-party/index.json records version-specific fallbacks for crates
that omit standalone license files. Where an original license was obtainable,
the text and source URL are preserved. Some upstream releases only declare
their license in Cargo.toml: those entries explicitly identify standard license
texts and retain manifest authors and available source copyright lines.
No missing license is silently skipped. Do not add an exception without checking
the upstream declaration, attributions and actual terms.

Dependency selection alone does not establish compliance. Updated fallback
entries and policy changes require review. A library's GPL/LGPL alternative
does not apply if it is legitimately used under its permissive OR alternative.

## Packaged resources

build-notices.mjs uses the actual target and the frontend esbuild inventory.
It generates notice text, a JSON inventory and an archive of exact unmodified
MPL source directories, including Cargo manifests and source license headers.
The default desktop license does not apply to those source copies.

    npm run licenses:verify -- --app src-tauri/target/release/bundle/macos/TeachersPen.app
    npm run licenses:verify -- --gnome dist/gnome/teacherspen@pgilfernandez.github.io.shell-extension.zip
    npm run licenses:verify -- --bundle-dir src-tauri/target/release/bundle

The last command extracts DEB/AppImage/NSIS installers on their native build
platform. It checks the installed inventory, notices and MPL source archive and
records embedded .so/.dylib/.dll files with SHA-256 hashes. Extraction uses
dpkg-deb on Linux, the built AppImage's extraction mode and 7-Zip for NSIS.

The GNOME ZIP includes its GPL text, MIT attribution, preferred JavaScript
source, original model.ts and independent rebuilding instructions. Rebuild
model.js using the included build-model.mjs; no PolyForm-only desktop sources
are needed.

## Native runtime libraries: release review remains necessary

GTK, GLib, WebKitGTK and related native libraries can carry LGPL or other
licenses independently of their MIT-licensed Rust bindings. The Windows
WebView2 runtime and Microsoft runtime have their own redistribution terms.

For each final installer:
1. Review the native library inventory and identify its exact upstream/distribution
   versions, licenses, notices and any vendor patches.
2. Preserve required notices. For redistributed LGPL libraries, provide the
   corresponding source by an applicable license-compliant method and preserve
   users' rights to modify/replace those libraries.
3. Preserve a suitable shared-library replacement/relinking mechanism and do not
   prohibit reverse engineering needed to debug modifications to LGPL libraries.
   Static linking has additional requirements.
4. Re-test the extracted application and retain the review report with the release.

An AppImage may embed libraries absent from the DEB, and installers may download
runtimes. Do not infer the contents of one from another.

CI verifies packaged notices/sources and uploads inventories for all three
desktop platforms. It does NOT certify native LGPL/vendor compliance or replace
the review of the exact installer. Windows/Linux package checks can only be
confirmed after the corresponding CI jobs have run. macOS verification does
not establish Windows/Linux binary compliance.

No release has been published or uploaded as part of this licensing change.
