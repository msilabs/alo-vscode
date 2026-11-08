'use strict';

const crypto = require('node:crypto');
const { AloError } = require('./errors.js');
const { parseSfc } = require('./sfc.js');
const { renderNodes, escapeHtml } = require('./render.js');
const { findRoutes } = require('./routes.js');
const { mergeHeads } = require('./head.js');
const { scanComponents, propUsage, referencedComponents } = require('./components.js');
const { createData } = require('./data.js');
const { scopeAttribute } = require('./css-scope.js');
const { scanGlobal, buildStyle, blockText, buildGlobalScript, buildComponentScript, buildPageScript } = require('./assets.js');
const { normalizeBase, applyBase, rewriteCssUrls } = require('./base-path.js');
const { minifyCss } = require('./css-minify.js');
const { buildSitemap, buildRobots } = require('./seo.js');

const STYLE_PATH = 'assets/style.css';
const GLOBAL_SCRIPT_PATH = 'assets/global.js';
const COMPONENT_SCRIPT_PATH = 'assets/components.js';

function renderDocument({ lang, base, head, body, stylesheet, scripts }) {
    const dataBase = base === '/' ? '' : ` data-base="${base}"`;
    const lines = ['<!DOCTYPE html>', `<html lang="${escapeHtml(lang)}"${dataBase}>`, '<head>', ...head];
    if (stylesheet) lines.push(`<link rel="stylesheet" href="${stylesheet}">`);
    lines.push('</head>', '<body>');
    if (body) lines.push(body);
    for (const src of scripts) lines.push(`<script src="${src}"></script>`);
    lines.push('</body>', '</html>', '');
    return lines.join('\n');
}

// The name of a route's page script: / → index, /about/ → about, /docs/intro/ → docs__intro,
// every page of pages/blog/[slug]/ → blog__slug, not-found → 404.
function scriptName(route) {
    if (route.output === '404.html') return '404';
    const segments = route.dynamic ? [...route.dynamic.prefix, 'slug'] : route.path.split('/').filter(Boolean);
    return segments.length > 0 ? segments.join('__') : 'index';
}

// Drops only the blank lines around a block, so every line keeps the same indentation.
function trimBlock(html) {
    return html.replace(/^\s*\n/, '').trimEnd();
}

// cache (optional): { sfc: Map, data: Map } kept between builds, so unchanged files are not parsed again.
function createProject(reader, warn, cache) {
    const components = scanComponents(reader, warn);
    const sfcCache = new Map();
    const usageCache = new Map();

    function loadSfc(file, kind) {
        if (!sfcCache.has(file)) {
            const source = reader.read(file);
            const key = kind + '\n' + file;
            const cached = cache?.sfc.get(key);
            let sfc = cached && cached.source === source ? cached.sfc : null;
            if (!sfc) {
                sfc = parseSfc(source, file, kind);
                sfc.scopeAttr = blockText(sfc.style).trim() ? scopeAttribute(file) : null;
                cache?.sfc.set(key, { source, sfc });
            }
            sfcCache.set(file, sfc);
        }
        return sfcCache.get(file);
    }

    return {
        components,
        loadSfc,
        loadComponent: (entry) => loadSfc(entry.file, 'component'),
        usage(sfc) {
            if (!usageCache.has(sfc.file)) usageCache.set(sfc.file, propUsage(sfc));
            return usageCache.get(sfc.file);
        },
    };
}

// Renders one route: the page, then each layout around it from the nearest outwards.
// Heads merge in the opposite order: root layout → inner layouts → page.
// `item` is set only on pages made from a `[slug]` route.
function renderRoute(route, kind, options, item) {
    const { project, warn, base, data, stylesheet, scripts } = options;
    const scope = { data, route: Object.freeze({ path: route.path }), base };
    if (item !== undefined) scope.item = item;

    const page = project.loadSfc(route.file, kind);
    const layouts = route.layouts.map((file) => project.loadSfc(file, 'layout'));

    // Head elements cannot be styled, so they never get the scope attribute.
    const context = (sfc, slot, inHead = false) => ({
        file: sfc.file,
        source: sfc.source,
        scope,
        warn,
        project,
        slot,
        stack: [],
        inPlainTemplate: false,
        scopeAttr: inHead ? null : sfc.scopeAttr,
        scripted,
    });
    const scripted = new Set();

    let body = page.template ? renderNodes(page.template.children, context(page, undefined)) : '';
    for (const layout of [...layouts].reverse()) {
        body = renderNodes(layout.template.children, context(layout, { html: body }));
    }

    const heads = [...layouts, page].map((sfc) => (sfc.head ? renderNodes(sfc.head.children, context(sfc, undefined, true)) : ''));

    // A page loads components.js only if it rendered a component with a script, and its own
    // page script only if one of its files has a <script>.
    const sources = [];
    if (scripts.global) sources.push(scripts.global);
    if (scripted.size > 0) sources.push(scripts.components);
    const pageScript = scripts.page(route, [...layouts, page]);
    if (pageScript) sources.push(pageScript);

    const html = renderDocument({
        lang: data.site?.lang ?? 'bn',
        base,
        head: mergeHeads(heads, data.site?.name ?? 'Alo'),
        body: trimBlock(body),
        stylesheet,
        scripts: sources,
    });
    return applyBase(html, base);
}

