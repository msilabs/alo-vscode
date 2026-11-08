'use strict';

const { AloError } = require('./errors.js');

// At-rules whose block holds normal rules, so scoping goes inside them.
const NESTING_AT_RULES = new Set(['media', 'supports', 'container', 'layer', 'scope', 'starting-style']);

function skipString(css, i) {
    const quote = css[i];
    for (i++; i < css.length; i++) {
        if (css[i] === '\\') i++;
        else if (css[i] === quote || css[i] === '\n') return i + 1;
    }
    return i;
}

function skipComment(css, i) {
    const end = css.indexOf('*/', i + 2);
    return end === -1 ? css.length : end + 2;
}

// Index of the first top-level character in `stops`, skipping strings, comments, ( ) and [ ].
function findTopLevel(css, i, stops) {
    let depth = 0;
    while (i < css.length) {
        const ch = css[i];
        if (ch === '"' || ch === "'") {
            i = skipString(css, i);
            continue;
        }
        if (css.startsWith('/*', i)) {
            i = skipComment(css, i);
            continue;
        }
        if (ch === '\\') {
            i += 2;
            continue;
        }
        if (ch === '(' || ch === '[') depth++;
        else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
        else if (depth === 0 && stops.includes(ch)) return i;
        i++;
    }
    return -1;
}

// Index just after the `}` that closes the block opened at `open`.
function findBlockEnd(css, open) {
    let depth = 0;
    let i = open;
    while (i < css.length) {
        const ch = css[i];
        if (ch === '"' || ch === "'") {
            i = skipString(css, i);
            continue;
        }
        if (css.startsWith('/*', i)) {
            i = skipComment(css, i);
            continue;
        }
        if (ch === '\\') {
            i += 2;
            continue;
        }
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) return i + 1;
        }
        i++;
    }
    return -1;
}

// Parses a stylesheet into top-level items:
//   { type: 'comment', text }
//   { type: 'rule', selector, body }                 body is the raw text between { }
//   { type: 'at', name, prelude, body: null }        statements like @import …;
//   { type: 'at', name, prelude, body, children }    blocks; children only for @media, @supports, …
// where: { file, line, source } so errors point at the real file; `line` is where `css` starts.
function parseCss(css, where = {}) {
    const items = [];
    let i = 0;

    function fail(at, message, hint) {
        const before = css.slice(0, at);
        const line = (where.line ?? 1) + (before.match(/\n/g) ?? []).length + (where.lineBefore ?? 0);
        throw new AloError({ file: where.file, line, column: 1, source: where.source, message, hint });
    }

    while (i < css.length) {
        if (/\s/.test(css[i])) {
            i++;
            continue;
        }
        if (css.startsWith('/*', i)) {
            const close = css.indexOf('*/', i + 2);
            if (close === -1) fail(i, 'Unclosed CSS comment.', 'Close it with `*/`.');
            items.push({ type: 'comment', text: css.slice(i, close + 2) });
            i = close + 2;
            continue;
        }
        if (css[i] === '}') fail(i, 'Unexpected `}`.', 'Count the braces; there is one `}` too many.');

        if (css[i] === '@') {
            const name = /^@([\w-]+)/.exec(css.slice(i))?.[1] ?? '';
            const stop = findTopLevel(css, i, ['{', ';']);
            if (stop === -1) {
                items.push({ type: 'at', name, prelude: css.slice(i + 1 + name.length).trim(), body: null });
                break;
            }
            const prelude = css.slice(i + 1 + name.length, stop).trim();
            if (css[stop] === ';') {
                items.push({ type: 'at', name, prelude, body: null });
                i = stop + 1;
                continue;
            }
            const end = findBlockEnd(css, stop);
            if (end === -1) fail(stop, `Unclosed \`{\` in \`@${name}\`.`, 'Close the block with `}`.');
            const body = css.slice(stop + 1, end - 1);
            const lineBefore = (css.slice(0, stop + 1).match(/\n/g) ?? []).length + (where.lineBefore ?? 0);
            const children = NESTING_AT_RULES.has(name.toLowerCase()) ? parseCss(body, { ...where, lineBefore }) : null;
            items.push({ type: 'at', name, prelude, body, children });
            i = end;
            continue;
        }

        const open = findTopLevel(css, i, ['{', '}', ';']);
        if (open === -1 || css[open] !== '{') {
            fail(i, `Cannot parse \`${css.slice(i, i + 30).split('\n')[0].trim()}\`.`, 'Write CSS rules as `selector { property: value; }`.');
        }
        const end = findBlockEnd(css, open);
        if (end === -1) fail(open, 'Unclosed `{`.', 'Close the rule with `}`.');
        items.push({ type: 'rule', selector: css.slice(i, open).trim(), body: css.slice(open + 1, end - 1) });
        i = end;
    }
    return items;
}

function serializeCss(items, indent = '') {
    return items
        .map((item) => {
            if (item.type === 'comment') return indent + item.text;
            if (item.type === 'rule') return `${indent}${item.selector} {${item.body}}`;
            const head = `${indent}@${item.name}${item.prelude ? ' ' + item.prelude : ''}`;
            if (item.body === null) return head + ';';
            if (item.children) return `${head} {\n${serializeCss(item.children, indent + '    ')}\n${indent}}`;
            return `${head} {${item.body}}`;
        })
        .join('\n');
}

// Splits on a top-level separator, e.g. the commas of a selector list.
function splitTopLevel(text, separator) {
    const parts = [];
    let start = 0;
    let i = 0;
    while (i <= text.length) {
        const next = findTopLevel(text, i, [separator]);
        if (next === -1) break;
        parts.push(text.slice(start, next));
        start = next + 1;
        i = next + 1;
    }
    parts.push(text.slice(start));
    return parts;
}

module.exports = { parseCss, serializeCss, splitTopLevel, findTopLevel, skipString, skipComment };
