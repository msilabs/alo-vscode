'use strict';

const { BOOLEAN_ATTRIBUTES } = require('./html-tags.js');

// True when the value has no `{{ }}` and no `\{{` escape, so the source can be copied as-is.
function isStatic(attr) {
    if (attr.value === null) return true;
    return attr.parts.every((part) => part.type === 'text') && attr.parts.map((part) => part.value).join('') === attr.value;
}

// True when the whole value is a single `{{ expr }}`, e.g. `disabled="{{ !ready }}"`.
function isWholeExpression(attr) {
    return attr.value !== null && attr.parts.length === 1 && attr.parts[0].type === 'expr';
}

// Decides what a whole-value `{{ }}` attribute becomes on an HTML element:
// { kind: 'drop' } | { kind: 'bare' } | { kind: 'value', value }
function wholeValueOutcome(name, value) {
    if (value === null || value === undefined) return { kind: 'drop' };
    if (BOOLEAN_ATTRIBUTES.has(name.toLowerCase())) return value ? { kind: 'bare' } : { kind: 'drop' };
    return { kind: 'value', value };
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

// Props hold plain text, which the component escapes again when it prints them.
function decodeEntities(text) {
    return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, body) => {
        if (body[0] === '#') {
            const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
            return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
        }
        return ENTITIES[body] ?? whole;
    });
}

// post-date → postDate
function propName(attrName) {
    return attrName.replace(/-([a-z0-9])/g, (_, ch) => ch.toUpperCase());
}

module.exports = { isStatic, isWholeExpression, wholeValueOutcome, decodeEntities, propName };