// `site.url` is only the origin; a sub-path belongs to `--base`.
function checkSiteUrl(site) {
    if (!site || typeof site.url !== 'string') return;
    const file = 'data/site.json';
    let url;
    try {
        url = new URL(site.url);
    } catch {
        throw new AloError({ file, message: `\`url\` value \`${site.url}\` is not a valid URL.`, hint: 'Write the full origin, e.g. `"https://example.com"`.' });
    }
    if (!/^https?:$/.test(url.protocol) || url.pathname !== '/' || url.search || url.hash || site.url.endsWith('/')) {
        const hint = url.pathname !== '/' ? `Pass the path with \`--base\`: set \`url\` to \`"${url.origin}"\` and build with \`--base ${url.pathname}\`.` : `Write only the origin, without a trailing \`/\`: \`"${url.origin}"\`.`;
        throw new AloError({ file, message: '`url` must be just the site origin.', hint });
    }
}

// OS clutter files are skipped; everything else in public/ is copied, dotfiles like .well-known/ too.
const PUBLIC_JUNK = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

// Lists public/ files as copy instructions: { from: 'public/images/a.png', to: 'images/a.png' }.
// Files are copied byte for byte by the caller, so core never reads or writes them.
function scanPublic(reader) {
    const copies = [];
    if (!reader.exists('public')) return copies;

    function walk(dir) {
        for (const entry of reader.list(dir)) {
            if (PUBLIC_JUNK.has(entry.name)) continue;
            const from = `${dir}/${entry.name}`;
            if (entry.isDirectory) walk(from);
            else copies.push({ from, to: from.slice('public/'.length) });
        }
    }

    walk('public');
    return copies.sort((a, b) => (a.to < b.to ? -1 : a.to > b.to ? 1 : 0));
}

// A component counts as used if any page or layout reaches it, even inside an `if` branch that is false right now.
// Returns the used components' parsed files and warns about the rest.
function findUsedComponents(project, roots, warn, unused) {
    const used = new Set();
    const queue = [...roots];
    while (queue.length > 0) {
        const sfc = queue.pop();
        const nodes = [...(sfc.head?.children ?? []), ...(sfc.template?.children ?? [])];
        for (const name of referencedComponents(nodes)) {
            const entry = project.components.get(name);
            if (!entry || used.has(name)) continue;
            used.add(name);
            queue.push(project.loadComponent(entry));
        }
    }

    for (const entry of project.components.values()) {
        if (!used.has(entry.name)) {
            warn({ file: entry.file, message: `\`<${entry.name}>\` is never used.`, hint: 'Delete the file if you no longer need it.' });
        }
    }
    unused.push(...[...project.components.values()].filter((entry) => !used.has(entry.name)).map((entry) => entry.name));
    return [...used].map((name) => {
        const sfc = project.loadComponent(project.components.get(name));
        sfc.componentName = name;
        return sfc;
    });
}

