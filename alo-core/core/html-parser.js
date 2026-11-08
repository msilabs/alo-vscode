'use strict';

const { AloError } = require('./errors.js');
const { VOID_ELEMENTS, RAW_TEXT_ELEMENTS } = require('./html-tags.js');

const TAG_NAME = /[A-Za-z][A-Za-z0-9._:-]*/y;
const WHITESPACE = /\s/;

function skipString(source, i) {
    const quote = source[i];
    i++;
    while (i < source.length) {
        if (source[i] === '\\') {
            i += 2;
            continue;
        }
        if (source[i] === quote) return i + 1;
        i++;
    }
    return i;
}

function skipBraces(source, i) {
    let depth = 1;
    while (i < source.length) {
        const ch = source[i];
        if (ch === '"' || ch === "'") {
            i = skipString(source, i);
            continue;
        }
        if (ch === '`') {
            i = skipTemplateLiteral(source, i);
            continue;
        }
        if (ch === '{') depth++;
        if (ch === '}') {
            depth--;
            if (depth === 0) return i + 1;
        }
        i++;
    }
    return i;
}

function skipTemplateLiteral(source, i) {
    i++;
    while (i < source.length) {
        if (source[i] === '\\') {
            i += 2;
            continue;
        }
        if (source[i] === '`') return i + 1;
        if (source.startsWith('${', i)) {
            i = skipBraces(source, i + 2);
            continue;
        }
        i++;
    }
    return i;
}

// Finds where `closer` starts, skipping JS strings, template literals and nested braces,
// so `}}` inside `'}}'` or `{ a: 1 }` does not end the expression. Returns -1 if unclosed.
function findExpressionEnd(source, i, closer) {
    let depth = 0;
    while (i < source.length) {
        const ch = source[i];
        if (ch === '"' || ch === "'") {
            i = skipString(source, i);
            continue;
        }
        if (ch === '`') {
            i = skipTemplateLiteral(source, i);
            continue;
        }
        if (depth === 0 && source.startsWith(closer, i)) return i;
        if (ch === '{') depth++;
        if (ch === '}') depth--;
        i++;
    }
    return -1;
}

