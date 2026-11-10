'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { AloError, suggest } = require('../core/errors.js');
const log = require('./log.js');
const { version } = require('../package.json');

const TEMPLATE_DIR = path.join(__dirname, '..', 'templates', 'init');
// A folder holding only these still counts as empty, so `git init` before `alo init` is fine.
const IGNORABLE = new Set(['.git', '.DS_Store', 'Thumbs.db']);

const ROOT_SCRIPT = `#!/usr/bin/env node
try {
    require('@msilabs/alo/cli');
} catch (e) {
    if (
        e.code === 'MODULE_NOT_FOUND' &&
        String(e.message).includes('@msilabs/alo')
    ) {
        console.error('Alo is not installed. Run \`npm install\` first.');
        process.exit(1);
    }
    throw e;
}
`;

const GITIGNORE = 'node_modules/\ndist/\n.alo/\n';
const GITATTRIBUTES = '*.alo linguist-language=HTML\n';
// VS Code suggests installing the Alo extension when the project is opened.
const VSCODE_EXTENSIONS = `{
    "recommendations": ["msilabs.alo-vscode"]
}
`;
// No "files.associations" for .alo: it would override the extension's own `alo` language.
const VSCODE_SETTINGS = `{
    "workbench.editor.customLabels.patterns": {
        "**/pages/**/page.alo": "\${dirname} (page)",
        "**/pages/**/layout.alo": "\${dirname} (layout)"
    }
}
`;

function packageName(folder) {
    const name = path
        .basename(folder)
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return name || 'my-site';
}

function packageJson(name) {
    const data = {
        name,
        private: true,
        engines: { node: '>=22' },
        scripts: { dev: 'alo dev', build: 'alo build' },
        devDependencies: { '@msilabs/alo': `^${version}` },
    };
    return JSON.stringify(data, null, 4) + '\n';
}

function writeNew(file, contents) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
}

function init(cwd, folder = '.') {
    const target = path.resolve(cwd, folder);
    if (fs.existsSync(target)) {
        if (!fs.statSync(target).isDirectory()) {
            throw new AloError({ message: `\`${folder}\` is a file, not a folder.`, hint: 'Choose another name for the new project.' });
        }
        const contents = fs.readdirSync(target).filter((name) => !IGNORABLE.has(name));
        if (contents.length > 0) {
            throw new AloError({
                message: `The folder \`${folder}\` is not empty, so no project was created.`,
                hint: 'Use a new name, e.g. `npx @msilabs/alo init my-site`, or run it in an empty folder.',
            });
        }
    }

    fs.mkdirSync(target, { recursive: true });
    fs.cpSync(TEMPLATE_DIR, target, { recursive: true });
    writeNew(path.join(target, 'alo'), ROOT_SCRIPT);
    fs.chmodSync(path.join(target, 'alo'), 0o755);
    writeNew(path.join(target, 'package.json'), packageJson(packageName(target)));
    writeNew(path.join(target, '.gitignore'), GITIGNORE);
    writeNew(path.join(target, '.gitattributes'), GITATTRIBUTES);
    writeNew(path.join(target, '.vscode', 'settings.json'), VSCODE_SETTINGS);
    writeNew(path.join(target, '.vscode', 'extensions.json'), VSCODE_EXTENSIONS);

    const relative = path.relative(cwd, target);
    const steps = [];
    if (relative) steps.push(`cd ${relative.includes(' ') ? JSON.stringify(relative) : relative}`);
    steps.push('npm install', 'node alo dev');
    log.success(`Created a new Alo project: ${relative || '.'}`);
    log.info(`\nNext steps:\n${steps.map((step) => '  ' + step).join('\n')}\n`);
}

// ---------------------------------------------------------------- alo new

const PLAIN = /^[a-z0-9-]+$/;
const GROUP = /^\([a-z0-9-]+\)$/;
const PASCAL = /^[A-Z][A-Za-z0-9]*$/;
const KINDS = ['page', 'layout', 'component', 'post'];

function usage(kind) {
    return {
        page: '`alo new page blog/first-post`',
        layout: '`alo new layout blog`',
        component: '`alo new component Card` or `alo new component blog/PostCard`',
        post: '`alo new post blog/hello-world`',
    }[kind];
}

function splitName(name) {
    return String(name)
        .replace(/\\/g, '/')
        .split('/')
        .filter((part) => part !== '' && part !== '.');
}

function checkPageSegments(segments, kind) {
    segments.forEach((segment, i) => {
        if (PLAIN.test(segment) || GROUP.test(segment)) return;
        if (segment === '[slug]' && kind === 'page' && i === segments.length - 1) return;
        throw new AloError({
            message: `Folder name \`${segment}\` is not allowed.`,
            hint:
                segment === '[slug]'
                    ? '`[slug]` can only be the last part of a page path, e.g. `alo new page blog/[slug]`.'
                    : 'Use lowercase letters, digits and hyphens; `(name)` for a route group.',
        });
    });
}

function urlOf(segments) {
    const visible = segments.filter((segment) => !GROUP.test(segment));
    return '/' + visible.map((segment) => segment + '/').join('');
}

function pageTemplate(segments) {
    if (segments[segments.length - 1] === '[slug]') {
        return `<head>
    <title>{{ item.title }}</title>
</head>

<template>
    <article>
        <h1>{{ item.title }}</h1>
        {{{ item.body }}}
    </article>
</template>
`;
    }
    const title = segments.filter((s) => !GROUP.test(s)).pop()?.replace(/-/g, ' ') || 'হোম';
    return `<head>
    <title>${title}</title>
</head>

<template>
    <h1>${title}</h1>
</template>
`;
}

