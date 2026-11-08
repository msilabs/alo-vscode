'use strict';

const { AloError } = require('./errors.js');

const PLAIN_FOLDER = /^[a-z0-9-]+$/;
const GROUP_FOLDER = /^\([a-z0-9-]+\)$/;
const ROUTE_FILES = ['page.alo', 'layout.alo', 'not-found.alo'];

function byName(a, b) {
    if (a.name < b.name) return -1;
    if (a.name > b.name) return 1;
    return 0;
}

function checkFolderName(name, file, afterSlug) {
    if (GROUP_FOLDER.test(name)) return 'group';
    if (name === '[slug]') {
        if (afterSlug) {
            throw new AloError({ file, message: 'A path can contain `[slug]` only once.', hint: 'Dynamic routes have one level; remove the inner `[slug]`.' });
        }
        return 'slug';
    }
    if (/^\[.*\]$/.test(name)) {
        throw new AloError({ file, message: `Dynamic folder name \`${name}\` is not allowed.`, hint: 'A dynamic folder is always named `[slug]`.' });
    }
    if (!PLAIN_FOLDER.test(name)) {
        throw new AloError({
            file,
            message: `Folder name \`${name}\` is not allowed in \`pages/\`.`,
            hint: 'Use lowercase letters, digits and hyphens; `(name)` for a route group, `[slug]` for a dynamic route.',
        });
    }
    if (afterSlug) {
        throw new AloError({ file, message: '`[slug]` must be the last folder in the path.', hint: 'Put only `page.alo` inside `[slug]`.' });
    }
    return 'plain';
}

function urlFor(segments) {
    return '/' + segments.map((segment) => segment + '/').join('');
}

// Scans pages/ and returns:
//   pages: [{ file, path, output, layouts, dynamic: null | { dataDir, prefix } }]
//   notFound: null | { file, path, output, layouts }
// Route groups `(name)` stay out of the URL but still take part in the layout chain.
function findRoutes(reader, warn) {
    if (!reader.exists('pages')) {
        throw new AloError({
            message: 'No `pages/` folder here. Are you in the project root?',
            hint: 'Start a new project with `npx @msilabs/alo init`.',
        });
    }

    const pages = [];
    let notFound = null;
    const outputs = new Map();

    function claim(output, file) {
        const other = outputs.get(output);
        if (other) {
            throw new AloError({
                file,
                message: `\`dist/${output}\` is produced twice: by \`${other}\` and \`${file}\`.`,
                hint: 'Route groups `(name)` do not count in the URL; remove one page or move it.',
            });
        }
        outputs.set(output, file);
    }

    // Returns how many pages live at or below `dir`, for the "layout without pages" warning.
    function walk(dir, segments, layouts, slug) {
        const entries = reader
            .list(dir)
            .filter((entry) => !entry.name.startsWith('.'))
            .sort(byName);
        const ownLayout = entries.find((entry) => !entry.isDirectory && entry.name === 'layout.alo');
        const chain = ownLayout ? [...layouts, `${dir}/layout.alo`] : layouts;
        let count = 0;

        for (const entry of entries) {
            const file = `${dir}/${entry.name}`;

            if (entry.isDirectory) {
                const kind = checkFolderName(entry.name, file, slug !== null);
                if (kind === 'group') count += walk(file, segments, chain, slug);
                else if (kind === 'slug') count += walk(file, segments, chain, { prefix: segments });
                else count += walk(file, [...segments, entry.name], chain, slug);
                continue;
            }

            if (entry.name === 'page.alo') {
                count++;
                if (slug) {
                    const pattern = [...slug.prefix, '[slug]'].join('/') + '/index.html';
                    claim(pattern, file);
                    pages.push({ file, layouts: chain, dynamic: { dataDir: ['data', ...slug.prefix].join('/'), prefix: slug.prefix } });
                } else {
                    const output = segments.map((s) => s + '/').join('') + 'index.html';
                    claim(output, file);
                    pages.push({ file, path: urlFor(segments), output, layouts: chain, dynamic: null });
                }
            } else if (entry.name === 'not-found.alo') {
                if (dir === 'pages') {
                    notFound = { file, path: '/404.html', output: '404.html', layouts: ownLayout ? ['pages/layout.alo'] : [] };
                } else {
                    warn({ file, message: '`not-found.alo` only works at the root of `pages/`; this one was ignored.', hint: 'Move it to `pages/not-found.alo`.' });
                }
            } else if (entry.name.endsWith('.alo') && !ROUTE_FILES.includes(entry.name)) {
                warn({ file, message: `\`${entry.name}\` is not used in \`pages/\`.`, hint: 'Put components in `components/`. `pages/` only holds `page.alo`, `layout.alo` and `not-found.alo`.' });
            } else if (!entry.name.endsWith('.alo')) {
                warn({ file, message: `\`${entry.name}\` is not used in \`pages/\`.`, hint: 'Put images and other files in `public/`, and data in `data/`.' });
            }
        }

        if (ownLayout && count === 0) {
            warn({ file: `${dir}/layout.alo`, message: 'No `page.alo` uses this layout.', hint: 'Remove the layout if you do not need it.' });
        }
        return count;
    }

    walk('pages', [], [], null);
    return { pages, notFound };
}

module.exports = { findRoutes, urlFor };