function parseHtml(input, file) {
    const source = input.replace(/^﻿/, '');
    const length = source.length;
    const lineStarts = [0];
    for (let i = 0; i < length; i++) {
        if (source[i] === '\n') lineStarts.push(i + 1);
    }

    function position(offset) {
        let low = 0;
        let high = lineStarts.length - 1;
        while (low < high) {
            const mid = (low + high + 1) >> 1;
            if (lineStarts[mid] <= offset) low = mid;
            else high = mid - 1;
        }
        return { line: low + 1, column: offset - lineStarts[low] + 1 };
    }

    function fail(offset, message, hint) {
        throw new AloError({ file, ...position(offset), message, hint, source });
    }

    function expressionBounds(i) {
        const triple = source.startsWith('{{{', i);
        const open = triple ? 3 : 2;
        const closer = triple ? '}}}' : '}}';
        const close = findExpressionEnd(source, i + open, closer);
        if (close === -1) {
            fail(i, `Unclosed \`${triple ? '{{{' : '{{'}\`.`, `Close it with \`${closer}\`. To write a literal \`{{\`, use \`\\{{\`.`);
        }
        return { triple, open, closer, close, end: close + closer.length };
    }

    function isEscapedBraces(i) {
        return source[i] === '\\' && source.startsWith('{{', i + 1);
    }

    // Moves forward until `stop` matches, treating `{{ ... }}` as one unbreakable token.
    function scanUntil(i, stop) {
        while (i < length) {
            if (isEscapedBraces(i)) {
                i += 3;
                continue;
            }
            if (source.startsWith('{{', i)) {
                i = expressionBounds(i).end;
                continue;
            }
            if (stop(source[i], i)) return i;
            i++;
        }
        return length;
    }

    function makeParts(start, end) {
        const parts = [];
        let buffer = '';
        let chunkStart = start;
        let i = start;

        while (i < end) {
            if (isEscapedBraces(i)) {
                buffer += source.slice(chunkStart, i) + '{{';
                i += 3;
                chunkStart = i;
                continue;
            }
            if (source.startsWith('{{', i)) {
                buffer += source.slice(chunkStart, i);
                if (buffer) parts.push({ type: 'text', value: buffer });
                buffer = '';

                const { triple, open, close, end: next } = expressionBounds(i);
                const code = source.slice(i + open, close).trim();
                if (!code) fail(i, 'Empty `{{ }}`.', 'Put an expression inside, e.g. `{{ title }}`.');
                parts.push({ type: 'expr', code, raw: triple, offset: i, ...position(i) });

                i = next;
                chunkStart = i;
                continue;
            }
            i++;
        }

        buffer += source.slice(chunkStart, end);
        if (buffer) parts.push({ type: 'text', value: buffer });
        return parts;
    }

    function skipWhitespace(i) {
        while (i < length && WHITESPACE.test(source[i])) i++;
        return i;
    }

    function readTagName(i) {
        TAG_NAME.lastIndex = i;
        const match = TAG_NAME.exec(source);
        return match ? match[0] : '';
    }

    const root = { type: 'root', children: [] };
    const stack = [root];
    let textStart = 0;

    function current() {
        return stack[stack.length - 1];
    }

    function flushText(end) {
        if (end <= textStart) return;
        current().children.push({
            type: 'text',
            value: source.slice(textStart, end),
            parts: makeParts(textStart, end),
            offset: textStart,
            ...position(textStart),
        });
    }

    function parseAttribute(i, attrs, tagName) {
        if (source[i] === '/') return i + 1;

        const start = i;
        while (i < length && !/[\s"'>=/]/.test(source[i])) {
            if (source.startsWith('{{', i)) {
                fail(i, '`{{ }}` cannot be used in an attribute name.', 'Use it in the value, e.g. `title="{{ x }}"`.');
            }
            i++;
        }

        const name = source.slice(start, i);
        if (!name) fail(i, `Unexpected \`${source[i]}\` in the \`<${tagName}>\` tag.`);

        let j = skipWhitespace(i);
        if (source[j] !== '=') {
            attrs.push({ name, value: null, quote: '', raw: name, offset: start, ...position(start) });
            return i;
        }

        j = skipWhitespace(j + 1);
        let quote = '';
        let valueStart;
        let valueEnd;

        if (source[j] === '"' || source[j] === "'") {
            quote = source[j];
            valueStart = j + 1;
            valueEnd = scanUntil(valueStart, (ch) => ch === quote);
            if (valueEnd >= length) fail(j, `Unclosed quote in the value of \`${name}\`.`, `Add \`${quote}\` at the end of the value.`);
            i = valueEnd + 1;
        } else {
            valueStart = j;
            valueEnd = scanUntil(j, (ch, k) => WHITESPACE.test(ch) || ch === '>' || source.startsWith('/>', k));
            if (valueEnd === valueStart) fail(j, `Missing value after \`${name}=\`.`);
            i = valueEnd;
        }

        attrs.push({
            name,
            value: source.slice(valueStart, valueEnd),
            parts: makeParts(valueStart, valueEnd),
            quote,
            raw: source.slice(start, i),
            offset: start,
            ...position(start),
        });
        return i;
    }

    function failExpressionInTagName(offset) {
        fail(offset, '`{{ }}` cannot be used in a tag name.', 'Write tag names directly, e.g. `<div>` or `<Card />`.');
    }

    function parseOpeningTag(start) {
        const name = readTagName(start + 1);
        let i = start + 1 + name.length;
        if (source.startsWith('{{', i)) failExpressionInTagName(i);
        const attrs = [];
        let selfClosing = false;

        for (;;) {
            i = skipWhitespace(i);
            if (i >= length) fail(start, `The \`<${name}>\` tag is not finished.`, 'End the tag with `>`.');
            if (source[i] === '>') {
                i++;
                break;
            }
            if (source.startsWith('/>', i)) {
                i += 2;
                selfClosing = true;
                break;
            }
            i = parseAttribute(i, attrs, name);
        }

        const node = { type: 'element', name, attrs, children: [], selfClosing, offset: start, ...position(start) };
        current().children.push(node);

        if (selfClosing || VOID_ELEMENTS.has(name)) return i;

        if (RAW_TEXT_ELEMENTS.has(name)) {
            const closing = new RegExp(`</${name}\\s*>`, 'gi');
            closing.lastIndex = i;
            const match = closing.exec(source);
            if (!match) fail(start, `\`<${name}>\` is never closed.`, `Close it with \`</${name}>\`.`);
            const value = source.slice(i, match.index);
            if (value) {
                node.children.push({ type: 'text', rawText: true, value, parts: [{ type: 'text', value }], offset: i, ...position(i) });
            }
            return match.index + match[0].length;
        }

        stack.push(node);
        return i;
    }

    function parseClosingTag(start) {
        const name = readTagName(start + 2);
        let i = skipWhitespace(start + 2 + name.length);
        if (source[i] !== '>') fail(start, `The \`</${name}\` tag is not finished with \`>\`.`);
        i++;

        if (VOID_ELEMENTS.has(name)) {
            fail(start, `\`<${name}>\` closes itself; \`</${name}>\` is not needed.`, `Remove \`</${name}>\`.`);
        }

        const open = current();
        if (open.type === 'element' && open.name === name) {
            stack.pop();
            return i;
        }
        if (stack.some((node) => node.name === name)) {
            fail(open.offset, `\`<${open.name}>\` is not closed before \`</${name}>\`.`, `Add \`</${open.name}>\` before \`</${name}>\`.`);
        }
        if (open.type === 'element' && open.name.toLowerCase() === name.toLowerCase()) {
            fail(start, `\`</${name}>\` does not close \`<${open.name}>\`.`, `Tag names are case-sensitive: write \`</${open.name}>\`.`);
        }
        fail(start, `\`</${name}>\` has no matching \`<${name}>\`.`, 'Remove the extra closing tag.');
    }

    let i = 0;
    while (i < length) {
        const ch = source[i];

        if (ch === '<') {
            if (source.startsWith('<!--', i)) {
                flushText(i);
                const end = source.indexOf('-->', i + 4);
                if (end === -1) fail(i, 'Unclosed HTML comment.', 'Close it with `-->`.');
                current().children.push({ type: 'comment', value: source.slice(i, end + 3), offset: i, ...position(i) });
                i = textStart = end + 3;
                continue;
            }
            if (source[i + 1] === '/' && /[A-Za-z]/.test(source[i + 2] ?? '')) {
                flushText(i);
                i = textStart = parseClosingTag(i);
                continue;
            }
            if (/[A-Za-z]/.test(source[i + 1] ?? '')) {
                flushText(i);
                i = textStart = parseOpeningTag(i);
                continue;
            }
            if (source.startsWith('{{', i + 1) || source.startsWith('/{{', i + 1)) {
                failExpressionInTagName(i + 1);
            }
            if (source[i + 1] === '!') {
                fail(i, '`<!...>` is not allowed here.', 'Alo adds `<!DOCTYPE>` itself; use `<!-- -->` for comments.');
            }
        }

        if (isEscapedBraces(i)) {
            i += 3;
            continue;
        }
        if (ch === '{' && source.startsWith('{{', i)) {
            i = expressionBounds(i).end;
            continue;
        }
        i++;
    }
    flushText(length);

    if (stack.length > 1) {
        const open = current();
        fail(open.offset, `\`<${open.name}>\` is never closed.`, `Close it with \`</${open.name}>\`.`);
    }

    root.source = source;
    return root;
}

module.exports = { parseHtml, findExpressionEnd };
