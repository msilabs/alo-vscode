'use strict';

// Copies Alo's core, CLI and bin from the sibling `alo` repo into `alo-core/`, so the extension
// still works (and can run `alo dev`, `alo build`, `alo new`) in projects that have no
// `node_modules/@msilabs/alo`. Run it after Alo changes:
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

let copied = 0;
for (const folder of ['core', 'cli', 'bin']) {
    fs.mkdirSync(path.join(target, folder), { recursive: true });
    for (const file of fs.readdirSync(path.join(source, folder)).filter((f) => f.endsWith('.js'))) {
        fs.copyFileSync(path.join(source, folder, file), path.join(target, folder, file));
        copied++;
    }
}

console.log(`Copied ${copied} files (core, cli, bin) from ${name}@${version}`);
