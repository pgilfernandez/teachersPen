# Rebuilding the shared model

The ZIP includes the preferred JavaScript source for the extension and
drawing renderer, and the original TypeScript for the MIT-licensed model.

Use Node.js 20 or later. In an extracted copy of the extension:

    npm install --no-save --package-lock=false esbuild@0.25.5
    node build-model.mjs

Type-only imports in source/model.ts are erased by esbuild; no proprietary
desktop source files are needed to rebuild model.js. The extension's runtime
requires GNOME Shell 46 or 50, GJS and the system GI modules named in extension.js.
These are platform prerequisites, not embedded copies.

The original repository and history are available at:
https://github.com/pgilfernandez/teachersPen

This extension and its GPL terms permit commercial use. The separate desktop
application remains under PolyForm Noncommercial.
