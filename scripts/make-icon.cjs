const fs = require('node:fs');
const path = require('node:path');
const { Resvg } = require('@resvg/resvg-js');
const folder = path.join(__dirname, '../assets');
// The approved generated bitmap is the single source for UI and packaged icons.
// SVG is only a raster resampling container; it does not draw the brand mark.
const source = fs.readFileSync(path.join(__dirname, '../public/brand-mark.png'));
const width = source.readUInt32BE(16);
const height = source.readUInt32BE(20);
const image = `data:image/png;base64,${source.toString('base64')}`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><image width="${width}" height="${height}" href="${image}"/></svg>`;
const render = (size) => new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
fs.writeFileSync(path.join(folder, 'icon.png'), render(512));

// Supply native Windows sizes instead of relying on one downscaled 256px frame.
const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const frames = sizes.map((size) => ({ size, png: render(size) }));
const header = Buffer.alloc(6 + frames.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(frames.length, 4);
let imageOffset = header.length;
frames.forEach(({ size, png }, index) => {
  const entry = 6 + index * 16;
  header.writeUInt8(size === 256 ? 0 : size, entry);
  header.writeUInt8(size === 256 ? 0 : size, entry + 1);
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(png.length, entry + 8);
  header.writeUInt32LE(imageOffset, entry + 12);
  imageOffset += png.length;
});
fs.writeFileSync(
  path.join(folder, 'icon.ico'),
  Buffer.concat([header, ...frames.map(({ png }) => png)]),
);
