'use strict';

const fs = require('fs');
const path = require('path');
const { expressionRanges } = require('./embedded');

const LOGIC_VALUE = /<template\b(?:[^>"']|"[^"]*"|'[^']*')*?\s(?:for|if|else-if)\s*=\s*(["'])([^"']*)$/;

// Where the JavaScript around the cursor starts: inside `{{ }}`, `{{{ }}}`, or the value of
// `for`, `if` or `else-if` on a `<template>`. Returns that start offset, or -1.
function expressionStart(text, offset) {
    for (const [start, end] of expressionRanges(text)) {
        const open = text.startsWith('{{{', start) ? 3 : 2;
        // An unclosed `{{` at the very end of the text ends exactly at the cursor.
        if (start + open <= offset && (offset < end || (offset === end && !text.slice(start, end).endsWith('}}')))) {
            return start + open;
        }
    }
    const lineStart = text.lastIndexOf('<template', offset);
    if (lineStart >= 0) {
        const match = LOGIC_VALUE.exec(text.slice(lineStart, offset));
        if (match) return offset - match[2].length;
    }
    return -1;
}

// What is being typed in an expression: `data.site.na|` gives { path: ['data', 'site'], partial: 'na' },
// a bare `da|` gives { path: [], partial: 'da' }. Returns null outside an expression, or after
// something that cannot be followed, like `foo().` or `list[0].`.
function expressionContext(text, offset) {
    const from = expressionStart(text, offset);
    if (from < 0) return null;
    const code = text.slice(from, offset);

    const member = /([A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*)\??\.([\w$]*)$/.exec(code);
    if (member) {
        const before = code[member.index - 1];
        if (before && /[\w$.\])]/.test(before)) return null;
        return { path: member[1].split(/\??\./), partial: member[2], start: offset - member[2].length };
    }

    const word = /([A-Za-z_$][\w$]*)?$/.exec(code);
    const before = code[code.length - (word[1] ?? '').length - 1];
    if (before && /[\w$.\])'"`]/.test(before)) return null;
    return { path: [], partial: word[1] ?? '', start: offset - (word[1] ?? '').length };
}

// The variables of every `<template for>` around the cursor, innermost last:
// `(post, i) in data.blog` gives { name: 'post', index: 'i', source: ['data', 'blog'] }.
// `source` is null when the list is not a plain path, e.g. `Object.entries(x)`.
function loopVariables(text, offset) {
    const open = [];
    const tags = /<(\/?)template\b((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
    for (let match; (match = tags.exec(text)) && match.index < offset; ) {
        if (match[1]) open.pop();
        else if (!/\/\s*$/.test(match[2])) open.push(match[2]);
    }
    const variables = [];
    for (const attributes of open) {
        const value = /\sfor\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(attributes);
        if (!value) continue;
        const loop = /^\s*(?:\(\s*([\w$]+)\s*(?:,\s*([\w$]+))?\s*\)|([\w$]+))\s+in\s+(.+?)\s*$/.exec(value[1] ?? value[2]);
        if (!loop) continue;
        const list = /^([A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*)/.exec(loop[4]);
        variables.push({ name: loop[1] ?? loop[3], index: loop[2] ?? null, source: list ? list[1].split(/\??\./) : null });
    }
    return variables;
}

// The dotted path up to and including the word under the cursor: on `name` in
// `data.site.name.length` it is ['data', 'site', 'name']. Null outside an expression.
function pathAt(text, offset) {
    const from = expressionStart(text, offset);
    if (from < 0) return null;
    let end = offset;
    while (end < text.length && /[\w$]/.test(text[end])) end++;
    const chain = /([A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*)$/.exec(text.slice(from, end));
    if (!chain) return null;
    const start = end - chain[1].length;
    const before = text[start - 1];
    if (before && /[\w$.\])]/.test(before)) return null;
    return { segments: chain[1].split(/\??\./), start, end };
}

// The kind of value, for the line next to a suggestion: "text: Alo", "list of 5", "number: 3".
function describe(value) {
    if (Array.isArray(value)) return `list of ${value.length}`;
    if (value === null) return 'null';
    if (typeof value === 'string') return 'text: ' + (value.length > 40 ? value.slice(0, 40) + '…' : value).replace(/\s+/g, ' ');
    if (typeof value === 'object') return 'object';
    if (value === undefined) return '';
    return `${typeof value}: ${String(value)}`;
}

// One object with every key the items of a list have, so `post.` offers them all.
function mergeItems(list) {
    const merged = {};
    for (const item of list) {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
            for (const key of Object.keys(item)) if (!(key in merged)) merged[key] = item[key];
        }
    }
    return merged;
}

// Where `data.a.b.c` comes from: the file under `data/`, and the line of the key inside it.
// `toKey` is Alo's own `footer-links` → `footerLinks`. Returns { file, line } or null.
function dataLocation(root, segments, toKey) {
    if (segments[0] !== 'data' || segments.length < 2) return null;
    let dir = path.join(root, 'data');
    for (let i = 1; i < segments.length; i++) {
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return null;
        }
        const entry = entries.find((e) => toKey(e.isDirectory() ? e.name : e.name.replace(/\.[^.]+$/, '')) === segments[i]);
        if (!entry) return null;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            dir = full;
            continue;
        }
        return { file: full, line: keyLine(fs.readFileSync(full, 'utf8'), segments.slice(i + 1)) };
    }
    return null;
}

// The 0-based line where the last of `keys` is written, looking for each key after the previous one.
function keyLine(source, keys) {
    let at = 0;
    for (const key of keys) {
        const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const found = new RegExp(`(^|[\\s{,])("${escaped}"\\s*:|${escaped}\\s*:)`, 'm').exec(source.slice(at));
        if (!found) break;
        at += found.index + found[1].length;
    }
    return source.slice(0, at).split('\n').length - 1;
}

module.exports = { expressionStart, expressionContext, loopVariables, pathAt, describe, mergeItems, dataLocation };
