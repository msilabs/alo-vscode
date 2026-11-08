'use strict';

const { AloError } = require('./errors.js');
const { parseYaml } = require('./yaml.js');
const { renderMarkdown } = require('./markdown.js');

const NAME = /^[a-z0-9-]+$/;
const DATED = /^(\d{4})-(\d{2})-(\d{2})(?:-(.*))?$/;
const EXTENSIONS = ['.json', '.md'];
const IMMUTABLE_HINT = 'Make a new value instead: use `toReversed()`, `toSorted()` or `slice()`.';

function byName(a, b) {
    if (a.name < b.name) return -1;
    if (a.name > b.name) return 1;
    return 0;
}

// footer-links → footerLinks
function toKey(name) {
    return name.replace(/-([a-z0-9])/g, (_, ch) => ch.toUpperCase());
}

function splitExtension(name) {
    const dot = name.lastIndexOf('.');
    return dot <= 0 ? [name, ''] : [name.slice(0, dot), name.slice(dot)];
}

const MUTATING_METHODS = ['reverse', 'sort', 'push', 'pop', 'shift', 'unshift', 'splice', 'fill', 'copyWithin'];

// A frozen array only throws when a write really happens, so `[x].reverse()` would pass quietly.
// These own, non-enumerable methods make every attempt fail the same way; copies like
// `toReversed()` or `[...list]` are ordinary arrays and are not affected.
function lockArray(array) {
    for (const method of MUTATING_METHODS) {
        Object.defineProperty(array, method, {
            value() {
                throw new AloError({ message: `\`${method}()\` changes data, so it cannot be used on data arrays.`, hint: IMMUTABLE_HINT });
            },
        });
    }
    return Object.freeze(array);
}

function deepFreeze(value) {
    if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    return Array.isArray(value) ? lockArray(value) : Object.freeze(value);
}