// reader: { exists(path), read(path), list(dir) } with POSIX paths relative to the project root.
// Returns the output files instead of writing them, so core never touches the disk.
function compile({ reader, mode = 'build', base: rawBase = '/', cache = null }) {
    const warnings = [];
    const seen = new Set();
    const files = [];
    const unused = [];
    let copies = [];
    const base = normalizeBase(rawBase);

    // Adds a generated asset and returns its URL. In build mode the name carries the first
    // 8 hex chars of the content's SHA-256, so browsers can cache it forever.
    function addAsset(path, contents) {
        let finalPath = path;
        if (mode === 'build') {
            const hash = crypto.createHash('sha256').update(contents).digest('hex').slice(0, 8);
            finalPath = path.replace(/(\.[a-z]+)$/, `.${hash}$1`);
        }
        files.push({ path: finalPath, contents });
        return '/' + finalPath;
    }

    // The same template line inside a loop would otherwise warn once per item.
    function warn(diagnostic) {
        const key = [diagnostic.file, diagnostic.line, diagnostic.column, diagnostic.message].join('\n');
        if (seen.has(key)) return;
        seen.add(key);
        warnings.push(diagnostic);
    }

    try {
        const project = createProject(reader, warn, cache);
        const { data, collection } = createData(reader, { mode, warn, cache: cache?.data });
        checkSiteUrl(data.site);
        const { pages, notFound } = findRoutes(reader, warn);

        // Every page, layout and used component is known before rendering, so the stylesheet can be built first.
        const roots = new Set();
        for (const route of notFound ? [...pages, notFound] : pages) {
            roots.add(project.loadSfc(route.file, route === notFound ? 'not-found' : 'page'));
            for (const layout of route.layouts) roots.add(project.loadSfc(layout, 'layout'));
        }
        const components = findUsedComponents(project, roots, warn, unused);
        const globals = scanGlobal(reader, warn);
        let css = rewriteCssUrls(buildStyle({ reader, globals: globals.css, sfcs: [...roots, ...components] }), base);
        if (css && mode === 'build') css = minifyCss(css) + '\n';
        const stylesheet = css ? addAsset(STYLE_PATH, css) : null;

        const globalScript = buildGlobalScript(reader, globals.js);
        const componentScript = buildComponentScript(components.map((sfc) => ({ name: sfc.componentName, sfc })));

        // All pages of a [slug] route share one page script, so each file is built once.
        const pageScripts = new Map();
        const scripts = {
            global: globalScript ? addAsset(GLOBAL_SCRIPT_PATH, globalScript) : null,
            components: componentScript ? addAsset(COMPONENT_SCRIPT_PATH, componentScript) : null,
            page(route, sfcs) {
                const path = `assets/pages/${scriptName(route)}.js`;
                if (!pageScripts.has(path)) {
                    const code = buildPageScript(sfcs);
                    pageScripts.set(path, code ? addAsset(path, code) : null);
                }
                return pageScripts.get(path);
            },
        };

        const options = { project, warn, mode, base, data, stylesheet, scripts };
        const sources = new Map(pages.filter((page) => !page.dynamic).map((page) => [page.output, page.file]));

        const built = [];
        const emit = (route, item) => {
            const html = renderRoute(route, 'page', options, item);
            built.push({ path: route.path, html });
            files.push({ path: route.output, contents: html });
        };

        for (const page of pages) {
            if (!page.dynamic) {
                emit(page);
                continue;
            }
            for (const { item, file } of collection(page.dynamic.dataDir, page.file)) {
                const prefix = page.dynamic.prefix.map((segment) => segment + '/').join('');
                const output = `${prefix}${item.slug}/index.html`;
                if (sources.has(output)) {
                    throw new AloError({
                        file,
                        message: `\`dist/${output}\` is produced twice: by \`${sources.get(output)}\` and \`${file}\`.`,
                        hint: 'Rename the data file or the static page folder.',
                    });
                }
                sources.set(output, file);
                emit({ ...page, path: '/' + prefix + item.slug + '/', output }, item);
            }
        }

        if (notFound) files.push({ path: notFound.output, contents: renderRoute(notFound, 'not-found', options) });

        // sitemap.xml and robots.txt only in build; a file with the same name in public/ wins.
        if (mode === 'build') {
            const siteUrl = typeof data.site?.url === 'string' ? data.site.url : null;
            if (!reader.exists('public/sitemap.xml')) {
                if (siteUrl) files.push({ path: 'sitemap.xml', contents: buildSitemap(built, siteUrl, base) });
                else warn({ file: 'data/site.json', message: 'Add `url` to `data/site.json` to get a sitemap.xml.', hint: 'For example: `"url": "https://example.com"`' });
            }
            if (!reader.exists('public/robots.txt')) {
                files.push({ path: 'robots.txt', contents: buildRobots(siteUrl, base) });
            }
        }

        copies = scanPublic(reader);
        const generated = new Set(files.map((file) => file.path));
        for (const copy of copies) {
            if (generated.has(copy.to)) {
                throw new AloError({
                    file: copy.from,
                    message: `\`${copy.from}\` and the generated \`dist/${copy.to}\` would be the same file.`,
                    hint: 'Rename or move the file in public/.',
                });
            }
        }
    } catch (err) {
        if (err instanceof AloError) {
            if (err.file && err.source === undefined && reader.exists(err.file)) err.source = reader.read(err.file);
            err.warnings = warnings;
        }
        throw err;
    }

    return { files, copies, warnings, unused };
}

module.exports = { compile };
