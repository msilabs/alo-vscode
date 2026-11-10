'use strict';

const { createFsReader } = require('./project');
const { expressionRanges } = require('./embedded');

// A reader that sees unsaved editor text first and the disk second.
// `overlay` maps POSIX paths relative to the root (e.g. `pages/page.alo`) to their current text.
function createOverlayReader(root, overlay) {
    const disk = createFsReader(root);
    return {
        exists: (relative) => overlay.has(relative) || disk.exists(relative),
        read: (relative) => (overlay.has(relative) ? overlay.get(relative) : disk.read(relative)),
        list: (relative) => disk.list(relative),
    };
}

function toProblem(diagnostic, severity) {
    const { file, line, column, message, hint, calledFrom } = diagnostic;
    return { severity, file, line, column, message, hint, calledFrom };
}

// Runs Alo's own `compile`, the same as `node alo dev` does, and returns what it reported:
// warnings, and at most one error, because Alo stops at the first one.
// `cache` ({ sfc: Map, data: Map }) is kept between runs so unchanged files are not parsed again.
function checkProject(root, core, overlay, cache) {
    const { compile } = core.load('compile');
    const reader = createOverlayReader(root, overlay);
    try {
        const result = compile({ reader, mode: 'dev', cache });
        return result.warnings.map((w) => toProblem(w, 'warning'));
    } catch (err) {
        if (err.name !== 'AloError') throw err;
        return [...(err.warnings ?? []).map((w) => toProblem(w, 'warning')), toProblem(err, 'error')];
    }
}

// Which part of the file a problem underlines, as 0-based { start, end } positions.
// Alo gives a 1-based line and column; it points at `{{` for a bad expression and at `<` for a tag.
// Without a line (e.g. "`<Card>` is never used") the first line is underlined.
function problemRange(text, line, column) {
    const lines = text.split('\n');
    if (!line || line > lines.length) {
        return { start: { line: 0, character: 0 }, end: { line: 0, character: lines[0].length } };
    }
    const lineText = lines[line - 1];
    const startChar = Math.max(0, Math.min((column ?? 1) - 1, lineText.length));
    const lineOffset = lines.slice(0, line - 1).reduce((sum, l) => sum + l.length + 1, 0);
    const offset = lineOffset + startChar;

    let length;
    const expression = expressionRanges(text).find(([start]) => start === offset);
    if (expression) {
        length = Math.min(expression[1], lineOffset + lineText.length) - offset;
    } else {
        const word = /<\/?[A-Za-z][\w.-]*|[\w$.-]+/y;
        word.lastIndex = startChar;
        const match = word.exec(lineText);
        length = match ? match[0].length : Math.min(1, lineText.length - startChar);
    }
    return { start: { line: line - 1, character: startChar }, end: { line: line - 1, character: startChar + length } };
}

module.exports = { checkProject, createOverlayReader, problemRange };