function isValidDate(year, month, day) {
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function position(source, offset) {
    const before = source.slice(0, offset);
    const lines = before.split('\n');
    return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

function parseJson(source, file) {
    try {
        return JSON.parse(source);
    } catch (err) {
        const at = /at position (\d+)/.exec(err.message);
        const where = at ? position(source, Number(at[1])) : position(source, source.trimEnd().length);
        throw new AloError({
            file,
            ...where,
            source,
            message: `Invalid JSON: ${err.message.replace(/ in JSON at position \d+.*$/, '')}`,
            hint: 'Check commas, quotes and brackets. JSON allows no comma after the last item, and keys need double quotes.',
        });
    }
}

// Scans data/ without reading any file. Node kinds:
//   { kind: 'object', dir, children: Map<key, node> }   data/ itself and folders with subfolders
//   { kind: 'array', dir, files: [file] }                folders with only files
//   { kind: 'file', file }
function scan(reader, dir, warn) {
    const entries = reader
        .list(dir)
        .filter((entry) => !entry.name.startsWith('.'))
        .sort(byName);

    const seen = new Map();
    const files = [];
    const folders = [];

    for (const entry of entries) {
        const path = `${dir}/${entry.name}`;
        const [base, extension] = entry.isDirectory ? [entry.name, ''] : splitExtension(entry.name);

        if (!entry.isDirectory && !EXTENSIONS.includes(extension)) {
            warn({ file: path, message: 'Only `.json` and `.md` files are read in `data/`; this file was ignored.' });
            continue;
        }
        if (!NAME.test(base)) {
            throw new AloError({
                file: path,
                message: `Name \`${entry.name}\` is not allowed in \`data/\`.`,
                hint: 'Use lowercase letters, digits and hyphens, e.g. `footer-links.json`.',
            });
        }
        if (seen.has(base)) {
            const other = seen.get(base);
            const both = entry.isDirectory || other.endsWith('/') ? 'A file and a folder share a name' : 'A `.json` and a `.md` file share a name';
            throw new AloError({ file: path, message: `${both}: \`${other}\` and \`${path}\`.`, hint: 'Keep one, and remove or rename the other.' });
        }
        seen.set(base, entry.isDirectory ? path + '/' : path);

        if (entry.isDirectory) folders.push({ key: toKey(base), dir: path });
        else files.push({ key: toKey(base), file: path });
    }

    if (folders.length === 0 && dir !== 'data') {
        return { kind: 'array', dir, files: files.map((f) => f.file) };
    }

    const children = new Map();
    for (const { key, file } of files) children.set(key, { kind: 'file', file });
    for (const { key, dir: folder } of folders) children.set(key, scan(reader, folder, warn));
    return { kind: 'object', dir, children };
}

// A .md file becomes { ...front matter, body }, where `body` is rendered only when first read.
function loadMarkdownFile(input, file) {
    const source = input.replace(/^\uFEFF/, '');
    const lines = source.split(/\r?\n/);
    let frontMatter = {};
    let body = source;

    if (/^---[ \t]*$/.test(lines[0])) {
        const end = lines.findIndex((line, i) => i > 0 && /^---[ \t]*$/.test(line));
        if (end === -1) {
            throw new AloError({ file, line: 1, column: 1, source, message: 'Front matter is not closed.', hint: 'End the front matter with another `---` line.' });
        }
        frontMatter = parseYaml(lines.slice(1, end).join('\n'), { file, lineOffset: 1, source });
        body = lines.slice(end + 1).join('\n');

        if (Object.hasOwn(frontMatter, 'body')) {
            const line = lines.findIndex((text, i) => i > 0 && i < end && /^body\s*:/.test(text)) + 1;
            throw new AloError({ file, line, column: 1, source, message: '`body` cannot be set in front matter.', hint: 'The Markdown text itself becomes `body`.' });
        }
    }

    let html = null;
    const value = {};
    for (const [key, entry] of Object.entries(frontMatter)) value[key] = deepFreeze(entry);
    Object.defineProperty(value, 'body', {
        enumerable: true,
        get() {
            if (html === null) html = renderMarkdown(body);
            return html;
        },
    });
    return Object.freeze(value);
}

function immutableError(path) {
    return new AloError({ message: `\`${path}\` cannot be changed.`, hint: IMMUTABLE_HINT });
}

// Creates the `data` value for templates. Files are read only when a template first reads them,
// and every value is deep-frozen. `loadMarkdown(source, file)` turns a .md file into an object.
// cache (optional, kept between builds by the dev server): Map<file, { source, value }>.
// A file whose text has not changed reuses its parsed value, so a Markdown body is not rendered again.
function createData(reader, { mode, warn, loadMarkdown = loadMarkdownFile, cache = null }) {
    const fileCache = new Map();
    const arrayCache = new Map();
    const proxyCache = new Map();
    const root = reader.exists('data') ? scan(reader, 'data', warn) : { kind: 'object', dir: 'data', children: new Map() };

    function loadFile(file) {
        if (!fileCache.has(file)) {
            const source = reader.read(file);
            const cached = cache?.get(file);
            const value =
                cached && cached.source === source
                    ? cached.value
                    : file.endsWith('.md')
                      ? loadMarkdown(source, file)
                      : deepFreeze(parseJson(source, file));
            cache?.set(file, { source, value });
            fileCache.set(file, value);
        }
        return fileCache.get(file);
    }

    function makeItem(file) {
        const name = file.slice(file.lastIndexOf('/') + 1);
        const [base] = splitExtension(name);
        let slug = base;
        let date = null;

        const dated = DATED.exec(base);
        if (dated) {
            const [, year, month, day, rest] = dated;
            if (!isValidDate(Number(year), Number(month), Number(day))) {
                throw new AloError({ file, message: `The date \`${year}-${month}-${day}\` in the file name is not valid.`, hint: 'Write dates as `YYYY-MM-DD`, e.g. `2026-01-10-hello-world.md`.' });
            }
            if (!rest) {
                throw new AloError({ file, message: 'The file name has no name after the date.', hint: 'For example `2026-01-10-hello-world.md`; the part after the date is the URL slug.' });
            }
            slug = rest;
            date = `${year}-${month}-${day}`;
        }

        const value = loadFile(file);
        if (value === null || typeof value !== 'object' || Array.isArray(value)) {
            throw new AloError({ file, message: 'Every file in a list folder must be an object.', hint: 'Write the JSON file as `{ ... }`.' });
        }
        if (Object.hasOwn(value, 'slug')) {
            throw new AloError({ file, message: '`slug` comes from the file name; remove it here.', hint: `This file's slug is \`${slug}\`.` });
        }
        if (date && Object.hasOwn(value, 'date')) {
            throw new AloError({ file, message: 'The date is both in the file name and in the data.', hint: 'Keep one: the date in the file name or `date` in the data.' });
        }

        // Copying descriptors keeps lazy getters (like a Markdown `body`) lazy.
        const item = Object.defineProperties({}, Object.getOwnPropertyDescriptors(value));
        item.slug = slug;
        if (date) item.date = date;
        return Object.freeze(item);
    }

    // Returns [{ item, file }] in file-name order, without drafts in build mode.
    function arrayEntries(node) {
        if (!arrayCache.has(node.dir)) {
            const bySlug = new Map();
            const entries = [];
            for (const file of node.files) {
                const item = makeItem(file);
                if (mode === 'build' && item.draft === true) continue;
                if (bySlug.has(item.slug)) {
                    throw new AloError({
                        file,
                        message: `Two files have the same slug \`${item.slug}\`: \`${bySlug.get(item.slug)}\` and \`${file}\`.`,
                        hint: 'Make the names after the date different.',
                    });
                }
                bySlug.set(item.slug, file);
                entries.push({ item, file });
            }
            arrayCache.set(node.dir, { entries, items: lockArray(entries.map((entry) => entry.item)) });
        }
        return arrayCache.get(node.dir);
    }

    function valueOf(node) {
        if (node.kind === 'file') return loadFile(node.file);
        if (node.kind === 'array') return arrayEntries(node).items;
        return objectProxy(node);
    }

    function objectProxy(node) {
        if (proxyCache.has(node.dir)) return proxyCache.get(node.dir);
        const path = node.dir.replace(/\//g, '.');
        const read = (key) => (typeof key === 'string' && node.children.has(key) ? valueOf(node.children.get(key)) : undefined);

        // The target stays empty and unfrozen, so the traps may report lazily loaded values without
        // breaking proxy invariants; writes are refused by the traps instead.
        const proxy = new Proxy(
            {},
            {
                get: (_, key) => read(key),
                has: (_, key) => typeof key === 'string' && node.children.has(key),
                ownKeys: () => [...node.children.keys()],
                getOwnPropertyDescriptor: (_, key) =>
                    typeof key === 'string' && node.children.has(key)
                        ? { get: () => read(key), enumerable: true, configurable: true }
                        : undefined,
                set: (_, key) => {
                    throw immutableError(`${path}.${String(key)}`);
                },
                defineProperty: (_, key) => {
                    throw immutableError(`${path}.${String(key)}`);
                },
                deleteProperty: (_, key) => {
                    throw immutableError(`${path}.${String(key)}`);
                },
                setPrototypeOf: () => {
                    throw immutableError(path);
                },
            },
        );
        proxyCache.set(node.dir, proxy);
        return proxy;
    }

    // The array behind a `[slug]` route, e.g. `data/blog` for `pages/blog/[slug]/`.
    function collection(dir, pageFile) {
        const segments = dir.split('/').slice(1);
        let node = root;
        for (const segment of segments) {
            node = node.kind === 'object' ? node.children.get(toKey(segment)) : undefined;
            if (!node) break;
        }
        if (!node || node.kind !== 'array' || node.files.length === 0) {
            const folder = pageFile.slice(0, pageFile.lastIndexOf('/') + 1);
            throw new AloError({
                file: pageFile,
                message: `Add JSON or Markdown files to \`${dir}/\` for \`${folder}\`.`,
                hint: node && node.kind !== 'array' ? `\`${dir}/\` has subfolders, so it is not a list.` : `Each file becomes one page, e.g. \`${dir}/2026-01-10-hello-world.md\`.`,
            });
        }
        return arrayEntries(node).entries;
    }

    return { data: objectProxy(root), collection };
}

module.exports = { createData, toKey, loadMarkdownFile };
