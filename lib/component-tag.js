'use strict';

const { isInCommentScriptOrStyle } = require('./auto-insert');
const { expressionRanges, isInside } = require('./embedded');

const TAG = /<\/?([A-Z][A-Za-z0-9_]*(?:\.[A-Z][A-Za-z0-9_]*)*)/g;

// The component name under the cursor in `<Card` or `</Card`, as { name, start, end }, or null.
function componentTagAt(text, offset) {
    const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
    const lineEnd = text.indexOf('\n', offset) === -1 ? text.length : text.indexOf('\n', offset);
    const line = text.slice(lineStart, lineEnd);

    for (const match of line.matchAll(TAG)) {
        const tagStart = lineStart + match.index;
        const start = tagStart + match[0].length - match[1].length;
        const end = start + match[1].length;
        if (offset < start || offset > end) continue;

        if (isInCommentScriptOrStyle(text.slice(0, tagStart))) return null;
        if (isInside(tagStart, expressionRanges(text))) return null;
        return { name: match[1], start, end };
    }
    return null;
}

// `props.postDate` is written as `post-date="..."` on the tag.
function attributeName(prop) {
    return prop.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase());
}

module.exports = { componentTagAt, attributeName };
