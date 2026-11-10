'use strict';

const { attributeName } = require('./component-tag');

// Where a tag that starts at `from` (its `<`) ends, just after `>`, and whether it is `<X />`.
function tagEnd(text, from) {
    let quote = null;
    for (let i = from; i < text.length; i++) {
        const ch = text[i];
        if (quote) {
            if (ch === quote) quote = null;
        } else if (ch === '"' || ch === "'") {
            quote = ch;
        } else if (ch === '>') {
            return { end: i + 1, selfClosing: text[i - 1] === '/' };
        }
    }
    return { end: text.length, selfClosing: false };
}

// The `</Name>` that closes the tag opened at `from`, skipping nested tags of the same name.
function closingTagName(text, from, name) {
    const opening = tagEnd(text, from);
    if (opening.selfClosing) return null;
    const escaped = name.replace(/\./g, '\\.');
    const tags = new RegExp(`<(/?)${escaped}(?=[\\s/>])`, 'g');
    tags.lastIndex = opening.end;
    let depth = 1;
    for (let match; (match = tags.exec(text)); ) {
        if (match[1]) {
            depth--;
            if (depth === 0) return { start: match.index + 2, end: match.index + 2 + name.length };
        } else if (!tagEnd(text, match.index).selfClosing) {
            depth++;
        }
    }
    return null;
}

// Renames a component tag at `start` (`<Crad` or `</Crad`), and its closing tag too.
function renameTag(text, start, name, newName) {
    const nameStart = start + (text[start + 1] === '/' ? 2 : 1);
    const edits = [{ start: nameStart, end: nameStart + name.length, newText: newName }];
    const closing = closingTagName(text, start, name);
    if (closing) edits.push({ ...closing, newText: newName });
    return edits;
}

// The `</name>` that closes the element opened at `from`, as { start, end } of the whole tag,
// or null for a self-closing tag or a void element like `<img>`.
function closingTag(text, from, name) {
    const found = closingTagName(text, from, name);
    if (!found) return null;
    return { start: found.start - 2, end: tagEnd(text, found.start).end };
}

