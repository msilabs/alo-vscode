'use strict';

const { isInCommentScriptOrStyle } = require('./auto-insert');
const { expressionRanges, isInside } = require('./embedded');

const COMPONENT_START = /^<([A-Z][A-Za-z0-9_]*(?:\.[A-Z][A-Za-z0-9_]*)*)(?=[\s/>]|$)/;

// Walks a tag from its `<` and reports where it ends (just after `>`) or that `stop` came first.
// Quoted values may contain `>`.
function scanTag(text, from, stop) {
    let quote = null;
    for (let i = from; i < stop; i++) {
        const ch = text[i];
        if (quote) {
            if (ch === quote) quote = null;
        } else if (ch === '"' || ch === "'") {
            quote = ch;
        } else if (ch === '>') {
            return { closedAt: i + 1, quote: null };
        }
    }
    return { closedAt: -1, quote };
}

// The attribute names already written in a tag, e.g. `title` and `featured` in `<Card title="a" featured>`.
function writtenAttributes(tagText) {
    const withoutValues = tagText.replace(/"[^"]*"|'[^']*'/g, '""');
    return [...withoutValues.matchAll(/\s([A-Za-z_:][\w:.-]*)/g)].map((m) => m[1]);
}

// When the cursor is where an attribute name goes inside a component's opening tag,
// returns { name, start, written }: the component, where the typed attribute name starts,
// and the other attribute names already in the tag. Otherwise returns null.
function componentTagContext(text, offset) {
    const lt = text.lastIndexOf('<', offset - 1);
    if (lt < 0) return null;
    const match = COMPONENT_START.exec(text.slice(lt, offset));
    if (!match) return null;
    if (isInCommentScriptOrStyle(text.slice(0, lt))) return null;
    if (isInside(lt, expressionRanges(text))) return null;

    // The tag must still be open at the cursor, and the cursor must not be inside a quoted value.
    const before = scanTag(text, lt + match[0].length, offset);
    if (before.closedAt !== -1 || before.quote) return null;

    const typed = /[\w:.-]*$/.exec(text.slice(lt + match[0].length, offset))[0];
    const start = offset - typed.length;
    // An attribute name only starts after whitespace: `<Card|` is still the tag name.
    if (!/\s/.test(text[start - 1] ?? '')) return null;

    const after = scanTag(text, offset, text.length);
    const tagEnd = after.closedAt === -1 ? text.length : after.closedAt;
    const tagText = text.slice(lt + match[0].length, start) + ' ' + text.slice(offset, tagEnd);
    return { name: match[1], start, written: writtenAttributes(tagText) };
}

module.exports = { componentTagContext, writtenAttributes };
