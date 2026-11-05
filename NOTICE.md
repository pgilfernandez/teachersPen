# TeachersPen notices

Required Notice: Copyright 2026 Pablo Gil Fernández (https://github.com/pgilfernandez/teachersPen)

TeachersPen's original desktop code is licensed under PolyForm Noncommercial
1.0.0, except for files with an explicit alternative SPDX license. See LICENSE.md.

## Explicit exceptions

- src/model.ts is available under PolyForm-Noncommercial-1.0.0 OR MIT.
  Recipients may choose MIT; its terms are in licenses/MIT.txt.
- The GNOME Shell extension and its rebuild helper are GPL-2.0-or-later.
  See extensions/gnome/LICENSE.md and extensions/gnome/NOTICE.md.
- tests/gnome.test.mjs, which imports the GPL renderer, is GPL-2.0-or-later.

The GNOME extension and MIT-licensed shared model permit commercial use under
their own terms. PolyForm's noncommercial restriction does not apply to them.

## Third-party components

Third-party code and artwork retain their original licenses. PolyForm does not
replace or restrict rights granted under those licenses, including commercial
use, modification, redistribution and reverse engineering of third-party
libraries where their licenses permit it.

Regardless of the other desktop terms, reverse engineering of the application
is permitted to the extent necessary to debug modifications to LGPL-licensed
libraries used with it.

Desktop distributions include:
- THIRD-PARTY-NOTICES.txt: license texts, original attributions and source URLs.
- THIRD-PARTY-LICENSES.json: exact versions, licenses and source locations.
- THIRD-PARTY-SOURCES.tar.gz: exact unmodified sources and build manifests for
  the MPL-2.0 Rust dependencies, plus the MPL license text.

The MIT alternative for the shared model is reproduced in the third-party
notices. Lucide/Feather artwork retains its ISC/MIT notices, also available in
src/renderer/assets/icons/LICENSE-lucide.txt.

Operating-system WebViews and other system libraries remain under their
respective licenses. Native libraries embedded in Linux or Windows installers
must be reviewed separately; a Cargo/npm audit does not cover them. See
docs/licensing/README.md.
