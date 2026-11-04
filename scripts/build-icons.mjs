import { mkdir, writeFile, readFile, cp } from 'node:fs/promises';
import { Resvg } from '@resvg/resvg-js';

const folder = 'dist/icons';
await mkdir(folder, { recursive: true });
const sourceFolder = 'src/renderer/assets/icons';
// Never regenerate source SVGs: edits in a vector editor survive every build.
await cp(sourceFolder, folder, { recursive: true });
const png = (source, size) => new Resvg(source, { fitTo: { mode: 'width', value: size } }).render().asPng();
const appSvg = await readFile(`${sourceFolder}/app.svg`, 'utf8');
const sizes = [16, 32, 48, 64, 128, 256, 512, 1024];
const images = new Map(sizes.map(size => [size, png(appSvg, size)]));
for (const [size, data] of images) await writeFile(`${folder}/app-${size}.png`, data);
for (const [name, file] of [['trayTemplate', 'tray-template'], ['tray', 'tray']]) {
  const source = await readFile(`${sourceFolder}/${file}.svg`, 'utf8');
  await writeFile(`${folder}/${name}.png`, png(source, 16));
  await writeFile(`${folder}/${name}@2x.png`, png(source, 32));
  // Tao displays macOS status icons at 18 points. Keep enough pixels for 3x
  // screens instead of upscaling the 16 px image on Retina displays.
  await writeFile(`${folder}/${name}@3x.png`, png(source, 54));
}
// Linux panels do not recolor macOS template images. Derive a white variant
// from the same editable artwork while preserving its transparent background.
const trayLight = (await readFile(`${sourceFolder}/tray-template.svg`, 'utf8')).replace(/fill:#000000/g, 'fill:#ffffff');
await writeFile(`${folder}/trayLight.png`, png(trayLight, 16));
await writeFile(`${folder}/trayLight@2x.png`, png(trayLight, 32));
// PNG-backed ICNS entries work on Big Sur and later; no platform image tool is needed.
const icnsParts = [[16, 'icp4'], [32, 'icp5'], [64, 'icp6'], [128, 'ic07'], [256, 'ic08'], [512, 'ic09'], [1024, 'ic10'], [32, 'ic11'], [64, 'ic12'], [256, 'ic13'], [512, 'ic14']].map(([size, type]) => {
  const data = images.get(size);
  const header = Buffer.alloc(8);
  header.write(type, 0, 'ascii'); header.writeUInt32BE(data.length + 8, 4);
  return Buffer.concat([header, data]);
});
const icnsHeader = Buffer.alloc(8);
icnsHeader.write('icns', 0, 'ascii');
icnsHeader.writeUInt32BE(8 + icnsParts.reduce((length, part) => length + part.length, 0), 4);
await writeFile(`${folder}/app.icns`, Buffer.concat([icnsHeader, ...icnsParts]));
const icoSizes = [16, 32, 48, 256];
const icoHeader = Buffer.alloc(6 + icoSizes.length * 16);
icoHeader.writeUInt16LE(1, 2); icoHeader.writeUInt16LE(icoSizes.length, 4);
let offset = icoHeader.length;
for (const [index, size] of icoSizes.entries()) {
  const data = images.get(size); const entry = 6 + index * 16;
  icoHeader[entry] = size === 256 ? 0 : size; icoHeader[entry + 1] = size === 256 ? 0 : size;
  icoHeader.writeUInt16LE(1, entry + 4); icoHeader.writeUInt16LE(32, entry + 6);
  icoHeader.writeUInt32LE(data.length, entry + 8); icoHeader.writeUInt32LE(offset, entry + 12);
  offset += data.length;
}
await writeFile(`${folder}/app.ico`, Buffer.concat([icoHeader, ...icoSizes.map(size => images.get(size))]));
