'use strict';

class AloError extends Error {
    constructor({ file, line, column, message, hint, calledFrom, source }) {
        super(message);
        this.name = 'AloError';
        this.file = file;
        this.line = line;
        this.column = column;
        this.hint = hint;
        this.calledFrom = calledFrom;
        // Kept non-enumerable so error objects stay small when logged or compared.
        Object.defineProperty(this, 'source', { value: source, writable: true });
    }
}

function levenshtein(a, b) {
    const left = Array.from(a);
    const right = Array.from(b);
    let previous = Array.from({ length: right.length + 1 }, (_, i) => i);

    for (let i = 1; i <= left.length; i++) {
        const current = [i];
        for (let j = 1; j <= right.length; j++) {
            const cost = left[i - 1] === right[j - 1] ? 0 : 1;
            current[j] = Math.min(
                previous[j] + 1,
                current[j - 1] + 1,
                previous[j - 1] + cost,
            );
        }
        previous = current;
    }
    return previous[right.length];
}

function suggest(name, candidates) {
    const limit = Math.max(2, Math.ceil(name.length / 3));
    let best = null;
    let bestDistance = Infinity;

    for (const candidate of candidates) {
        const distance = levenshtein(name.toLowerCase(), candidate.toLowerCase());
        if (distance < bestDistance) {
            best = candidate;
            bestDistance = distance;
        }
    }
    return bestDistance <= limit ? best : null;
}

function formatLocation({ file, line, column }) {
    if (!file) return '';
    let location = file;
    if (line) {
        location += ':' + line;
        if (column) location += ':' + column;
    }
    return location;
}

function codeFrame(source, line, column) {
    const lines = source.split(/\r?\n/);
    if (!line || line < 1 || line > lines.length) return [];

    const first = Math.max(1, line - 1);
    const last = Math.min(lines.length, line + 1);
    const width = String(last).length;
    const frame = [];

    for (let n = first; n <= last; n++) {
        frame.push(`${String(n).padStart(width)} | ${lines[n - 1]}`);
        if (n === line && column) {
            const before = lines[n - 1].slice(0, column - 1).replace(/[^\t]/g, ' ');
            frame.push(`${' '.repeat(width)} | ${before}^`);
        }
    }
    return frame;
}

function indentContinuation(text, prefix) {
    const padding = ' '.repeat(prefix.length);
    return text.split('\n').map((part, i) => (i === 0 ? prefix + part : padding + part));
}

// Returns the diagnostic as plain lines; colouring and the leading icon belong to the CLI.
function formatDiagnostic(diagnostic, source = diagnostic.source) {
    const location = formatLocation(diagnostic);
    const lines = [location];

    lines.push('  ' + diagnostic.message);
    if (diagnostic.calledFrom) {
        lines.push('  Called from: ' + formatLocation(diagnostic.calledFrom));
    }

    if (source && diagnostic.line) {
        const frame = codeFrame(source, diagnostic.line, diagnostic.column);
        if (frame.length > 0) {
            lines.push('');
            for (const frameLine of frame) lines.push('  ' + frameLine);
        }
    }

    if (diagnostic.hint) {
        lines.push('');
        lines.push(...indentContinuation(diagnostic.hint, '  Hint: '));
    }
    return lines;
}

module.exports = {
    AloError,
    levenshtein,
    suggest,
    codeFrame,
    formatLocation,
    formatDiagnostic,
};
