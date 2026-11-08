'use strict';

const { escapeHtml } = require('./render.js');

const VOID_HEAD_TAGS = new Set(['meta', 'link', 'base']);
const DEFAULT_CHARSET = '<meta charset="UTF-8">';
const DEFAULT_VIEWPORT = '<meta name="viewport" content="width=device-width, initial-scale=1">';

function tagEnd(html, start) {
    let quote = null;
    for (let i = start + 1; i < html.length; i++) {
        const ch = html[i];
        if (quote) {
            if (ch === quote) quote = null;
        } else if (ch === '"' || ch === "'") {
            quote = ch;
        } else if (ch === '>') {
            return i + 1;
        }
    }
    return html.length;
}

function attribute(openTag, name) {
    const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(openTag);
    if (match) return match[1] ?? match[2] ?? match[3];
    return new RegExp(`\\s${name}(?=[\\s/>])`, 'i').test(openTag) ? '' : null;
}

// `<meta>` tags with the same key replace each other: charset, name or property.
function metaKey(openTag) {
    if (attribute(openTag, 'charset') !== null) return 'charset';
    const name = attribute(openTag, 'name');
    if (name !== null) return 'name:' + name.toLowerCase();
    const property = attribute(openTag, 'property');
    if (property !== null) return 'property:' + property;
    return null;
}

// Splits rendered <head> HTML into top-level items. The input is Alo's own output, so a light scan is enough.
function splitHead(html) {
    const items = [];
    let i = 0;

    while (i < html.length) {
        if (/\s/.test(html[i])) {
            i++;
            continue;
        }

        if (html.startsWith('<!--', i)) {
            const close = html.indexOf('-->', i);
            const end = close === -1 ? html.length : close + 3;
            items.push({ html: html.slice(i, end), key: null });
            i = end;
            continue;
        }

        const open = /^<([A-Za-z][\w:-]*)/.exec(html.slice(i, i + 64));
        if (!open) {
            const next = html.indexOf('<', i + 1);
            const end = next === -1 ? html.length : next;
            items.push({ html: html.slice(i, end).trim(), key: null });
            i = end;
            continue;
        }

        const name = open[1].toLowerCase();
        const openEnd = tagEnd(html, i);
        const openTag = html.slice(i, openEnd);
        let end = openEnd;
        if (!VOID_HEAD_TAGS.has(name) && !openTag.endsWith('/>')) {
            const closing = new RegExp(`</${name}\\s*>`, 'gi');
            closing.lastIndex = openEnd;
            const match = closing.exec(html);
            if (match) end = match.index + match[0].length;
        }

        items.push({
            html: html.slice(i, end),
            title: name === 'title',
            key: name === 'meta' ? metaKey(openTag) : null,
        });
        i = end;
    }
    return items;
}

// heads: rendered <head> HTML in order root layout → inner layouts → page.
// The last <title> and the last <meta> with a given name/property win; exact duplicates appear once.
function mergeHeads(heads, defaultTitle) {
    let title = null;
    const items = [];

    for (const html of heads) {
        for (const item of splitHead(html)) {
            if (item.title) {
                title = item.html;
                continue;
            }
            if (item.key) {
                const earlier = items.findIndex((other) => other.key === item.key);
                if (earlier !== -1) items.splice(earlier, 1);
                items.push(item);
                continue;
            }
            if (!items.some((other) => other.html === item.html)) items.push(item);
        }
    }

    const take = (key, fallback) => {
        const index = items.findIndex((item) => item.key === key);
        return index === -1 ? fallback : items.splice(index, 1)[0].html;
    };

    return [
        take('charset', DEFAULT_CHARSET),
        take('name:viewport', DEFAULT_VIEWPORT),
        title ?? `<title>${escapeHtml(defaultTitle)}</title>`,
        ...items.map((item) => item.html),
    ];
}

module.exports = { mergeHeads, splitHead };
