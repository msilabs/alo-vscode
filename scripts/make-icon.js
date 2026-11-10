'use strict';

// Makes icons/alo.png (256×256) for the Marketplace, which does not accept SVG, from icons/alo.svg.
// macOS renders the SVG (qlmanage), but on a white square; this script makes everything outside
// the logo's circle transparent again. Run it on macOS after the logo changes:
//   node scripts/make-icon.js

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const SIZE = 256;
// The logo is a circle of r=15 in a 32×32 viewBox.
const RADIUS = (15 / 16) * (SIZE / 2);
const root = path.resolve(__dirname, '..');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'alo-icon-'));
execFileSync('qlmanage', ['-t', '-s', String(SIZE), '-o', temp, path.join(root, 'icons', 'alo.svg')], { stdio: 'ignore' });
const rendered = fs.readFileSync(path.join(temp, 'alo.svg.png'));

// ---- read the PNG (8-bit RGBA, as qlmanage writes it) into plain pixels

let width = 0;
let height = 0;
const chunks = [];
for (let pos = 8; pos < rendered.length; ) {
    const length = rendered.readUInt32BE(pos);
    const type = rendered.toString('ascii', pos + 4, pos + 8);
    const data = rendered.subarray(pos + 8, pos + 8 + length);
    if (type === 'IHDR') {
        width = data.readUInt32BE(0);
        height = data.readUInt32BE(4);
        if (data[8] !== 8 || data[9] !== 6) throw new Error('Expected an 8-bit RGBA PNG from qlmanage.');
    }
    if (type === 'IDAT') chunks.push(data);
    pos += 12 + length;
}

const raw = zlib.inflateSync(Buffer.concat(chunks));
const stride = width * 4;
const pixels = Buffer.alloc(stride * height);
for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
        const left = x >= 4 ? pixels[y * stride + x - 4] : 0;
        const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
        const upLeft = x >= 4 && y > 0 ? pixels[(y - 1) * stride + x - 4] : 0;
        let value = line[x];
        if (filter === 1) value += left;
        else if (filter === 2) value += up;
        else if (filter === 3) value += Math.floor((left + up) / 2);
        else if (filter === 4) {
            const p = left + up - upLeft;
            const [pa, pb, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - upLeft)];
            value += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        }
        pixels[y * stride + x] = value & 0xff;
    }
}

// ---- outside the circle: transparent; on its edge: partly, with the colour from just inside

const center = (width - 1) / 2;
const out = Buffer.from(pixels);
for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
        const dx = x - center;
        const dy = y - center;
        const distance = Math.hypot(dx, dy);
        const coverage = Math.min(1, Math.max(0, RADIUS + 0.5 - distance));
        const i = (y * width + x) * 4;
        if (coverage === 1) continue;
        if (distance > 0) {
            const inside = (RADIUS - 3) / distance;
            const j = (Math.round(center + dy * inside) * width + Math.round(center + dx * inside)) * 4;
            out[i] = pixels[j];
            out[i + 1] = pixels[j + 1];
            out[i + 2] = pixels[j + 2];
        }
        out[i + 3] = Math.round(255 * coverage);
    }
}

// ---- write the PNG again

function crc32(buffer) {
    let crc = ~0;
    for (const byte of buffer) {
        crc ^= byte;
        for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return ~crc >>> 0;
}
function chunk(type, data) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
}
const header = Buffer.alloc(13);
header.writeUInt32BE(width, 0);
header.writeUInt32BE(height, 4);
header.set([8, 6, 0, 0, 0], 8);
const rows = [];
for (let y = 0; y < height; y++) rows.push(Buffer.from([0]), out.subarray(y * stride, (y + 1) * stride));
const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
]);
fs.writeFileSync(path.join(root, 'icons', 'alo.png'), png);
fs.rmSync(temp, { recursive: true, force: true });
console.log(`Wrote icons/alo.png (${width}×${height}, ${png.length} bytes)`);
