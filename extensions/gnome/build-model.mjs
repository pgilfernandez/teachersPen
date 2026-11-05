// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (c) 2026 Pablo Gil Fernández
// Run from this directory after installing esbuild 0.25.5.
import {build} from 'esbuild';
await build({
  entryPoints: ['source/model.ts'], outfile: 'model.js', bundle: true,
  format: 'esm', platform: 'neutral', target: 'firefox115',
  banner: {js: '// SPDX-License-Identifier: MIT\n// Copyright (c) 2026 Pablo Gil Fernández. See LICENSE-MIT.txt.'}
});