const LAYOUT_TEMPLATE = `<template>
    <slot />
</template>
`;

function componentTemplate(name) {
    const className = name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
    return `<template>
    <div class="${className}">
        <slot />
    </div>
</template>
`;
}

function today() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// Returns { file, contents, note } for one `alo new` request.
function plan(kind, name) {
    const segments = splitName(name);

    if (kind === 'page') {
        checkPageSegments(segments, 'page');
        const file = ['pages', ...segments, 'page.alo'].join('/');
        const last = segments[segments.length - 1];
        const note = last === '[slug]' ? `Put the data in \`data/${segments.slice(0, -1).filter((s) => !GROUP.test(s)).join('/')}/\`` : `URL: ${urlOf(segments)}`;
        return { file, contents: pageTemplate(segments), note };
    }

    if (kind === 'layout') {
        checkPageSegments(segments, 'layout');
        return { file: ['pages', ...segments, 'layout.alo'].join('/'), contents: LAYOUT_TEMPLATE, note: `Wraps every page under ${urlOf(segments)}` };
    }

    if (kind === 'component') {
        const componentName = segments.pop();
        if (!componentName || !PASCAL.test(componentName)) {
            const fixed = (componentName ?? '').replace(/(^|[-_ ]+)([a-zA-Z0-9])/g, (_, __, ch) => ch.toUpperCase());
            throw new AloError({
                message: `Component name \`${componentName ?? ''}\` is not PascalCase.`,
                hint: PASCAL.test(fixed) ? `For example \`${fixed}\`: a capital first letter, words joined.` : 'Start with a capital letter, e.g. `Card` or `PostCard`.',
            });
        }
        for (const folder of segments) {
            if (!PLAIN.test(folder)) {
                throw new AloError({ message: `Folder name \`${folder}\` is not allowed.`, hint: 'Component folders use lowercase kebab-case, e.g. `blog` or `post-list`.' });
            }
        }
        const tag = [...segments.map((s) => s.replace(/(^|-)([a-z0-9])/g, (_, __, ch) => ch.toUpperCase())), componentName].join('.');
        return { file: ['components', ...segments, componentName + '.alo'].join('/'), contents: componentTemplate(componentName), note: `Use it as <${tag} />` };
    }

    // post
    const slug = segments.pop();
    if (segments.length === 0 || !slug) {
        throw new AloError({ message: 'Give both a folder and a name for the post.', hint: usage('post') });
    }
    for (const part of [...segments, slug]) {
        if (!PLAIN.test(part)) {
            throw new AloError({ message: `Name \`${part}\` is not allowed.`, hint: 'Use lowercase letters, digits and hyphens, e.g. `blog/hello-world`.' });
        }
    }
    const file = ['data', ...segments, `${today()}-${slug}.md`].join('/');
    const contents = `---\ntitle: ${slug.replace(/-/g, ' ')}\ndraft: true\n---\n\nএখানে লেখা শুরু করুন।\n`;
    return { file, contents, note: 'Draft: remove `draft: true` to include it in the build' };
}

function create(cwd, args) {
    const [kind, name] = args;
    if (!kind) {
        throw new AloError({ message: 'Tell Alo what to create.', hint: KINDS.map((k) => usage(k)).join('\n') });
    }
    if (!KINDS.includes(kind)) {
        const close = suggest(kind, KINDS);
        throw new AloError({
            message: `There is no \`alo new ${kind}\`.`,
            hint: (close ? `Did you mean \`alo new ${close}\`?\n` : '') + `You can create: ${KINDS.map((k) => `\`${k}\``).join(', ')}.`,
        });
    }
    // `alo new page .` is allowed and makes the home page; every other kind needs a real name.
    if (name === undefined || (kind !== 'page' && splitName(name).length === 0)) {
        throw new AloError({ message: `\`alo new ${kind}\` needs a name.`, hint: `For example: ${usage(kind)}` });
    }
    if (!fs.existsSync(path.join(cwd, 'pages'))) {
        throw new AloError({ message: 'No `pages/` folder here. Are you in the project root?', hint: 'Start a new project with `npx @msilabs/alo init`.' });
    }

    const { file, contents, note } = plan(kind, name);
    const target = path.join(cwd, ...file.split('/'));

    // A post with the same slug (whatever its date) would clash at build time.
    if (kind === 'post' && fs.existsSync(path.dirname(target))) {
        const slug = path.basename(file).replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, '');
        const twin = fs.readdirSync(path.dirname(target)).find((entry) => entry.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.(md|json)$/, '') === slug);
        if (twin) {
            throw new AloError({ message: `A post with the slug \`${slug}\` already exists: \`${path.posix.join(path.posix.dirname(file), twin)}\`.`, hint: 'Choose another name; posts with the same slug share a URL even with different dates.' });
        }
    }

    if (fs.existsSync(target)) {
        throw new AloError({ message: `\`${file}\` already exists, so nothing was created.`, hint: 'Choose another name, or open the file and edit it.' });
    }
    writeNew(target, contents);
    log.success(`Created ${file}`);
    log.dim(`  ${note}`);
}

module.exports = { init, create, plan, packageName };
