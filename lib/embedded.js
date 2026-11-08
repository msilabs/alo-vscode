'use strict';

// Comments, <script> and <style> are matched first so that `{{` inside them is skipped.
// An unclosed `{{` (while typing) only runs to the end of its line.
const PATTERN = /<!--[\s\S]*?(?:-->|$)|<(script|style)\b[\s\S]*?(?:<\/\1\s*>|$)|\\\{\{|\{\{\{[\s\S]*?\}\}\}|\{\{[\s\S]*?\}\}|\{\{.*/gi;

// Start and end offsets of every `{{ }}` and `{{{ }}}` in an `.alo` file.
function expressionRanges(text) {
    const ranges = [];
    for (const match of text.matchAll(PATTERN)) {
        if (match[0].startsWith('{{')) ranges.push([match.index, match.index + match[0].length]);
    }
    return ranges;
}

// True when the offset is between an expression's braces, not just before or after them.
function isInside(offset, ranges) {
    return ranges.some(([start, end]) => start < offset && offset < end);
}

// The same text with every expression turned into spaces, so HTML tools see plain HTML
// and every line and column stays where it was.
function htmlView(text, ranges) {
    let result = '';
    let last = 0;
    for (const [start, end] of ranges) {
        result += text.slice(last, start) + text.slice(start, end).replace(/[^\n]/g, ' ');
        last = end;
    }
    return result + text.slice(last);
}

module.exports = { expressionRanges, isInside, htmlView };
