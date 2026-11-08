'use strict';

const crypto = require('node:crypto');
const { parseCss, serializeCss, splitTopLevel, skipString } = require('./css-parser.js');

// data-a-<first 6 hex chars of the SHA-1 of the project-relative path>
function scopeAttribute(file) {
    return 'data-a-' + crypto.createHash('sha1').update(file).digest('hex').slice(0, 6);
}

// Start of the last compound selector: after the last top-level combinator (space, >, +, ~).
function lastCompoundStart(selector) {
    let depth = 0;
    let start = 0;
    let i = 0;
    while (i < selector.length) {
        const ch = selector[i];
        if (ch === '"' || ch === "'") {
            i = skipString(selector, i);
            continue;
        }
        if (ch === '\\') {
            i += 2;
            continue;
        }
        if (ch === '(' || ch === '[') depth++;
        else if (ch === ')' || ch === ']') depth--;
        else if (depth === 0 && /[\s>+~]/.test(ch)) {
            while (i < selector.length && /[\s>+~]/.test(selector[i])) i++;
            start = i;
            continue;
        }
        i++;
    }
    return start;
}

// Where the attribute goes inside a compound: before its first top-level pseudo-class or pseudo-element.
function insertionPoint(compound) {
    let depth = 0;
    for (let i = 0; i < compound.length; i++) {
        const ch = compound[i];
        if (ch === '"' || ch === "'") {
            i = skipString(compound, i) - 1;
        } else if (ch === '\\') {
            i++;
        } else if (ch === '(' || ch === '[') {
            depth++;
        } else if (ch === ')' || ch === ']') {
            depth--;
        } else if (depth === 0 && ch === ':') {
            return i;
        }
    }
    return compound.length;
}

// `.card h2` → `.card h2[data-a-x]`, `.btn:hover` → `.btn[data-a-x]:hover`, `a, b` → both.
function scopeSelector(selectorList, attribute) {
    return splitTopLevel(selectorList, ',')
        .map((selector) => {
            const trimmed = selector.trim();
            const start = lastCompoundStart(trimmed);
            const compound = trimmed.slice(start);
            const at = insertionPoint(compound);
            return trimmed.slice(0, start) + compound.slice(0, at) + `[${attribute}]` + compound.slice(at);
        })
        .join(', ');
}

function scopeItems(items, attribute) {
    return items.map((item) => {
        if (item.type === 'rule') return { ...item, selector: scopeSelector(item.selector, attribute) };
        if (item.type === 'at' && item.children) return { ...item, children: scopeItems(item.children, attribute) };
        return item;
    });
}

// Rewrites every selector so it only matches elements carrying `attribute`.
// @keyframes, @font-face, @import and @charset stay as they are.
function scopeCss(css, attribute, where) {
    return serializeCss(scopeItems(parseCss(css, where), attribute));
}

module.exports = { scopeAttribute, scopeSelector, scopeCss };
