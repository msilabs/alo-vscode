'use strict';

const { skipString } = require('./css-parser.js');

// Removes comments (keeping /*! … */), collapses whitespace and drops the last `;` before `}`.
// Strings, url(…) and custom property values (`--x: …`) stay exactly as written.
function minifyCss(css) {
    let out = '';
    let i = 0;
    let pendingSpace = false;

    const emit = (text) => {
        if (pendingSpace && out && !/[{};,:>(]$/.test(out) && !/^[{};,)]/.test(text)) out += ' ';
        pendingSpace = false;
        out += text;
    };

    while (i < css.length) {
        const ch = css[i];

        if (/\s/.test(ch)) {
            pendingSpace = true;
            i++;
            continue;
        }

        if (css.startsWith('/*', i)) {
            const close = css.indexOf('*/', i + 2);
            const end = close === -1 ? css.length : close + 2;
            if (css[i + 2] === '!') emit(css.slice(i, end));
            else pendingSpace = true;
            i = end;
            continue;
        }

        if (ch === '"' || ch === "'") {
            const end = skipString(css, i);
            emit(css.slice(i, end));
            i = end;
            continue;
        }

        if (/^url\(/i.test(css.slice(i, i + 4))) {
            const close = css.indexOf(')', i);
            const end = close === -1 ? css.length : close + 1;
            emit(css.slice(i, end));
            i = end;
            continue;
        }

        // A custom property's value is copied as written, up to its `;` or the closing `}`.
        if (css.startsWith('--', i) && /[{;]$/.test(out)) {
            const colon = css.indexOf(':', i);
            let end = colon + 1;
            let depth = 0;
            while (end < css.length) {
                const c = css[end];
                if (c === '"' || c === "'") {
                    end = skipString(css, end);
                    continue;
                }
                if (c === '(' || c === '[' || c === '{') depth++;
                else if (c === ')' || c === ']' || (c === '}' && depth > 0)) depth--;
                else if (depth === 0 && (c === ';' || c === '}')) break;
                end++;
            }
            emit(css.slice(i, colon).trim() + ':' + css.slice(colon + 1, end).trim());
            i = end;
            continue;
        }

        if (ch === '}' && out.endsWith(';')) out = out.slice(0, -1);
        emit(ch);
        i++;
    }
    return out;
}

module.exports = { minifyCss };
