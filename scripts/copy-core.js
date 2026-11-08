'use strict';

// Copies Alo's core from the sibling `alo` repo into `alo-core/`, so the extension still works
// in projects that have no `node_modules/@msilabs/alo`. Run it after Alo's core changes:
//   node scripts/copy-core.js

const fs = require('fs');
const path = require('path');

const source = path.resolve(__dirname, '..', '..', 'alo');
const target = path.resolve(__dirname, '..', 'alo-core');

const { name, version } = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(path.join(target, 'core'), { recursive: true });
fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({ name, version }, null, 4) + '\n');
fs.copyFileSync(path.join(source, 'LICENSE'), path.join(target, 'LICENSE'));

const files = fs.readdirSync(path.join(source, 'core')).filter((file) => file.endsWith('.js'));
for (const file of files) {
    fs.copyFileSync(path.join(source, 'core', file), path.join(target, 'core', file));
}

console.log(`Copied ${files.length} core files from ${name}@${version}`);
