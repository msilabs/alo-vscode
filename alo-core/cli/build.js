'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { compile } = require('../core/compile.js');
const log = require('./log.js');

function createFsReader(root) {
    const resolve = (relative) => path.join(root, ...relative.split('/'));
    return {
        exists(relative) {
            return fs.existsSync(resolve(relative));
        },
        read(relative) {
            return fs.readFileSync(resolve(relative), 'utf8');
        },
        list(relative) {
            return fs
                .readdirSync(resolve(relative), { withFileTypes: true })
                .map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }));
        },
    };
}

// Writes generated files and copies public/ files byte for byte into `dir`.
function writeOutput(root, dir, { files, copies }) {
    for (const file of files) {
        const target = path.join(dir, ...file.path.split('/'));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, file.contents);
    }
    for (const copy of copies) {
        const target = path.join(dir, ...copy.to.split('/'));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(path.join(root, ...copy.from.split('/')), target);
    }
}

function compileProject(root, mode, base, { reader = createFsReader(root), cache = null } = {}) {
    try {
        return compile({ reader, mode, base, cache });
    } catch (err) {
        for (const warning of err.warnings ?? []) log.warn(warning);
        throw err;
    }
}

// 1 page, 8 pages
function count(n, word) {
    return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function summary(result, ms) {
    const pages = result.files.filter((file) => file.path.endsWith('.html')).length;
    const assets = result.files.filter((file) => file.path.startsWith('assets/')).length;
    const parts = [count(pages, 'page'), count(assets, 'asset')];
    if (result.copies.length > 0) parts.push(`${count(result.copies.length, 'file')} from public/`);
    return `Built ${parts.join(', ')} in ${ms}ms → dist/`;
}

// Builds into .alo/build first and only then replaces dist/, so a failed build leaves the old dist/ intact.
async function build({ root, base }) {
    const started = performance.now();
    const result = compileProject(root, 'build', base);
    for (const warning of result.warnings) log.warn(warning);

    const temp = path.join(root, '.alo', 'build');
    const dist = path.join(root, 'dist');
    fs.rmSync(temp, { recursive: true, force: true });
    try {
        writeOutput(root, temp, result);
        fs.rmSync(dist, { recursive: true, force: true });
        fs.renameSync(temp, dist);
    } catch (err) {
        fs.rmSync(temp, { recursive: true, force: true });
        throw err;
    }

    log.success(summary(result, Math.round(performance.now() - started)));
    if (result.unused.length > 0) log.dim(`  Unused components: ${result.unused.map((name) => `<${name}>`).join(', ')}`);
    if (result.warnings.length > 0) log.dim(`  ${count(result.warnings.length, 'warning')}, see above.`);
}

module.exports = { build, createFsReader, compileProject, writeOutput, count };
