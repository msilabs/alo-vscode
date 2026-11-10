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
