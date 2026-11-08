'use strict';

const { AloError } = require('./errors.js');
const { parseHtml } = require('./html-parser.js');

const BLOCKS = ['head', 'template', 'style', 'script'];
const DOCUMENT_TAGS = ['html', 'head', 'body'];
const LOGIC_ATTRIBUTES = ['for', 'if', 'else-if', 'else'];

function isLogicTemplate(node) {
    return node.name === 'template' && node.attrs.some((attr) => LOGIC_ATTRIBUTES.includes(attr.name));
}

// Slots inside a plain HTML <template> belong to Web Components, so Alo leaves them alone.
function findSlots(nodes, found = []) {
    for (const node of nodes) {
        if (node.type !== 'element') continue;
        if (node.name === 'slot') found.push(node);
        if (node.name === 'template' && !isLogicTemplate(node)) continue;
        findSlots(node.children, found);
    }
    return found;
}

function edgeTextPart(node, edge) {
    if (!node || node.type !== 'text' || node.rawText) return null;
    const part = edge === 'start' ? node.parts[0] : node.parts[node.parts.length - 1];
    return part && part.type === 'text' ? part : null;
}

const LINE_START = /\n[ \t]*$/;
const LINE_END = /^[ \t]*\r?\n/;

function endsWith(node, pattern) {
    const part = edgeTextPart(node, 'end');
    return part !== null && pattern.test(part.value);
}

function startsWith(node, pattern) {
    const part = edgeTextPart(node, 'start');
    return part !== null && pattern.test(part.value);
}

function collectLineEdits(nodes, ends, starts) {
    nodes.forEach((node, i) => {
        if (node.type !== 'element' || node.name === 'pre' || node.name === 'textarea') return;
        const first = node.children[0];
        const last = node.children[node.children.length - 1];

        if (isLogicTemplate(node)) {
            if (endsWith(nodes[i - 1], LINE_START) && startsWith(first, LINE_END)) {
                ends.push(nodes[i - 1]);
                starts.push(first);
            }
            if (endsWith(last, LINE_START) && startsWith(nodes[i + 1], LINE_END)) {
                ends.push(last);
                starts.push(nodes[i + 1]);
            }
        }
        collectLineEdits(node.children, ends, starts);
    });
}

// A logic <template> tag alone on its line takes that line with it, so loops and conditions do not
// leave blank lines behind (like Jinja's trim_blocks). Nothing changes inside <pre> or <textarea>.
// All conditions are checked on the original text before any edit, because one text node often sits
// between two tags and an early edit would hide the newline the other tag looks for.
function tidyWhitespace(nodes) {
    const ends = [];
    const starts = [];
    collectLineEdits(nodes, ends, starts);

    for (const node of ends) {
        const part = edgeTextPart(node, 'end');
        part.value = part.value.replace(LINE_START, '\n');
    }
    for (const node of starts) {
        const part = edgeTextPart(node, 'start');
        part.value = part.value.replace(LINE_END, '');
    }
}

function checkSlotAttributes(slots, fail) {
    for (const slot of slots) {
        if (slot.attrs.length > 0) {
            fail(slot, '`<slot>` cannot have attributes.', 'There are no named slots; a file has a single `<slot />`.');
        }
    }
}

function checkComponentSlot(blocks, fail) {
    const slots = blocks.template ? findSlots(blocks.template.children) : [];
    checkSlotAttributes(slots, fail);
    if (slots.length > 1) {
        fail(slots[1], 'More than one `<slot>` in a component.', `A component has a single \`<slot />\`. The first one is on line ${slots[0].line}.`);
    }
    blocks.hasSlot = slots.length === 1;
}

function checkLayoutSlot(blocks, fail) {
    const slots = blocks.template ? findSlots(blocks.template.children) : [];
    checkSlotAttributes(slots, fail);
    if (slots.length === 0) {
        fail(
            blocks.template ?? { line: 1, column: 1 },
            'The layout has no `<slot />`.',
            'Put `<slot />` inside `<template>` where the page should go.',
        );
    }
    if (slots.length > 1) {
        fail(slots[1], 'More than one `<slot />` in the layout.', `A layout has exactly one \`<slot />\`. The first one is on line ${slots[0].line}.`);
    }
}

function blockKey(node, fail) {
    if (node.name === 'style' && node.attrs.length === 1 && node.attrs[0].name === 'global' && node.attrs[0].value === null) {
        return 'styleGlobal';
    }
    if (node.attrs.length > 0) {
        const hint = node.name === 'style' ? 'The only exception is `<style global>`.' : 'Write top-level blocks without attributes.';
        fail(node, `The top-level \`<${node.name}>\` block cannot have attributes.`, hint);
    }
    return node.name === 'style' ? 'style' : node.name;
}

function checkNoDocumentTags(nodes, fail) {
    for (const node of nodes) {
        if (node.type !== 'element') continue;
        if (DOCUMENT_TAGS.includes(node.name)) {
            fail(node, `The \`<${node.name}>\` tag cannot be used here.`, 'Alo creates `<html>`, `<head>` and `<body>` itself.');
        }
        checkNoDocumentTags(node.children, fail);
    }
}

// kind: 'page' | 'layout' | 'component' | 'not-found'
function parseSfc(source, file, kind) {
    const root = parseHtml(source, file);

    function fail(node, message, hint) {
        throw new AloError({ file, line: node.line, column: node.column, message, hint, source: root.source });
    }

    const blocks = { file, source: root.source, kind };

    for (const node of root.children) {
        if (node.type === 'comment') continue;
        if (node.type === 'text') {
            const offset = node.value.search(/\S/);
            if (offset === -1) continue;
            const before = node.value.slice(0, offset);
            const lines = before.split('\n');
            const line = node.line + lines.length - 1;
            const column = lines.length === 1 ? node.column + offset : lines[lines.length - 1].length + 1;
            fail({ line, column }, 'Text outside a block.', 'Put HTML markup inside the `<template>` block.');
        }

        if (!BLOCKS.includes(node.name)) {
            fail(node, `Unknown top-level block \`<${node.name}>\`.`, 'Only `<head>`, `<template>`, `<style>` and `<script>` are allowed at the top level. Put HTML markup inside `<template>`.');
        }
        if (node.name === 'head' && kind === 'component') {
            fail(node, 'Components cannot have `<head>`.', '`<head>` is only for pages and layouts.');
        }

        const key = blockKey(node, fail);
        if (blocks[key]) {
            const label = key === 'styleGlobal' ? '<style global>' : `<${node.name}>`;
            fail(node, `The \`${label}\` block appears more than once.`, `The first \`${label}\` is on line ${blocks[key].line}. Merge them.`);
        }
        blocks[key] = node;
    }

    if (blocks.template) checkNoDocumentTags(blocks.template.children, fail);
    if (blocks.head) checkNoDocumentTags(blocks.head.children, fail);
    if (kind === 'layout') checkLayoutSlot(blocks, fail);
    if (kind === 'component') checkComponentSlot(blocks, fail);
    if (blocks.template) tidyWhitespace(blocks.template.children);
    if (blocks.head) tidyWhitespace(blocks.head.children);

    return blocks;
}

module.exports = { parseSfc, isLogicTemplate, findSlots, LOGIC_ATTRIBUTES };