// Alo's logic attributes, longest first so that `else-if` is not read as `else`.
const LOGIC_ATTRIBUTE = /\s(else-if|for|if|else)(?:\s*=\s*("[^"]*"|'[^']*'))?(?=[\s/>])/;

// `<li if="x">a</li>` → `<template if="x"><li>a</li></template>`, as Alo's hint says.
function wrapInTemplate(text, at) {
    const lt = text[at] === '<' ? at : text.lastIndexOf('<', at);
    const name = /^<([A-Za-z][\w.-]*)/.exec(text.slice(lt))?.[1];
    if (!name || name === 'template') return null;
    const opening = tagEnd(text, lt);
    const attribute = LOGIC_ATTRIBUTE.exec(text.slice(lt, opening.end));
    if (!attribute) return null;

    const [whole, attributeName, value] = attribute;
    const attributeStart = lt + attribute.index;
    const after = closingTag(text, lt, name)?.end ?? opening.end;
    const template = value ? `<template ${attributeName}=${value}>` : `<template ${attributeName}>`;
    return {
        title: `Wrap in \`${template}\``,
        edits: [
            { start: lt, end: lt, newText: template },
            { start: attributeStart, end: attributeStart + whole.length, newText: '' },
            { start: after, end: after, newText: '</template>' },
        ],
    };
}

// `<template for="A" if="B">…</template>` → `<template for="A"><template if="B">…</template></template>`.
function nestIfInFor(text, at) {
    const lt = text.lastIndexOf('<template', at);
    if (lt < 0) return null;
    const opening = tagEnd(text, lt);
    const ifAttribute = /\sif\s*=\s*("[^"]*"|'[^']*')/.exec(text.slice(lt, opening.end));
    const closing = closingTag(text, lt, 'template');
    if (!ifAttribute || !closing) return null;
    const ifStart = lt + ifAttribute.index;
    return {
        title: 'Move `if` into a `<template>` inside the loop',
        edits: [
            { start: ifStart, end: ifStart + ifAttribute[0].length, newText: '' },
            { start: opening.end, end: opening.end, newText: `<template if=${ifAttribute[1]}>` },
            { start: closing.start, end: closing.start, newText: '</template>' },
        ],
    };
}

// Adds `<slot />` on its own line just before the last `</template>`.
function addSlot(text) {
    const close = text.lastIndexOf('</template>');
    if (close < 0) return null;
    const lineStart = text.lastIndexOf('\n', close - 1) + 1;
    const indent = /^[ \t]*/.exec(text.slice(lineStart, close))[0];
    const onOwnLine = text.slice(lineStart, close).trim() === '';
    const newText = onOwnLine ? `${indent}    <slot />\n` : '<slot />';
    const at = onOwnLine ? lineStart : close;
    return { title: 'Add `<slot />`', edits: [{ start: at, end: at, newText }] };
}

// The same new component file `alo new component` makes.
function componentFile(name) {
    const className = name.split('.').pop().replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
    return `<template>\n    <div class="${className}">\n        <slot />\n    </div>\n</template>\n`;
}

// Turns an Alo diagnostic into ready-made fixes. `start`/`end` are the offsets of the underlined
// text in `text`, and `message` is the diagnostic message with Alo's hint on the following lines.
// Each fix is { title, preferred, edits: [{ start, end, newText }] } or { title, create: { file, content } }.
function quickFixes(text, start, end, message) {
    const fixes = [];
    const meant = /Did you mean `<?([^`>]+)>?`\?/.exec(message)?.[1];

    const unknownComponent = /^Component `<([\w.]+)>` not found\./.exec(message);
    if (unknownComponent) {
        const name = unknownComponent[1];
        if (meant) fixes.push({ title: `Change to \`<${meant}>\``, preferred: true, edits: renameTag(text, start, name, meant) });
        const lower = /write `<([a-z][\w-]*)>` in lowercase/.exec(message)?.[1];
        if (lower) fixes.push({ title: `Change to the HTML tag \`<${lower}>\``, preferred: !meant, edits: renameTag(text, start, name, lower) });
        const file = /Create the component: `([^`]+)`/.exec(message)?.[1];
        if (file) fixes.push({ title: `Create ${file}`, create: { file, content: componentFile(name) } });
        return fixes;
    }

    const unusedProp = /^`<[\w.]+>` never uses `([^`]+)`\./.exec(message);
    if (unusedProp && meant) {
        fixes.push({ title: `Change to \`${attributeName(meant)}\``, preferred: true, edits: [{ start, end, newText: attributeName(meant) }] });
        return fixes;
    }

    if (/^`<[\w.-]+ (else-if|for|if|else)>` will not work\./.test(message) || /^Logic can only be written on a <template> tag\./.test(message)) {
        const fix = wrapInTemplate(text, start);
        if (fix) fixes.push({ ...fix, preferred: true });
        return fixes;
    }

    if (/^`for` and `if` cannot be on the same `<template>`\./.test(message)) {
        const fix = nestIfInFor(text, start);
        if (fix) fixes.push({ ...fix, preferred: true });
        return fixes;
    }

    // `sort()` and `reverse()` have copies that leave the data alone; `push()` and the rest do not.
    const mutating = /^`(sort|reverse)\(\)` changes data/.exec(message);
    if (mutating) {
        const replacement = { sort: 'toSorted', reverse: 'toReversed' }[mutating[1]];
        const lineEnd = text.indexOf('\n', start) === -1 ? text.length : text.indexOf('\n', start);
        const call = new RegExp(`\\.${mutating[1]}\\(`).exec(text.slice(start, lineEnd));
        if (call) {
            const at = start + call.index + 1;
            fixes.push({ title: `Use \`${replacement}()\` instead`, preferred: true, edits: [{ start: at, end: at + mutating[1].length, newText: replacement }] });
        }
        return fixes;
    }

    if (/^The layout has no `<slot \/>`\./.test(message)) {
        const fix = addSlot(text);
        if (fix) fixes.push({ ...fix, preferred: true });
        return fixes;
    }

    // The underline covers the whole `{{ }}`; only the unknown name inside it changes.
    const undefinedName = /^`([\w$]+)` is not defined\./.exec(message);
    if (undefinedName && meant) {
        const name = undefinedName[1].replace(/\$/g, '\\$');
        const found = new RegExp(`(?<![\\w$.])${name}(?![\\w$])`).exec(text.slice(start, end));
        if (found) {
            const at = start + found.index;
            fixes.push({ title: `Change to \`${meant}\``, preferred: true, edits: [{ start: at, end: at + undefinedName[1].length, newText: meant }] });
        }
    }
    return fixes;
}

module.exports = { quickFixes, componentFile };
