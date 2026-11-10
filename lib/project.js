'use strict';

const fs = require('fs');
const path = require('path');

// Alo's core is not a public API, so only the major version this extension was written for is used.
const SUPPORTED_MAJOR = 1;
const BUNDLED = path.join(__dirname, '..', 'alo-core');

function isDirectory(p) {
    try {
        return fs.statSync(p).isDirectory();
    } catch {
        return false;
    }
}

function readVersion(packageDir) {
    try {
        return JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8')).version;
    } catch {
        return null;
    }
}

// The Alo project a file belongs to: the nearest folder above it that has a `pages/` folder.
function findProjectRoot(file) {
    let dir = path.dirname(file);
    while (true) {
        if (isDirectory(path.join(dir, 'pages'))) return dir;
        const parent = path.dirname(dir);
        if (parent === dir) return null;
        dir = parent;
    }
}

// Looks for `node_modules/@msilabs/alo` from the project folder upwards, the way Node does.
function findInstalledAlo(root) {
    let dir = root;
    while (true) {
        const candidate = path.join(dir, 'node_modules', '@msilabs', 'alo');
        if (isDirectory(path.join(candidate, 'core'))) return candidate;
        const parent = path.dirname(dir);
        if (parent === dir) return null;
        dir = parent;
    }
}

// Prefers the project's own Alo, so the editor follows the same rules as `node alo build`.
// Falls back to the copy in `alo-core/` when it is missing or has a different major version.
// In a folder that is not trusted (VS Code's Restricted Mode) the project's own Alo is never run:
// it is code from the folder, and the folder may have come from anywhere.
function locateCore(root, { trusted = true } = {}) {
    const installed = findInstalledAlo(root);
    if (installed && !trusted) {
        return { dir: BUNDLED, version: readVersion(BUNDLED), source: 'bundled', untrusted: { dir: installed } };
    }
    if (installed) {
        const version = readVersion(installed);
        const major = Number(String(version).split('.')[0]);
        if (major === SUPPORTED_MAJOR) return { dir: installed, version, source: 'project' };
        return { dir: BUNDLED, version: readVersion(BUNDLED), source: 'bundled', skipped: { dir: installed, version } };
    }
    return { dir: BUNDLED, version: readVersion(BUNDLED), source: 'bundled' };
}

function loadCore(root, options) {
    const location = locateCore(root, options);
    const load = (name) => require(path.join(location.dir, 'core', name + '.js'));
    // Alo's CLI (`alo new`, `alo dev`, `alo build`) from the same place as the core.
    const loadCli = (name) => require(path.join(location.dir, 'cli', name + '.js'));
    return { ...location, load, loadCli, bin: path.join(location.dir, 'bin', 'alo.js') };
}

// The same reader shape that Alo's CLI passes to `compile`: POSIX paths relative to the root.
function createFsReader(root) {
    const resolve = (relative) => path.join(root, ...relative.split('/'));
    return {
        exists(relative) {
            return fs.existsSync(resolve(relative));
        },
        read(relative) {
            return fs.readFileSync(resolve(relative), 'utf8');
        },
        list(relative) {
            return fs
                .readdirSync(resolve(relative), { withFileTypes: true })
                .map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }));
        },
    };
}

// Every component as { name, file }, e.g. { name: 'Blog.PostCard', file: 'components/blog/PostCard.alo' },
// found by Alo's own code. Throws Alo's error if a file or folder name is not allowed.
function listComponents(root, core) {
    const { scanComponents } = core.load('components');
    return [...scanComponents(createFsReader(root), () => {}).values()];
}

// The `props.x` names a component's template reads, found by Alo's own code.
// `dynamic` is true when it also reads props in a way that cannot be listed, like `props[key]`.
// Throws Alo's error if the component file itself is broken.
function componentProps(source, file, core) {
    const sfc = core.load('sfc').parseSfc(source, file, 'component');
    const usage = core.load('components').propUsage(sfc);
    return { props: [...usage.props].sort(), dynamic: usage.dynamic };
}

// The closest component name to a mistyped one, e.g. `Card` for `Crad`, or null.
function suggestComponent(name, components, core) {
    return core.load('errors').suggest(name, components.map((component) => component.name));
}

// What each page and layout file makes, for the lines above them in the editor:
// a page → { kind: 'page', path: '/about/', open: '/about/' },
// a [slug] page → { kind: 'page', path: '/blog/:slug/', open: '/blog/first/', count: 5 },
// a layout → { kind: 'layout', count: 4 } (the pages it wraps).
function routeInfo(root, core) {
    const reader = createFsReader(root);
    const { pages, notFound } = core.load('routes').findRoutes(reader, () => {});
    let collection = null;
    try {
        collection = core.load('data').createData(reader, { mode: 'dev', warn: () => {} }).collection;
    } catch {
        // Broken data: the [slug] pages just show no count.
    }

    const info = new Map();
    for (const page of notFound ? [...pages, notFound] : pages) {
        let made = 1;
        if (page.dynamic) {
            let slugs = [];
            try {
                slugs = collection ? collection(page.dynamic.dataDir, page.file).map((entry) => entry.item.slug) : [];
            } catch {
                // No files in the folder yet.
            }
            const prefix = page.dynamic.prefix.length > 0 ? '/' + page.dynamic.prefix.join('/') : '';
            info.set(page.file, { kind: 'page', path: `${prefix}/:slug/`, open: slugs[0] ? `${prefix}/${slugs[0]}/` : null, count: slugs.length });
            made = slugs.length;
        } else {
            info.set(page.file, { kind: 'page', path: page.path, open: page.path });
        }
        for (const layout of page.layouts) {
            const entry = info.get(layout) ?? { kind: 'layout', count: 0 };
            entry.count += made;
            info.set(layout, entry);
        }
    }
    return info;
}

// Counts pages and components with Alo's own code. Throws Alo's error if the project is broken.
function summarize(root, core) {
    const { findRoutes } = core.load('routes');
    const { pages } = findRoutes(createFsReader(root), () => {});
    return { pages: pages.length, components: listComponents(root, core).length };
}

module.exports = {
    findProjectRoot,
    loadCore,
    createFsReader,
    listComponents,
    componentProps,
    suggestComponent,
    routeInfo,
    summarize,
    SUPPORTED_MAJOR,
};
