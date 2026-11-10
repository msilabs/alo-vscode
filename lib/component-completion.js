'use strict';

const { isInCommentScriptOrStyle } = require('./auto-insert');
const { expressionRanges, isInside } = require('./embedded');

// `<` and a partly typed tag name right before the cursor, e.g. `<`, `<Ca` or `<Blog.Po`.
const PARTIAL_TAG = /<([A-Za-z][\w.]*)?$/;

// Where a component name is being typed: the offset where the name starts (just after `<`),
// or -1 when the cursor is not in such a place.
function componentNameStart(text, offset) {
    const before = text.slice(0, offset);
    const match = PARTIAL_TAG.exec(before.slice(before.lastIndexOf('\n') + 1));
    if (!match) return -1;

    const start = offset - (match[1] ?? '').length;
    if (isInCommentScriptOrStyle(text.slice(0, start - 1))) return -1;
    // `{{ a < b }}` is a comparison, not a tag. The `<` itself is checked, because an unclosed
    // `{{` at the end of the text ends exactly where the name would start.
    if (isInside(start - 1, expressionRanges(text))) return -1;
    return start;
}

module.exports = { componentNameStart };
