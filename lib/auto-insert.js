'use strict';

const VOID_ELEMENTS = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr',
]);

// An open tag that ends right at the cursor; quoted values may contain `>`.
const OPEN_TAG = /<([A-Za-z][\w.-]*)(?:\s(?:[^<>"']|"[^"]*"|'[^']*')*)?>$/;

function isInside(text, open, close) {
    return text.lastIndexOf(open) > text.lastIndexOf(close);
}

function isInCommentScriptOrStyle(text) {
    return (
        isInside(text, '<!--', '-->') ||
        isInside(text, '<script', '</script>') ||
        isInside(text, '<style', '</style>')
    );
}

// `before` is the whole document up to the cursor, `after` the rest of the cursor's line.
// Returns the closing tag to insert after the cursor, or null.
function closingTag(before, after) {
    if (before.endsWith('/>')) return null;

    const line = before.slice(before.lastIndexOf('\n') + 1);
    const match = OPEN_TAG.exec(line);
    if (!match) return null;

    const name = match[1];
    if (VOID_ELEMENTS.has(name.toLowerCase())) return null;

    const beforeTag = before.slice(0, before.length - line.length + match.index);
    if (isInCommentScriptOrStyle(beforeTag)) return null;

    const close = `</${name}>`;
    if (after.startsWith(close)) return null;
    return close;
}

// Turns `{{` into `{{ | }}` and then `{{ {` into `{{{ | }}}`.
// Returns how many characters to replace on each side of the cursor and the new text, or null.
function expandBraces(before, after) {
    if (isInCommentScriptOrStyle(before)) return null;

    if (/(^|[^{\\])\{\{ \{$/.test(before)) {
        const closing = /^\}? \}\}/.exec(after);
        if (closing) return { removeBefore: 4, removeAfter: closing[0].length, open: '{{{ ', close: ' }}}' };
    }

    if (/(^|[^{\\])\{\{$/.test(before)) {
        const closing = /^\}{0,2}/.exec(after);
        return { removeBefore: 2, removeAfter: closing[0].length, open: '{{ ', close: ' }}' };
    }

    return null;
}

module.exports = { closingTag, expandBraces };
