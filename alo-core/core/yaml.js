'use strict';

const { AloError } = require('./errors.js');

const COMPLEX_HINT = 'Use a `.json` file for complex data.';
const NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;

// Front matter supports only a small part of YAML: `key: value`, scalars, and flat lists.
// lineOffset: how many lines come before the YAML in the file, so errors point at the real line.
function parseYaml(text, { file, lineOffset = 0, source } = {}) {
    const lines = text.split(/\r?\n/);
    const result = {};
    let listKey = null;

    function fail(index, message, hint = COMPLEX_HINT) {
        throw new AloError({ file, line: index + 1 + lineOffset, column: 1, source, message, hint });
    }

    lines.forEach((raw, index) => {
        if (/^ *\t/.test(raw)) fail(index, 'Tabs cannot indent front matter.', 'Use spaces.');
        const line = stripComment(raw, index, fail).trimEnd();
        if (line.trim() === '') return;

        const item = /^(\s*)- (.*)$|^(\s*)-$/.exec(line);
        if (item) {
            if (listKey === null) fail(index, 'List item without a key.', 'Write `tags:` first, then `- value` on the following lines.');
            if (result[listKey] === null) result[listKey] = [];
            result[listKey].push(parseScalar((item[2] ?? '').trim(), index, fail));
            return;
        }

        if (/^\s/.test(line)) fail(index, 'Nested objects are not supported in front matter.');

        const colon = findColon(line);
        if (colon === -1) fail(index, `Cannot parse the line \`${line.trim()}\`.`, 'Each line must be `key: value`.');
        const key = line.slice(0, colon).trim();
        if (key === '') fail(index, 'Missing key before `:`.', 'Each line must be `key: value`.');
        if (Object.hasOwn(result, key)) fail(index, `Duplicate key \`${key}\`.`, 'Keep only one.');

        const value = line.slice(colon + 1).trim();
        // `key:` with nothing after it is null, unless `- item` lines follow.
        if (value === '') {
            result[key] = null;
            listKey = key;
            return;
        }
        listKey = null;
        result[key] = parseValue(value, index, fail);
    });

    return result;
}

// The first `:` followed by a space or the line end, outside quotes.
function findColon(line) {
    let quote = null;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (quote) {
            if (ch === quote) quote = null;
        } else if (ch === '"' || ch === "'") {
            quote = ch;
        } else if (ch === ':' && (i === line.length - 1 || line[i + 1] === ' ')) {
            return i;
        }
    }
    return -1;
}

// `#` starts a comment only outside quotes and after whitespace (or at the line start).
function stripComment(line, index, fail) {
    let quote = null;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (quote) {
            if (ch === '\\' && quote === '"') i++;
            else if (ch === "'" && quote === "'" && line[i + 1] === "'") i++;
            else if (ch === quote) quote = null;
        } else if (ch === '"' || ch === "'") {
            const before = line.slice(0, i).trimEnd();
            if (before === '' || /[:\-[,]$/.test(before)) quote = ch;
        } else if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
            return line.slice(0, i);
        }
    }
    if (quote) fail(index, 'Unclosed quote.', `Add \`${quote}\` at the end of the value.`);
    return line;
}

function parseValue(value, index, fail) {
    if (value === '|' || value === '>' || /^[|>][+-]?\d*$/.test(value)) fail(index, 'Multi-line values with `|` or `>` are not supported in front matter.');
    if (value.startsWith('[')) return parseInlineList(value, index, fail);
    return parseScalar(value, index, fail);
}

function parseInlineList(value, index, fail) {
    if (!value.endsWith(']')) fail(index, 'List `[` is not closed with `]`.', 'For example: `tags: [intro, news]`');
    const inner = value.slice(1, -1).trim();
    if (inner === '') return [];

    const items = [];
    let current = '';
    let quote = null;
    for (let i = 0; i < inner.length; i++) {
        const ch = inner[i];
        if (quote) {
            current += ch;
            if (ch === '\\' && quote === '"') current += inner[++i] ?? '';
            else if (ch === quote) quote = null;
        } else if (ch === '"' || ch === "'") {
            quote = ch;
            current += ch;
        } else if (ch === ',') {
            items.push(current.trim());
            current = '';
        } else if (ch === '[' || ch === '{') {
            fail(index, 'Lists cannot contain lists or objects.');
        } else {
            current += ch;
        }
    }
    items.push(current.trim());
    return items.map((item) => parseScalar(item, index, fail));
}

function parseScalar(value, index, fail) {
    if (value.startsWith('"')) {
        if (value.length < 2 || !value.endsWith('"')) fail(index, 'Unclosed quote.', 'Add `"` at the end of the value.');
        return value.slice(1, -1).replace(/\\(.)/g, (_, ch) => ({ n: '\n', t: '\t', '"': '"', '\\': '\\' })[ch] ?? '\\' + ch);
    }
    if (value.startsWith("'")) {
        if (value.length < 2 || !value.endsWith("'")) fail(index, 'Unclosed quote.', "Add `'` at the end of the value.");
        return value.slice(1, -1).replace(/''/g, "'");
    }
    if (/^[&*!{]/.test(value)) fail(index, `Values starting with \`${value[0]}\` (anchors, tags or objects) are not supported in front matter.`, 'Quote it if it is text, e.g. `"*great*"`. Use a `.json` file for complex data.');
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (value === 'null' || value === '~') return null;
    if (NUMBER.test(value)) return Number(value);
    return value;
}

module.exports = { parseYaml };
