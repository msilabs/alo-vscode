'use strict';

const { AloError } = require('./errors.js');

const URL_ATTRIBUTES = new Set(['href', 'src', 'action', 'formaction', 'poster', 'xlink:href']);
const SRCSET_ATTRIBUTES = new Set(['srcset', 'imagesrcset']);

// my-repo → /my-repo/; empty → /
function normalizeBase(value = '/') {
    const trimmed = String(value).trim();
    if (!/^[A-Za-z0-9\-._~/]*$/.test(trimmed)) {
        throw new AloError({
            message: `Invalid \`--base\` value \`${value}\`.`,
            hint: 'Use only letters, digits, `-`, `_`, `.` and `/`, e.g. `--base /my-repo/`.',
        });
    }
    const inner = trimmed.split('/').filter(Boolean).join('/');
    return inner ? `/${inner}/` : '/';
}

// Only site-root paths get the base: `/about/` yes; `//cdn…`, `https://…`, `#top` and `about/` no.
function withBase(url, base) {
    return url.startsWith('/') && !url.startsWith('//') ? base + url.slice(1) : url;
}

function rewriteSrcset(value, base) {
    if (value.includes('data:')) return value;
    return value
        .split(',')
        .map((candidate) => candidate.replace(/^(\s*)(\S+)/, (_, space, url) => space + withBase(url, base)))
        .join(',');
}

// url(/x.png), url("/x.png"), url('/x.png')
function rewriteCssUrls(css, base) {
    if (base === '/') return css;
    return css.replace(/url\(\s*(['"]?)(\/(?!\/)[^'")]*)\1\s*\)/g, (_, quote, url) => `url(${quote}${withBase(url, base)}${quote})`);
}

function rewriteTag(tag, base) {
    const name = /^<([A-Za-z][\w:-]*)/.exec(tag)[1].toLowerCase();
    const refresh = name === 'meta' && /\shttp-equiv\s*=\s*["']?refresh/i.test(tag);

    return tag.replace(/(\s)([^\s"'=<>/]+)(\s*=\s*)("[^"]*"|'[^']*'|[^\s"'=<>`]+)/g, (whole, space, attr, equals, raw) => {
        const key = attr.toLowerCase();
        const quote = raw[0] === '"' || raw[0] === "'" ? raw[0] : '';
        const value = quote ? raw.slice(1, -1) : raw;
        let next = value;

        if (URL_ATTRIBUTES.has(key) || (key === 'data' && name === 'object')) next = withBase(value, base);
        else if (SRCSET_ATTRIBUTES.has(key)) next = rewriteSrcset(value, base);
        else if (key === 'style') next = rewriteCssUrls(value, base);
        else if (key === 'content' && refresh) next = value.replace(/(url\s*=\s*['"]?)(\/(?!\/))/i, (_, before) => before + base);

        return next === value ? whole : `${space}${attr}${equals}${quote}${next}${quote}`;
    });
}

// Runs on the final HTML after rendering, so templates always write plain `/about/` links.
function applyBase(html, base) {
    if (base === '/') return html;
    let out = '';
    let i = 0;

    while (i < html.length) {
        const lt = html.indexOf('<', i);
        if (lt === -1) {
            out += html.slice(i);
            break;
        }
        out += html.slice(i, lt);

        if (html.startsWith('<!--', lt)) {
            const end = html.indexOf('-->', lt);
            const stop = end === -1 ? html.length : end + 3;
            out += html.slice(lt, stop);
            i = stop;
            continue;
        }
        if (!/[A-Za-z]/.test(html[lt + 1] ?? '')) {
            out += '<';
            i = lt + 1;
            continue;
        }

        let end = lt + 1;
        let quote = null;
        for (; end < html.length; end++) {
            const ch = html[end];
            if (quote) {
                if (ch === quote) quote = null;
            } else if (ch === '"' || ch === "'") {
                quote = ch;
            } else if (ch === '>') {
                break;
            }
        }
        const tag = html.slice(lt, end + 1);
        out += rewriteTag(tag, base);
        i = end + 1;

        // Script content is left alone; <style> content gets the same url() rewrite as CSS files.
        const raw = /^<(script|style)\b/i.exec(tag);
        if (raw) {
            const close = new RegExp(`</${raw[1]}\\s*>`, 'i');
            const match = close.exec(html.slice(i));
            const stop = match ? i + match.index : html.length;
            const content = html.slice(i, stop);
            out += raw[1].toLowerCase() === 'style' ? rewriteCssUrls(content, base) : content;
            i = stop;
        }
    }
    return out;
}

module.exports = { normalizeBase, applyBase, rewriteCssUrls, withBase };
