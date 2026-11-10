'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { findProjectRoot, loadCore, listComponents, componentProps, suggestComponent, summarize } = require('../../lib/project');

// The Alo repo is expected next to this one, as in `frameworks/alo` and `frameworks/alo-vscode`.
const ALO = path.resolve(__dirname, '..', '..', '..', 'alo');
const EXAMPLE = path.join(ALO, 'example');
const hasAlo = fs.existsSync(EXAMPLE);

function tempProject(files = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alo-vscode-'));
    fs.mkdirSync(path.join(root, 'pages'));
    for (const [file, content] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        fs.writeFileSync(path.join(root, file), content);
    }
    return root;
}

function installAlo(dir, target = ALO) {
    fs.mkdirSync(path.join(dir, 'node_modules', '@msilabs'), { recursive: true });
    fs.symlinkSync(target, path.join(dir, 'node_modules', '@msilabs', 'alo'));
}

test('findProjectRoot walks up to the folder that has pages/', { skip: !hasAlo }, () => {
    assert.equal(findProjectRoot(path.join(EXAMPLE, 'pages', '(site)', 'blog', '[slug]', 'page.alo')), EXAMPLE);
    assert.equal(findProjectRoot(path.join(EXAMPLE, 'components', 'blog', 'PostCard.alo')), EXAMPLE);
    assert.equal(findProjectRoot(path.join(os.tmpdir(), 'no-such-project', 'x.alo')), null);
});

test('without node_modules the bundled core is used', () => {
    const core = loadCore(tempProject());
    assert.equal(core.source, 'bundled');
    assert.match(core.version, /^1\./);
});

test("the project's own Alo 1.x is preferred", { skip: !hasAlo }, () => {
    const root = tempProject({ 'pages/page.alo': '<template><h1>hi</h1></template>' });
    installAlo(root);
    const core = loadCore(root);
    assert.equal(core.source, 'project');
    assert.deepEqual(summarize(root, core), { pages: 1, components: 0 });
});

test('node_modules above the project is found too', { skip: !hasAlo }, () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'alo-vscode-mono-'));
    const root = path.join(parent, 'site');
    fs.mkdirSync(path.join(root, 'pages'), { recursive: true });
    installAlo(parent);
    assert.equal(loadCore(root).source, 'project');
});

test('an unsupported major version falls back to the bundled core', () => {
    const root = tempProject({ 'node_modules/@msilabs/alo/package.json': '{"version":"2.0.0"}' });
    fs.mkdirSync(path.join(root, 'node_modules', '@msilabs', 'alo', 'core'));
    const core = loadCore(root);
    assert.equal(core.source, 'bundled');
    assert.equal(core.skipped.version, '2.0.0');
});

test('listComponents uses dot notation for folders', () => {
    const root = tempProject({
        'components/Card.alo': '<template></template>',
        'components/blog/PostCard.alo': '<template></template>',
        'components/post-list/Item.alo': '<template></template>',
    });
    const names = listComponents(root, loadCore(root)).map((c) => `${c.name} ${c.file}`);
    assert.deepEqual(names.sort(), [
        'Blog.PostCard components/blog/PostCard.alo',
        'Card components/Card.alo',
        'PostList.Item components/post-list/Item.alo',
    ]);
});

test("a broken project throws Alo's own error", () => {
    const root = tempProject();
    fs.mkdirSync(path.join(root, 'components', 'Bad_Folder'), { recursive: true });
    assert.throws(() => summarize(root, loadCore(root)), { name: 'AloError', message: /Bad_Folder/ });
});

test('componentProps lists the props a component reads', () => {
    const core = loadCore(tempProject());
    const source = '<template><p class="{{ props.class }}">{{ props.postDate }}</p><slot /></template>';
    assert.deepEqual(componentProps(source, 'components/X.alo', core), { props: ['class', 'postDate'], dynamic: false });
    assert.deepEqual(componentProps('<template><p>hi</p></template>', 'components/Y.alo', core), { props: [], dynamic: false });
});

test("componentProps throws Alo's error for a broken component", () => {
    const core = loadCore(tempProject());
    assert.throws(() => componentProps('<head></head><template></template>', 'components/Z.alo', core), { name: 'AloError' });
});

test('suggestComponent finds the closest name', () => {
    const core = loadCore(tempProject());
    const components = [{ name: 'Card' }, { name: 'Header' }, { name: 'Blog.PostCard' }];
    assert.equal(suggestComponent('Crad', components, core), 'Card');
    assert.equal(suggestComponent('Blog.PostCrd', components, core), 'Blog.PostCard');
    assert.equal(suggestComponent('Zzzzzzzz', components, core), null);
});
