'use strict';

const vm = require('node:vm');
const { AloError } = require('./errors.js');
const { scopeCss } = require('./css-scope.js');

function byPath(a, b) {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
}

// Lists global/*.css and global/*.js (subfolders too), each sorted by full project-relative path.
function scanGlobal(reader, warn) {
    const css = [];
    const js = [];
    if (!reader.exists('global')) return { css, js };

    function walk(dir) {
        for (const entry of reader.list(dir)) {
            if (entry.name.startsWith('.')) continue;
            const file = `${dir}/${entry.name}`;
            if (entry.isDirectory) walk(file);
            else if (entry.name.endsWith('.css')) css.push(file);
            else if (entry.name.endsWith('.js')) js.push(file);
            else warn({ file, message: 'Only `.css` and `.js` files are used in `global/`; this file was ignored.', hint: 'Put JSON data in `data/`, and images or fonts in `public/`.' });
        }
    }

    walk('global');
    return { css: css.sort(byPath), js: js.sort(byPath) };
}

function blockText(block) {
    return block ? block.children.map((node) => node.value).join('') : '';
}

// global/ CSS first, then the CSS of every used .alo file (each once), each part marked with its source.
function buildStyle({ reader, globals, sfcs }) {
    const parts = [];
    for (const file of globals) {
        const css = reader.read(file).trim();
        if (css) parts.push(`/* ${file} */\n${css}`);
    }

    for (const sfc of [...sfcs].sort((a, b) => byPath(a.file, b.file))) {
        const scoped = blockText(sfc.style);
        const global = blockText(sfc.styleGlobal).trim();
        if (scoped.trim()) {
            // Untrimmed, so CSS errors keep the right line numbers.
            const where = { file: sfc.file, line: sfc.style.children[0].line, source: sfc.source };
            parts.push(`/* ${sfc.file} */\n${scopeCss(scoped, sfc.scopeAttr, where).trim()}`);
        }
        if (global) parts.push(`/* ${sfc.file} (global) */\n${global}`);
    }

    return parts.length > 0 ? parts.join('\n\n') + '\n' : '';
}

// Catches JavaScript syntax errors at build time, with the real file and line.
// `wrap` puts the code inside a function the same way the output does, so `return` stays valid.
function checkSyntax(code, file, line, source, wrap) {
    const text = wrap ? `(function ($el) {\n${code}\n})` : code;
    try {
        new vm.Script(text, { filename: file, lineOffset: line - (wrap ? 2 : 1) });
    } catch (err) {
        if (!(err instanceof SyntaxError)) throw err;
        const at = new RegExp(`^${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:(\\d+)`).exec(String(err.stack));
        throw new AloError({
            file,
            line: at ? Number(at[1]) : line,
            source,
            message: `JavaScript syntax error: ${err.message}`,
            hint: 'Check brackets, quotes and commas. This script runs in the browser as plain JavaScript; `import` is not supported.',
        });
    }
}

function scriptOf(sfc) {
    const code = blockText(sfc.script);
    if (!code.trim()) return null;
    checkSyntax(code, sfc.file, sfc.script.children[0].line, sfc.source, true);
    return code.replace(/^\s*\n/, '').trimEnd();
}

// global/*.js joined in path order, without a wrapper, so they can define global functions.
function buildGlobalScript(reader, files) {
    const parts = [];
    for (const file of files) {
        const source = reader.read(file);
        if (!source.trim()) continue;
        checkSyntax(source, file, 1, source, false);
        parts.push(`/* ${file} */\n${source.trim()}`);
    }
    return parts.length > 0 ? parts.join('\n;\n') + '\n' : '';
}

// One file for the whole site: every used component script, keyed by its Dot name.
// Each element with data-a-c runs the scripts named there, with the element as `$el`;
// one failing component does not stop the others.
function buildComponentScript(components) {
    const entries = components
        .map(({ name, sfc }) => ({ name, sfc, code: scriptOf(sfc) }))
        .filter((entry) => entry.code !== null)
        .sort((x, y) => byPath(x.name, y.name));
    if (entries.length === 0) return '';

    const registry = entries
        .map(({ name, sfc, code }) => `    ${JSON.stringify(name)}: function ($el) {\n/* ${sfc.file} */\n${code}\n    },`)
        .join('\n');
    return [
        '(() => {',
        'const components = {',
        registry,
        '};',
        "document.querySelectorAll('[data-a-c]').forEach((el) => {",
        "    el.getAttribute('data-a-c').split(' ').forEach((name) => {",
        '        const run = components[name];',
        '        if (!run) return;',
        '        try {',
        '            run(el);',
        '        } catch (error) {',
        "            console.error('[alo] ' + name + ':', error);",
        '        }',
        '    });',
        '});',
        '})();',
        '',
    ].join('\n');
}

// Layout scripts first (root layout outermost), then the page; each in its own scope.
function buildPageScript(sfcs) {
    const parts = [];
    for (const sfc of sfcs) {
        const code = scriptOf(sfc);
        if (code !== null) parts.push(`/* ${sfc.file} */\n(() => {\n${code}\n})();`);
    }
    return parts.length > 0 ? parts.join('\n\n') + '\n' : '';
}

module.exports = { scanGlobal, buildStyle, blockText, buildGlobalScript, buildComponentScript, buildPageScript, scriptOf };
