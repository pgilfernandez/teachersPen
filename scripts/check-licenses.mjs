import {buildTarget, cargoMetadata, cargoPackages, npmPackages, validateLicenses} from './licensing.mjs';
const all = process.argv.includes('--all-targets');
const at = process.argv.indexOf('--target');
const target = all ? undefined : at >= 0 ? process.argv[at + 1] : buildTarget();
if (at >= 0 && !target) throw new Error('--target requires a Rust target triple');
const metadata = cargoMetadata(target);
await validateLicenses(metadata);
console.log(`Licenses OK: ${cargoPackages(metadata).length} Cargo packages, ${(await npmPackages()).length} npm packages (${target || 'all targets'}).`);
