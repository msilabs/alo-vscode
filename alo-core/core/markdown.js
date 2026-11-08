'use strict';

// A CommonMark-like Markdown renderer with a few GFM extras (tables, ~~strikethrough~~).
// Not supported, so they stay literal text: reference-style links, footnotes, task lists, emoji, math.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const ASCII_PUNCT = /[!-/:-@[-`{-~]/;
const PUNCT = /[!-/:-@[-`{-~\p{P}\p{S}]/u;

const ENTITIES = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00A0', copy: '©', reg: '®', trade: '™',
    hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«',
    raquo: '»', times: '×', divide: '÷', middot: '·', bull: '•', deg: '°', euro: '€', pound: '£',
    yen: '¥', cent: '¢', sect: '§', para: '¶', plusmn: '±', frac12: '½', frac14: '¼', frac34: '¾',
    larr: '←', rarr: '→', uarr: '↑', darr: '↓', harr: '↔', check: '✓', hearts: '♥', auml: 'ä',
    ouml: 'ö', uuml: 'ü', szlig: 'ß', eacute: 'é', egrave: 'è', agrave: 'à', ntilde: 'ñ', ccedil: 'ç',
};

const ATX = /^ {0,3}(#{1,6})(?=[ \t]|$)(.*)$/;
const FENCE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const HR = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const QUOTE = /^ {0,3}>/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const TABLE_DELIMITER = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

const BLOCK_TAGS =
    'address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|' +
    'fieldset|figcaption|figure|footer|form|frame|frameset|h1|h2|h3|h4|h5|h6|head|header|hr|html|iframe|legend|li|link|' +
    'main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|' +
    'title|tr|track|ul';
const ATTRIBUTE = `(?:\\s+[A-Za-z_:][A-Za-z0-9_.:-]*(?:\\s*=\\s*(?:[^"'=<>\`\\x00-\\x20]+|'[^']*'|"[^"]*"))?)`;
const OPEN_TAG = `<[A-Za-z][A-Za-z0-9-]*${ATTRIBUTE}*\\s*/?>`;
const CLOSE_TAG = `</[A-Za-z][A-Za-z0-9-]*\\s*>`;
const INLINE_HTML = new RegExp(
    `^(?:${OPEN_TAG}|${CLOSE_TAG}|<!---?>|<!--[\\s\\S]*?-->|<\\?[\\s\\S]*?\\?>|<![A-Za-z][^>]*>|<!\\[CDATA\\[[\\s\\S]*?\\]\\]>)`,
);

// [start, end]: an HTML block runs until a line matching `end`, or until a blank line when `end` is null.
const HTML_BLOCKS = [
    [/^ {0,3}<(?:script|pre|style|textarea)(?=[\s>]|$)/i, /<\/(?:script|pre|style|textarea)>/i],
    [/^ {0,3}<!--/, /-->/],
    [/^ {0,3}<\?/, /\?>/],
    [/^ {0,3}<![A-Za-z]/, />/],
    [/^ {0,3}<!\[CDATA\[/, /\]\]>/],
    [new RegExp(`^ {0,3}</?(?:${BLOCK_TAGS})(?=[\\s/>]|$)`, 'i'), null],
    [new RegExp(`^ {0,3}(?:${OPEN_TAG}|${CLOSE_TAG})[ \\t]*$`), null],
];

function escapeHtml(text) {
    return text.replace(/[&"<>]/g, (ch) => ESCAPES[ch]);
}

function decodeEntity(body) {
    if (body[0] === '#') {
        const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
        if (!code || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '\uFFFD';
        return String.fromCodePoint(code);
    }
    return ENTITIES[body] ?? null;
}

const ENTITY = /&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/;

// Backslash escapes and known entities, for link destinations, titles and code info strings.
function unescapeString(text) {
    return text.replace(new RegExp(`\\\\([!-/:-@[-\`{-~])|${ENTITY.source}`, 'g'), (whole, escaped, entity) => {
        if (escaped) return escaped;
        return decodeEntity(entity) ?? whole;
    });
}

function normalizeUrl(url) {
    return url.replace(/%(?![0-9A-Fa-f]{2})|[^A-Za-z0-9\-._~:/?#@!$&'()*+,;=%]/gu, (ch) => encodeURIComponent(ch));
}

function isBlank(line) {
    return /^[ \t]*$/.test(line);
}

function indentOf(line) {
    let n = 0;
    while (line[n] === ' ') n++;
    return n;
}

function removeIndent(line, count) {
    let i = 0;
    while (i < count && line[i] === ' ') i++;
    return line.slice(i);
}

function expandLeadingTabs(line) {
    let out = '';
    let column = 0;
    let i = 0;
    for (; i < line.length; i++) {
        if (line[i] === ' ') {
            out += ' ';
            column++;
        } else if (line[i] === '\t') {
            const width = 4 - (column % 4);
            out += ' '.repeat(width);
            column += width;
        } else {
            break;
        }
    }
    return out + line.slice(i);
}

// ---------------------------------------------------------------- blocks

function listMarker(line) {
    const match = /^( {0,3})(?:([-+*])|(\d{1,9})([.)]))(?=[ \t]|$)/.exec(line);
    if (!match) return null;
    const [whole, indent, bullet, number, delimiter] = match;
    return {
        indent: indent.length,
        width: whole.length - indent.length,
        type: bullet ?? delimiter,
        ordered: !bullet,
        start: number === undefined ? null : Number(number),
        rest: line.slice(whole.length),
    };
}

function htmlBlockKind(line) {
    return HTML_BLOCKS.findIndex(([start]) => start.test(line));
}

function interruptsParagraph(line) {
    if (ATX.test(line) || HR.test(line) || QUOTE.test(line)) return true;
    const fence = FENCE.exec(line);
    if (fence && !(fence[2][0] === '`' && fence[3].includes('`'))) return true;
    const kind = htmlBlockKind(line);
    if (kind !== -1 && kind < 6) return true;
    const marker = listMarker(line);
    if (marker && !isBlank(marker.rest)) return !marker.ordered || marker.start === 1;
    return false;
}

// True when the last block is a paragraph that a lazy continuation line could still join.
function endsInParagraph(blocks) {
    const meaningful = blocks.filter((block) => block.type !== 'blank');
    const last = meaningful[meaningful.length - 1];
    if (!last || blocks[blocks.length - 1].type === 'blank') return false;
    if (last.type === 'paragraph') return true;
    if (last.type === 'blockquote') return endsInParagraph(last.blocks);
    if (last.type === 'list') return endsInParagraph(last.items[last.items.length - 1].blocks);
    return false;
}

function splitRow(line) {
    let row = line.trim();
    if (row.startsWith('|')) row = row.slice(1);
    if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1);
    const cells = [];
    let current = '';
    for (let i = 0; i < row.length; i++) {
        if (row[i] === '\\' && row[i + 1] === '|') {
            current += '|';
            i++;
        } else if (row[i] === '|') {
            cells.push(current.trim());
            current = '';
        } else {
            current += row[i];
        }
    }
    cells.push(current.trim());
    return cells;
}

function alignment(cell) {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return null;
}

function parseList(lines, start) {
    const first = listMarker(lines[start]);
    const list = { type: 'list', ordered: first.ordered, start: first.start, items: [], tight: true };
    let i = start;

    while (i < lines.length) {
        const marker = listMarker(lines[i]);
        if (!marker || marker.type !== first.type || HR.test(lines[i])) break;

        const spaces = indentOf(marker.rest);
        const emptyStart = isBlank(marker.rest);
        let width;
        let firstLine;
        if (emptyStart) {
            width = marker.indent + marker.width + 1;
            firstLine = '';
        } else if (spaces >= 5) {
            width = marker.indent + marker.width + 1;
            firstLine = marker.rest.slice(1);
        } else {
            width = marker.indent + marker.width + spaces;
            firstLine = marker.rest.slice(spaces);
        }

        const itemLines = [firstLine];
        i++;
        while (i < lines.length) {
            const line = lines[i];
            if (isBlank(line)) {
                // An item may begin with at most one blank line.
                if (emptyStart && itemLines.length === 1) break;
                itemLines.push('');
                i++;
                continue;
            }
            if (indentOf(line) >= width) {
                itemLines.push(removeIndent(line, width));
                i++;
                continue;
            }
            const lazy =
                itemLines[itemLines.length - 1] !== '' &&
                !interruptsParagraph(line) &&
                !listMarker(line) &&
                endsInParagraph(parseBlocks(itemLines));
            if (!lazy) break;
            itemLines.push(line);
            i++;
        }

        // Blank lines at the end of an item belong between items, or after the list.
        let trailing = 0;
        while (itemLines.length > 1 && itemLines[itemLines.length - 1] === '') {
            itemLines.pop();
            trailing++;
        }
        let ahead = i;
        while (ahead < lines.length && isBlank(lines[ahead])) ahead++;
        const next = ahead < lines.length ? listMarker(lines[ahead]) : null;
        const sibling = next && next.type === first.type && !HR.test(lines[ahead]);
        const between = trailing + (ahead - i);
        if (sibling) {
            if (between > 0) list.tight = false;
            i = ahead;
        } else {
            i -= trailing;
        }

        const blocks = parseBlocks(itemLines);
        const inner = blocks.findIndex((block) => block.type !== 'blank');
        const lastInner = blocks.findLastIndex((block) => block.type !== 'blank');
        if (blocks.slice(inner, lastInner).some((block) => block.type === 'blank')) list.tight = false;
        list.items.push({ blocks });

        if (!sibling) break;
    }
    return { block: list, next: i };
}

function parseBlocks(lines) {
    const blocks = [];
    let paragraph = null;
    let i = 0;

    const closeParagraph = () => {
        if (paragraph) blocks.push({ type: 'paragraph', text: paragraph.join('\n') });
        paragraph = null;
    };

    while (i < lines.length) {
        const line = lines[i];

        if (isBlank(line)) {
            closeParagraph();
            blocks.push({ type: 'blank' });
            i++;
            continue;
        }

        const indent = indentOf(line);

        if (paragraph) {
            const setext = SETEXT.exec(line);
            if (setext && indent < 4) {
                blocks.push({ type: 'heading', level: setext[1][0] === '=' ? 1 : 2, text: paragraph.join('\n') });
                paragraph = null;
                i++;
                continue;
            }

            if (paragraph.length === 1 && TABLE_DELIMITER.test(line) && (paragraph[0].includes('|') || line.includes('|'))) {
                const header = splitRow(paragraph[0]);
                const aligns = splitRow(line).map(alignment);
                if (header.length === aligns.length) {
                    const rows = [];
                    i++;
                    while (i < lines.length && !isBlank(lines[i]) && !interruptsParagraph(lines[i])) {
                        rows.push(splitRow(lines[i]));
                        i++;
                    }
                    blocks.push({ type: 'table', header, aligns, rows });
                    paragraph = null;
                    continue;
                }
            }

            if (indent >= 4 || !interruptsParagraph(line)) {
                paragraph.push(line);
                i++;
                continue;
            }
            closeParagraph();
        }

        if (indent >= 4) {
            const code = [];
            while (i < lines.length && (isBlank(lines[i]) || indentOf(lines[i]) >= 4)) {
                code.push(removeIndent(lines[i], 4));
                i++;
            }
            while (code.length > 0 && isBlank(code[code.length - 1])) code.pop();
            blocks.push({ type: 'code', info: '', text: code.join('\n') + '\n' });
            continue;
        }

        const fence = FENCE.exec(line);
        if (fence && !(fence[2][0] === '`' && fence[3].includes('`'))) {
            const [, openIndent, marker, info] = fence;
            const code = [];
            i++;
            while (i < lines.length) {
                const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(lines[i]);
                if (close && close[1][0] === marker[0] && close[1].length >= marker.length) {
                    i++;
                    break;
                }
                code.push(removeIndent(lines[i], openIndent.length));
                i++;
            }
            blocks.push({ type: 'code', info: unescapeString(info.trim()), text: code.length > 0 ? code.join('\n') + '\n' : '' });
            continue;
        }

        const atx = ATX.exec(line);
        if (atx) {
            let text = atx[2].trim();
            text = /^#+$/.test(text) ? '' : text.replace(/[ \t]+#+$/, '').trim();
            blocks.push({ type: 'heading', level: atx[1].length, text });
            i++;
            continue;
        }

        if (HR.test(line)) {
            blocks.push({ type: 'hr' });
            i++;
            continue;
        }

        if (QUOTE.test(line)) {
            const inner = [];
            while (i < lines.length) {
                const current = lines[i];
                if (QUOTE.test(current)) {
                    inner.push(current.replace(/^ {0,3}> ?/, ''));
                } else if (!isBlank(current) && !interruptsParagraph(current) && inner.length > 0 && !isBlank(inner[inner.length - 1]) && endsInParagraph(parseBlocks(inner))) {
                    inner.push(current);
                } else {
                    break;
                }
                i++;
            }
            blocks.push({ type: 'blockquote', blocks: parseBlocks(inner) });
            continue;
        }

        if (listMarker(line)) {
            const { block, next } = parseList(lines, i);
            blocks.push(block);
            i = next;
            continue;
        }

        const kind = htmlBlockKind(line);
        if (kind !== -1) {
            const end = HTML_BLOCKS[kind][1];
            const html = [];
            while (i < lines.length) {
                if (!end && isBlank(lines[i])) break;
                html.push(lines[i]);
                i++;
                if (end && end.test(lines[i - 1])) break;
            }
            blocks.push({ type: 'html', text: html.join('\n') });
            continue;
        }

        paragraph = [line];
        i++;
    }
    closeParagraph();
    return blocks;
}

// ---------------------------------------------------------------- inlines

function isWhitespace(ch) {
    return ch === undefined || /\s/u.test(ch);
}

function isPunctuation(ch) {
    return ch !== undefined && PUNCT.test(ch);
}

function skipLinkSpace(text, p) {
    let newlines = 0;
    while (p < text.length && /[ \t\n]/.test(text[p])) {
        if (text[p] === '\n' && ++newlines > 1) break;
        p++;
    }
    return p;
}

// Parses `(destination "title")` right after `]`. Returns { href, title, end } or null.
function parseLinkTail(text, p) {
    if (text[p] !== '(') return null;
    p = skipLinkSpace(text, p + 1);

    let href;
    if (text[p] === '<') {
        let q = p + 1;
        while (q < text.length && text[q] !== '>' && text[q] !== '\n' && text[q] !== '<') {
            q += text[q] === '\\' ? 2 : 1;
        }
        if (text[q] !== '>') return null;
        href = text.slice(p + 1, q);
        p = q + 1;
    } else {
        const start = p;
        let depth = 0;
        while (p < text.length) {
            const ch = text[p];
            if (ch === '\\' && ASCII_PUNCT.test(text[p + 1] ?? '')) {
                p += 2;
                continue;
            }
            if (ch === '(') depth++;
            else if (ch === ')') {
                if (depth === 0) break;
                depth--;
            } else if (/[ \x00-\x1f\x7f]/.test(ch)) break;
            p++;
        }
        if (depth !== 0) return null;
        href = text.slice(start, p);
    }

    const afterDestination = p;
    p = skipLinkSpace(text, p);
    let title = null;
    const opener = text[p];
    if (p > afterDestination && (opener === '"' || opener === "'" || opener === '(')) {
        const closer = opener === '(' ? ')' : opener;
        let q = p + 1;
        while (q < text.length && text[q] !== closer) {
            if (opener === '(' && text[q] === '(') return null;
            q += text[q] === '\\' ? 2 : 1;
        }
        if (q >= text.length) return null;
        title = text.slice(p + 1, q);
        p = skipLinkSpace(text, q + 1);
    }
    if (text[p] !== ')') return null;
    return { href: normalizeUrl(unescapeString(href)), title: title === null ? null : unescapeString(title), end: p + 1 };
}

function processEmphasis(nodes, delimiters, bottom) {
    const list = delimiters.slice(bottom);
    const openersBottom = {};
    let c = 0;

    while (c < list.length) {
        const closer = list[c];
        if (!closer.canClose) {
            c++;
            continue;
        }

        const key = closer.char + (closer.canOpen ? '1' : '0') + (closer.length % 3);
        let found = -1;
        for (let o = c - 1; o > (openersBottom[key] ?? -1); o--) {
            const opener = list[o];
            if (opener.char !== closer.char || !opener.canOpen) continue;
            if (closer.char === '~') {
                if (opener.count === 2 && closer.count === 2) found = o;
                if (found !== -1) break;
                continue;
            }
            const odd = (opener.canClose || closer.canOpen) && (opener.length + closer.length) % 3 === 0 && !(opener.length % 3 === 0 && closer.length % 3 === 0);
            if (!odd) {
                found = o;
                break;
            }
        }

        if (found === -1) {
            openersBottom[key] = c - 1;
            if (!closer.canOpen) list.splice(c, 1);
            else c++;
            continue;
        }

        const opener = list[found];
        const use = closer.char === '~' ? 2 : opener.count >= 2 && closer.count >= 2 ? 2 : 1;
        opener.count -= use;
        closer.count -= use;
        opener.node.value = opener.node.value.slice(0, opener.count);
        closer.node.value = closer.node.value.slice(0, closer.count);

        const from = nodes.indexOf(opener.node);
        const to = nodes.indexOf(closer.node);
        const children = nodes.splice(from + 1, to - from - 1);
        const type = closer.char === '~' ? 'del' : use === 2 ? 'strong' : 'em';
        nodes.splice(from + 1, 0, { type, children });

        list.splice(found + 1, c - found - 1);
        c = found + 1;
        if (opener.count === 0) {
            nodes.splice(nodes.indexOf(opener.node), 1);
            list.splice(found, 1);
            c--;
        }
        if (closer.count === 0) {
            nodes.splice(nodes.indexOf(closer.node), 1);
            list.splice(c, 1);
        }
    }
    delimiters.length = bottom;
}

function parseInline(text) {
    const nodes = [];
    const delimiters = [];
    const brackets = [];
    let buffer = '';
    let i = 0;

    const flush = () => {
        if (buffer) nodes.push({ type: 'text', value: buffer });
        buffer = '';
    };

    while (i < text.length) {
        const ch = text[i];

        if (ch === '\\') {
            const next = text[i + 1];
            if (next === '\n') {
                flush();
                nodes.push({ type: 'hardbreak' });
                i += 2;
                while (text[i] === ' ' || text[i] === '\t') i++;
            } else if (next !== undefined && ASCII_PUNCT.test(next)) {
                buffer += next;
                i += 2;
            } else {
                buffer += '\\';
                i++;
            }
            continue;
        }

        if (ch === '`') {
            const run = /^`+/.exec(text.slice(i))[0];
            const closing = new RegExp(`(?<!\`)\`{${run.length}}(?!\`)`, 'g');
            closing.lastIndex = i + run.length;
            const match = closing.exec(text);
            if (match) {
                flush();
                let code = text.slice(i + run.length, match.index).replace(/\n/g, ' ');
                if (/^ .*[^ ].* $/s.test(code)) code = code.slice(1, -1);
                nodes.push({ type: 'code', value: code });
                i = match.index + run.length;
            } else {
                buffer += run;
                i += run.length;
            }
            continue;
        }

        if (ch === '<') {
            const rest = text.slice(i);
            const uri = /^<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>\x00-\x1f]*)>/.exec(rest);
            const email = /^<([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)>/.exec(rest);
            const html = INLINE_HTML.exec(rest);
            if (uri || email) {
                flush();
                const target = (uri ?? email)[1];
                nodes.push({ type: 'link', href: normalizeUrl(email ? 'mailto:' + target : target), title: null, children: [{ type: 'text', value: target }] });
                i += (uri ?? email)[0].length;
                continue;
            }
            if (html) {
                flush();
                nodes.push({ type: 'html', value: html[0] });
                i += html[0].length;
                continue;
            }
        }

        if (ch === '&') {
            const entity = ENTITY.exec(text.slice(i));
            if (entity && entity.index === 0) {
                const decoded = decodeEntity(entity[1]);
                if (decoded !== null) {
                    buffer += decoded;
                } else {
                    flush();
                    nodes.push({ type: 'html', value: entity[0] });
                }
                i += entity[0].length;
                continue;
            }
        }

        if (ch === '*' || ch === '_' || ch === '~') {
            let end = i;
            while (text[end] === ch) end++;
            const run = text.slice(i, end);
            const before = text[i - 1];
            const after = text[end];
            const left = !isWhitespace(after) && (!isPunctuation(after) || isWhitespace(before) || isPunctuation(before));
            const right = !isWhitespace(before) && (!isPunctuation(before) || isWhitespace(after) || isPunctuation(after));
            flush();
            const node = { type: 'text', value: run };
            nodes.push(node);
            if (ch !== '~' || run.length === 2) {
                const canOpen = ch === '_' ? left && (!right || isPunctuation(before)) : left;
                const canClose = ch === '_' ? right && (!left || isPunctuation(after)) : right;
                delimiters.push({ node, char: ch, length: run.length, count: run.length, canOpen, canClose });
            }
            i = end;
            continue;
        }

        if (ch === '[' || (ch === '!' && text[i + 1] === '[')) {
            flush();
            const image = ch === '!';
            const node = { type: 'text', value: image ? '![' : '[' };
            nodes.push(node);
            brackets.push({ node, image, active: true, bottom: delimiters.length });
            i += image ? 2 : 1;
            continue;
        }

        if (ch === ']') {
            flush();
            const opener = brackets[brackets.length - 1];
            const tail = opener && opener.active ? parseLinkTail(text, i + 1) : null;
            if (!tail) {
                if (opener) brackets.pop();
                buffer += ']';
                i++;
                continue;
            }

            const at = nodes.indexOf(opener.node);
            const children = nodes.splice(at + 1);
            processEmphasis(children, delimiters, opener.bottom);
            nodes.splice(at, 1);
            nodes.push({ type: opener.image ? 'image' : 'link', href: tail.href, title: tail.title, children });
            brackets.pop();
            if (!opener.image) for (const bracket of brackets) if (!bracket.image) bracket.active = false;
            i = tail.end;
            continue;
        }

        if (ch === '\n') {
            const hard = / {2,}$/.test(buffer);
            buffer = buffer.replace(/ +$/, '');
            flush();
            nodes.push({ type: hard ? 'hardbreak' : 'softbreak' });
            i++;
            while (text[i] === ' ' || text[i] === '\t') i++;
            continue;
        }

        buffer += ch;
        i++;
    }

    flush();
    processEmphasis(nodes, delimiters, 0);
    return nodes;
}

function plainText(nodes) {
    return nodes
        .map((node) => {
            if (node.type === 'text' || node.type === 'code') return node.value;
            if (node.type === 'softbreak' || node.type === 'hardbreak') return '\n';
            return node.children ? plainText(node.children) : '';
        })
        .join('');
}

function renderInline(nodes) {
    let out = '';
    for (const node of nodes) {
        switch (node.type) {
            case 'text':
                out += escapeHtml(node.value);
                break;
            case 'code':
                out += `<code>${escapeHtml(node.value)}</code>`;
                break;
            case 'html':
                out += node.value;
                break;
            case 'softbreak':
                out += '\n';
                break;
            case 'hardbreak':
                out += '<br />\n';
                break;
            case 'em':
            case 'strong':
            case 'del':
                out += `<${node.type}>${renderInline(node.children)}</${node.type}>`;
                break;
            case 'link':
                out += `<a href="${escapeHtml(node.href)}"${node.title === null ? '' : ` title="${escapeHtml(node.title)}"`}>${renderInline(node.children)}</a>`;
                break;
            case 'image':
                out += `<img src="${escapeHtml(node.href)}" alt="${escapeHtml(plainText(node.children))}"${node.title === null ? '' : ` title="${escapeHtml(node.title)}"`} />`;
                break;
        }
    }
    return out;
}

function inline(text) {
    return renderInline(parseInline(text.replace(/^[ \t]+/gm, '').replace(/[ \t]+$/, '')));
}

// ---------------------------------------------------------------- render

// Keeps letters of every script (so Bengali headings get readable ids), digits, `-` and `_`.
function slugify(text) {
    return (
        text
            .toLowerCase()
            .trim()
            .replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, '')
            .replace(/\s+/g, '-') || 'section'
    );
}

function renderBlocks(blocks, out, options, tight) {
    const cr = () => {
        if (out.html && !out.html.endsWith('\n')) out.html += '\n';
    };

    for (const block of blocks) {
        switch (block.type) {
            case 'blank':
                break;
            case 'paragraph':
                if (tight) {
                    out.html += inline(block.text);
                } else {
                    cr();
                    out.html += `<p>${inline(block.text)}</p>`;
                    cr();
                }
                break;
            case 'heading': {
                const nodes = parseInline(block.text.replace(/^[ \t]+/gm, '').trim());
                let id = '';
                if (options.headingIds) {
                    const base = slugify(plainText(nodes));
                    const count = (options.ids.get(base) ?? 0) + 1;
                    options.ids.set(base, count);
                    id = ` id="${escapeHtml(count === 1 ? base : `${base}-${count}`)}"`;
                }
                cr();
                out.html += `<h${block.level}${id}>${renderInline(nodes)}</h${block.level}>`;
                cr();
                break;
            }
            case 'code': {
                const language = block.info.split(/\s+/)[0];
                cr();
                out.html += `<pre><code${language ? ` class="language-${escapeHtml(language)}"` : ''}>${escapeHtml(block.text)}</code></pre>`;
                cr();
                break;
            }
            case 'html':
                cr();
                out.html += block.text;
                cr();
                break;
            case 'hr':
                cr();
                out.html += '<hr />';
                cr();
                break;
            case 'blockquote':
                cr();
                out.html += '<blockquote>';
                cr();
                renderBlocks(block.blocks, out, options, false);
                cr();
                out.html += '</blockquote>';
                cr();
                break;
            case 'list': {
                const tag = block.ordered ? 'ol' : 'ul';
                cr();
                out.html += block.ordered && block.start !== 1 ? `<ol start="${block.start}">` : `<${tag}>`;
                cr();
                for (const item of block.items) {
                    out.html += '<li>';
                    renderBlocks(item.blocks, out, options, block.tight);
                    out.html += '</li>';
                    cr();
                }
                out.html += `</${tag}>`;
                cr();
                break;
            }
            case 'table': {
                const cell = (tag, text, i) => {
                    const align = block.aligns[i];
                    return `<${tag}${align ? ` style="text-align: ${align}"` : ''}>${inline(text)}</${tag}>\n`;
                };
                cr();
                out.html += '<table>\n<thead>\n<tr>\n' + block.header.map((text, i) => cell('th', text, i)).join('') + '</tr>\n</thead>\n';
                if (block.rows.length > 0) {
                    out.html += '<tbody>\n';
                    for (const row of block.rows) {
                        out.html += '<tr>\n' + block.header.map((_, i) => cell('td', row[i] ?? '', i)).join('') + '</tr>\n';
                    }
                    out.html += '</tbody>\n';
                }
                out.html += '</table>';
                cr();
                break;
            }
        }
    }
}

// options.headingIds: add an `id` to every heading (on by default; the CommonMark tests turn it off).
function renderMarkdown(markdown, { headingIds = true } = {}) {
    const lines = markdown.replace(/\r\n?/g, '\n').replace(/\0/g, '\uFFFD').split('\n').map(expandLeadingTabs);
    if (lines[lines.length - 1] === '') lines.pop();
    const out = { html: '' };
    renderBlocks(parseBlocks(lines), out, { headingIds, ids: new Map() }, false);
    return out.html;
}

module.exports = { renderMarkdown, slugify };
