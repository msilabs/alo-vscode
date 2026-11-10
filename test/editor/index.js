'use strict';

// Runs inside VS Code (started by test/editor/run.js). Each check prints PASS or FAIL with what it saw.

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const TEMP = path.resolve(__dirname, '..', '..', '.vscode-test');
const RESULTS = path.join(TEMP, 'results.txt');
const ALO_REPO = path.resolve(__dirname, '..', '..', '..', 'alo');

const lines = [];
const log = (line) => {
    lines.push(line);
    fs.writeFileSync(RESULTS, lines.join('\n') + '\n');
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let WS;

async function check(name, fn) {
    try {
        const { ok, text } = await fn();
        log(`${ok ? 'PASS' : 'FAIL'}  ${name}  →  ${JSON.stringify(text)}`);
    } catch (err) {
        log(`ERROR ${name}  →  ${err.stack || err.message}`);
    }
}

async function open(file) {
    const document = await vscode.workspace.openTextDocument(path.isAbsolute(file) ? file : path.join(WS, file));
    const editor = await vscode.window.showTextDocument(document);
    await sleep(250);
    return editor;
}

// Writes a file in the test workspace and opens it.
async function fresh(file, content = '') {
    const full = path.isAbsolute(file) ? file : path.join(WS, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
    return open(full);
}

async function revert() {
    await vscode.commands.executeCommand('workbench.action.files.revert');
    await sleep(100);
}

function findLine(document, text) {
    for (let i = 0; i < document.lineCount; i++) if (document.lineAt(i).text.includes(text)) return i;
    throw new Error('line not found: ' + text);
}

// For things that happen a moment later: a debounced check, the file watcher.
async function waitUntil(condition, tries = 40) {
    for (let i = 0; i < tries; i++) {
        if (await condition()) return true;
        await sleep(150);
    }
    return false;
}

const labelOf = (item) => (typeof item.label === 'string' ? item.label : item.label.label);

async function completions(editor, offset, trigger) {
    const position = editor.document.positionAt(offset);
    const list = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', editor.document.uri, position, trigger);
    return list.items;
}

// `|` marks the cursor.
async function completionsAt(file, textWithCursor, trigger) {
    const offset = textWithCursor.indexOf('|');
    const editor = await fresh(file, textWithCursor.replace('|', ''));
    return { editor, items: await completions(editor, offset, trigger) };
}

// ---------------------------------------------------------------- step 2–3: typing and comments

async function toggleComment(file, marker) {
    const editor = await open(file);
    const line = findLine(editor.document, marker);
    const column = editor.document.lineAt(line).firstNonWhitespaceCharacterIndex + 2;
    editor.selection = new vscode.Selection(line, column, line, column);
    await vscode.commands.executeCommand('editor.action.commentLine');
    await sleep(150);
    const text = editor.document.lineAt(line).text.trim();
    await revert();
    return text;
}

async function typeAtLineEnd(file, marker, chars) {
    const editor = await open(file);
    const line = findLine(editor.document, marker);
    const end = editor.document.lineAt(line).text.length;
    editor.selection = new vscode.Selection(line, end, line, end);
    for (const ch of chars) {
        await vscode.commands.executeCommand('type', { text: ch });
        await sleep(120);
    }
    const text = editor.document.lineAt(line).text.trim();
    const cursor = editor.selection.active.character - editor.document.lineAt(line).firstNonWhitespaceCharacterIndex;
    await revert();
    return { text, cursor };
}

async function typingAndComments() {
    const counter = 'components/Counter.alo';
    await check('Cmd+/ in <script> gives //', async () => {
        const text = await toggleComment(counter, 'count += Number');
        return { ok: text.startsWith('//'), text };
    });
    await check('Cmd+/ in <style> gives /*', async () => {
        const text = await toggleComment(counter, 'display:');
        return { ok: text.startsWith('/*'), text };
    });
    await check('Cmd+/ in <template> gives <!--', async () => {
        const text = await toggleComment(counter, '<output');
        return { ok: text.startsWith('<!--'), text };
    });
    await check('Cmd+/ in a page <style> gives /*', async () => {
        const text = await toggleComment('pages/(site)/page.alo', 'padding-block: 6rem');
        return { ok: text.startsWith('/*'), text };
    });
    await check('{{ becomes {{ | }}', async () => {
        const r = await typeAtLineEnd(counter, '<output', '{{');
        return { ok: r.text.endsWith('{{  }}') && r.cursor === r.text.length - 3, text: `${r.text} cursor@${r.cursor}` };
    });
    await check('{{{ becomes {{{ | }}}', async () => {
        const r = await typeAtLineEnd(counter, '<output', '{{{');
        return { ok: r.text.endsWith('{{{  }}}'), text: r.text };
    });
    await check('<div> gets </div>', async () => {
        const r = await typeAtLineEnd(counter, '<output', '<div>');
        return { ok: r.text.endsWith('<div></div>'), text: r.text };
    });
    await check('{{ inside <script> is left alone', async () => {
        const r = await typeAtLineEnd(counter, 'count += Number', '{{');
        return { ok: !r.text.includes('{{  }}'), text: r.text };
    });
}

// ---------------------------------------------------------------- step 3–4: grammar

async function tokensOf(file) {
    return vscode.commands.executeCommand('_workbench.captureSyntaxTokens', vscode.Uri.file(file));
}

const E = 'meta.embedded.expression.alo';
const JS = 'source.js';

const GRAMMAR_CASES = [
    ['{{ }} in text', '<p>{{ props.title }}</p>', [
        ['{{', 'punctuation.section.embedded.begin.alo'],
        ['props', [E, JS]],
        ['}}', 'punctuation.section.embedded.end.alo'],
        ['p', 'entity.name.tag.html', JS, 1],
    ]],
    ['{{{ }}} raw', '<div>{{{ item.body }}}</div>', [
        ['item', ['meta.embedded.expression.raw.alo', JS]],
    ]],
    ['\\{{ escape', '<p>\\{{ x }}</p>', [
        ['\\{{', 'constant.character.escape.alo'],
    ]],
    ['{{ }} inside an attribute', '<a href="/blog/{{ post.slug }}/">x</a>', [
        ['post', [E, JS, 'string.quoted.double.html']],
        ['>', 'punctuation.definition.tag.end.html'],
    ]],
    ['< inside {{ }} is not an error', '<p>{{ a < b ? 1 : 2 }}</p>', [
        ['<', JS, null, 1],
    ]],
    ['template for', '<template for="(post, i) in data.blog"><li>{{ i }}</li></template>', [
        ['for', 'keyword.control.alo'],
        ['in', ['keyword.operator.expression.in.js', JS]],
        ['li', 'entity.name.tag.html', JS],
    ]],
    ['template if with >', '<template if="stock > 10"><span>ok</span></template>', [
        ['if', 'keyword.control.alo'],
        ['>', JS],
        ['span', 'entity.name.tag.html', JS],
    ]],
    ['template else-if / else', "<template else-if='a > 0'>a</template><template else>b</template>", [
        ['else-if', 'keyword.control.alo'],
        ['else', 'keyword.control.alo'],
    ]],
    ['if on <li> is a plain attribute', '<li if="x">a</li>', [
        ['if', 'entity.other.attribute-name.html', 'keyword.control.alo'],
    ]],
    ['component tags', '<Card title="{{ post.title }}" featured />\n<Blog.PostCard></Blog.PostCard>', [
        ['Card', 'support.class.component.alo'],
        ['post', [E, JS]],
        ['Blog.PostCard', 'support.class.component.alo'],
        ['Blog.PostCard', 'support.class.component.alo', null, 1],
    ]],
    ['multi-line component', '<Card\n    title="x"\n/>\n<p>after</p>', [
        ['title', 'entity.other.attribute-name.html'],
        ['p', 'entity.name.tag.html', 'meta.tag.component.alo'],
    ]],
    ['<script> and <style> untouched', '<script>\n    const x = { a: { b: 1 }};\n</script>\n<style>\n    a { color: red; }\n</style>', [
        ['}', JS, 'punctuation.section.embedded.end.alo', 1],
        ['color', 'source.css', E],
    ]],
    ['<slot /> is valid', '<article>\n    <slot />\n</article>', [
        // VS Code joins neighbouring tokens with the same scopes, so `/` and `>` come as one.
        ['/>', 'punctuation.definition.tag.end.html'],
    ]],
    ['template logic inside <svg>', '<svg>\n  <template if="a">\n    <path d="M8 7" />\n  </template>\n</svg>\n<p>after</p>', [
        ['if', 'keyword.control.alo'],
        ['path', 'entity.name.tag.html'],
        ['p', 'entity.name.tag.html'],
    ]],
];

async function grammar() {
    await check('no invalid tokens in any example .alo file', async () => {
        const files = (await vscode.workspace.findFiles('**/*.alo')).map((uri) => uri.fsPath);
        const bad = [];
        for (const file of files) {
            const tokens = await tokensOf(file);
            const invalid = tokens.filter((t) => t.t.includes('invalid')).map((t) => t.c);
            if (invalid.length) bad.push(path.relative(WS, file) + ': ' + invalid.join(' '));
        }
        return { ok: files.length > 10 && bad.length === 0, text: `${files.length} files; ${bad.join('; ') || 'none invalid'}` };
    });

    for (const [name, source, expectations] of GRAMMAR_CASES) {
        await check('grammar: ' + name, async () => {
            const file = path.join(WS, 'grammar-cases', name.replace(/[^a-z0-9]+/gi, '-') + '.alo');
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, source);
            const tokens = await tokensOf(file);
            const problems = [];
            for (const [text, has, hasNot, nth = 0] of expectations) {
                const hit = tokens.filter((t) => t.c.trim() === text)[nth];
                if (!hit) {
                    problems.push(`no token ${JSON.stringify(text)}`);
                    continue;
                }
                for (const s of [].concat(has || [])) if (!hit.t.includes(s)) problems.push(`${text} lacks ${s}`);
                for (const s of [].concat(hasNot || [])) if (hit.t.includes(s)) problems.push(`${text} has ${s}`);
            }
            for (const t of tokens.filter((t) => t.t.includes('invalid'))) problems.push(`invalid ${JSON.stringify(t.c)}`);
            return { ok: problems.length === 0, text: problems.join('; ') || 'ok' };
        });
    }
}

// ---------------------------------------------------------------- step 5: snippets

async function snippets() {
    async function insert(file, name) {
        const editor = await fresh(file);
        await vscode.commands.executeCommand('editor.action.insertSnippet', { langId: 'alo', name });
        await sleep(150);
        await vscode.commands.executeCommand('leaveSnippet');
        const text = editor.document.getText();
        await vscode.commands.executeCommand('workbench.action.files.save');
        return text;
    }
    const cases = [
        ['pages/about-us/page.alo', 'Alo page', '<head>\n    <title>about-us</title>\n</head>\n\n<template>\n    <h1>about-us</h1>\n    \n</template>\n'],
        ['pages/shop/layout.alo', 'Alo layout', '<template>\n    \n    <slot />\n</template>\n'],
        ['components/blog/PostCard.alo', 'Alo component', '<template>\n    <div class="post-card">\n        <slot />\n    </div>\n</template>\n\n<style>\n    .post-card {\n    }\n</style>\n'],
        ['components/Card2Item.alo', 'Alo component', 'class="card2-item"'],
        ['snippets/s1.alo', 'Template for loop', '<template for="item in list">\n    \n</template>'],
        ['snippets/s2.alo', 'Template for loop with index', '<template for="(item, i) in list">\n    \n</template>'],
        ['snippets/s3.alo', 'Template if', '<template if="condition">\n    \n</template>'],
        ['snippets/s4.alo', 'Template if else', '<template if="condition">\n    \n</template>\n<template else>\n    \n</template>'],
        ['snippets/s5.alo', 'Template else-if', '<template else-if="condition">\n    \n</template>'],
        ['snippets/s6.alo', 'Template else', '<template else>\n    \n</template>'],
        ['snippets/s7.alo', 'Slot', '<slot />'],
        ['snippets/s8.alo', 'Raw HTML', '{{{ item.body }}}'],
        ['snippets/s9.alo', 'Global style', '<style global>\n    \n</style>'],
    ];
    for (const [file, name, want] of cases) {
        await check(`snippet "${name}" in ${file}`, async () => {
            const text = await insert(file, name);
            return { ok: want.startsWith('class=') ? text.includes(want) : text === want, text };
        });
    }
    await check('tfor is suggested in <template>, once', async () => {
        const { items } = await completionsAt('snippets/complete.alo', '<template>\n    tfo|\n</template>\n');
        const labels = items.map(labelOf);
        return { ok: labels.filter((l) => l === 'tfor').length === 1, text: labels.filter((l) => l.startsWith('tf')) };
    });
    await check('tfor is not suggested inside <script>', async () => {
        // Which snippets VS Code offers depends on the language at the cursor, which it only knows
        // once it has colored the new file. Right after writing the file it may not have yet.
        const { editor } = await completionsAt('snippets/complete.alo', '<script>\n    tfo|\n</script>\n');
        let labels = [];
        const ok = await waitUntil(async () => {
            labels = (await completions(editor, editor.document.getText().indexOf('tfo') + 3)).map(labelOf);
            return !labels.includes('tfor');
        }, 20);
        return { ok, text: labels.filter((l) => l.startsWith('tf')) };
    });
}

// ---------------------------------------------------------------- step 6: HTML, CSS, JS and Emmet

async function htmlFeatures() {
    await check('setting: Emmet is on for alo', async () => {
        const value = vscode.workspace.getConfiguration('emmet').get('includeLanguages');
        return { ok: value?.alo === 'html', text: value };
    });
    await check('setting: tab labels for page.alo and layout.alo', async () => {
        const value = vscode.workspace.getConfiguration('workbench.editor.customLabels').get('patterns');
        return { ok: value?.['**/pages/**/page.alo'] === '${dirname} (page)', text: value };
    });

    const file = 'html-test/test.alo';
    const has = async (text, label, trigger) => (await completionsAt(file, text, trigger)).items.map(labelOf).includes(label);
    await check('HTML tag names after <se', async () => ({ ok: await has('<template>\n    <se|\n</template>', 'section'), text: '' }));
    await check('HTML attributes in <div cl', async () => ({ ok: await has('<template>\n    <div cl|></div>\n</template>', 'class'), text: '' }));
    await check('HTML attributes in <Card cl', async () => ({ ok: await has('<template>\n    <Card cl| />\n</template>', 'class'), text: '' }));
    await check('CSS properties in <style>', async () => ({ ok: await has('<style>\n    .a { colo| }\n</style>', 'color'), text: '' }));
    await check('JS names in <script>', async () => ({ ok: await has('<script>\n    docu|\n</script>', 'document'), text: '' }));
    await check('no HTML suggestions inside {{ }}', async () => ({
        ok: !(await has('<template>\n    <p>{{ props.se| }}</p>\n</template>', 'section', '.')),
        text: '',
    }));
    await check('HTML suggestions right after }}', async () => ({ ok: await has('<template>\n    <p>{{ x }}<se|</p>\n</template>', 'section'), text: '' }));
    await check('fresh text right after an edit', async () => {
        const editor = await fresh(file, '<template>\n    <xx\n</template>\n');
        await editor.edit((e) => e.replace(new vscode.Range(1, 4, 1, 7), '<sp'));
        const labels = (await completions(editor, editor.document.offsetAt(new vscode.Position(1, 7)))).map(labelOf);
        await vscode.commands.executeCommand('workbench.action.files.save');
        return { ok: labels.includes('span'), text: '' };
    });
    await check('Emmet ul>li*2 is suggested once', async () => {
        const { items } = await completionsAt(file, '<template>\n    ul>li*2|\n</template>\n');
        const n = items.map(labelOf).filter((l) => l === 'ul>li*2').length;
        return { ok: n === 1, text: n };
    });

    async function hover(text, marker) {
        const editor = await fresh(file, text);
        const position = editor.document.positionAt(text.indexOf(marker) + 1);
        const hovers = await vscode.commands.executeCommand('vscode.executeHoverProvider', editor.document.uri, position);
        return hovers.flatMap((h) => h.contents.map((c) => (typeof c === 'string' ? c : c.value))).join(' ').slice(0, 70);
    }
    await check('hover on an HTML tag', async () => {
        const text = await hover('<template>\n    <section>x</section>\n</template>\n', 'section');
        return { ok: /section element/i.test(text), text };
    });
    await check('hover on a CSS property', async () => {
        const text = await hover('<style>\n    .a { color: red; }\n</style>\n', 'color');
        return { ok: /color/i.test(text), text };
    });
}

// ---------------------------------------------------------------- step 7: Alo core and status bar

async function statusBar() {
    const api = vscode.extensions.getExtension('msilabs.alo-vscode').exports;
    const tooltip = () => api.status.tooltip.value;

    await check('status bar: bundled core for the example', async () => {
        await open('components/Counter.alo');
        return {
            ok: api.status.text === '$(flame) Alo 1.0.0' && tooltip().includes('copy inside this extension') && /\d+ pages · \d+ components/.test(tooltip()),
            text: tooltip(),
        };
    });
    await check("status bar: the project's own core from node_modules", async () => {
        const dir = path.join(TEMP, 'linked-project');
        fs.rmSync(dir, { recursive: true, force: true });
        fs.mkdirSync(path.join(dir, 'node_modules', '@msilabs'), { recursive: true });
        fs.symlinkSync(ALO_REPO, path.join(dir, 'node_modules', '@msilabs', 'alo'));
        await fresh(path.join(dir, 'pages', 'page.alo'), '<template><h1>hi</h1></template>\n');
        return { ok: tooltip().includes("project's node_modules") && tooltip().includes('1 page · 0 components'), text: tooltip() };
    });
    await check('status bar: a broken project shows the Alo error', async () => {
        const dir = path.join(TEMP, 'broken-project');
        fs.rmSync(dir, { recursive: true, force: true });
        fs.mkdirSync(path.join(dir, 'components', 'Bad_Folder'), { recursive: true });
        await fresh(path.join(dir, 'pages', 'page.alo'), '<template></template>\n');
        return { ok: tooltip().includes('Bad_Folder'), text: tooltip() };
    });
    await check('command: Alo: Show Log', async () => {
        const commands = await vscode.commands.getCommands(true);
        return { ok: commands.includes('alo.showOutput') && commands.includes('alo.useAloForAloFiles'), text: commands.filter((c) => c.startsWith('alo.')) };
    });
}

// ---------------------------------------------------------------- step 8: component completion

async function componentCompletion() {
    const ours = (items) => items.filter((i) => i.detail === 'Alo component');
    const names = (items) => ours(items).map(labelOf).sort();

    await check('components after <', async () => {
        const { items } = await completionsAt('pages/c1/page.alo', '<template>\n    <|\n</template>\n', '<');
        const list = names(items);
        return { ok: ['Blog.PostCard', 'Card', 'Header'].every((n) => list.includes(n)), text: list };
    });
    await check('component items show their file', async () => {
        const { items } = await completionsAt('pages/c1/page.alo', '<template>\n    <|\n</template>\n', '<');
        const card = ours(items).find((i) => labelOf(i) === 'Blog.PostCard');
        return { ok: card?.label.description === 'components/blog/PostCard.alo', text: card?.label };
    });
    await check('the range covers a dotted name like Blog.Po', async () => {
        const { editor, items } = await completionsAt('pages/c1/page.alo', '<template>\n    <Blog.Po|\n</template>\n', '.');
        const item = ours(items).find((i) => labelOf(i) === 'Blog.PostCard');
        const range = item.range.inserting ?? item.range;
        return { ok: editor.document.getText(range) === 'Blog.Po', text: editor.document.getText(range) };
    });
    await check('accepting a suggestion writes the full name', async () => {
        const text = '<template>\n    <Blog.Po\n</template>\n';
        const editor = await fresh('pages/c1/page.alo', text);
        editor.selection = new vscode.Selection(1, 12, 1, 12);
        await vscode.commands.executeCommand('editor.action.triggerSuggest');
        await sleep(800);
        await vscode.commands.executeCommand('acceptSelectedSuggestion');
        await sleep(200);
        const line = editor.document.lineAt(1).text.trim();
        await revert();
        return { ok: line === '<Blog.PostCard', text: line };
    });
    await check('a component is not suggested inside itself', async () => {
        const editor = await open('components/Card.alo');
        const position = new vscode.Position(0, 0);
        await editor.edit((e) => e.insert(position, '<'));
        const list = names(await completions(editor, 1, '<'));
        await revert();
        return { ok: !list.includes('Card') && list.includes('Header'), text: list };
    });
    for (const [name, text] of [
        ['closing tag </', '<template>\n    <p></|</p>\n</template>\n'],
        ['inside <script>', '<script>\n    const a = <|\n</script>\n'],
        ['inside a comment', '<!-- <| -->\n'],
        ['comparison inside {{ }}', '<template>\n    <p>{{ a <| b }}</p>\n</template>\n'],
    ]) {
        await check(`no components: ${name}`, async () => {
            const { items } = await completionsAt('pages/c2/page.alo', text, '<');
            return { ok: ours(items).length === 0, text: names(items) };
        });
    }
}


// ---------------------------------------------------------------- step 9: go to definition and hover

async function definitionAndHover() {
    fs.writeFileSync(
        path.join(WS, 'components', 'Profile.alo'),
        '<template>\n    <div class="{{ props.class }}">{{ props.fullName }}<slot /></div>\n</template>\n',
    );
    const page = 'pages/d1/page.alo';
    const text = '<template>\n    <Blog.PostCard post="{{ x }}" />\n    <Card title="a">x</Card>\n    <Profile full-name="A" />\n    <Crad />\n    <div class="a"></div>\n</template>\n<script>\n    const s = "<Card>";\n</script>\n';
    const at = async (marker, nth = 0) => {
        const editor = await fresh(page, text);
        let index = -1;
        for (let i = 0; i <= nth; i++) index = text.indexOf(marker, index + 1);
        return { editor, position: editor.document.positionAt(index + 2) };
    };
    const definitions = async (marker, nth) => {
        const { editor, position } = await at(marker, nth);
        const links = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', editor.document.uri, position);
        return { editor, links };
    };
    const hoverText = async (marker, nth) => {
        const { editor, position } = await at(marker, nth);
        const hovers = await vscode.commands.executeCommand('vscode.executeHoverProvider', editor.document.uri, position);
        return hovers.flatMap((h) => h.contents.map((c) => (typeof c === 'string' ? c : c.value))).join('\n');
    };
    const target = (link) => path.relative(WS, (link.targetUri ?? link.uri).fsPath).split(path.sep).join('/');

    await check('definition: <Blog.PostCard opens its file', async () => {
        const { editor, links } = await definitions('Blog.PostCard');
        const link = links[0];
        return {
            ok: links.length === 1 && target(link) === 'components/blog/PostCard.alo' && editor.document.getText(link.originSelectionRange) === 'Blog.PostCard',
            text: links.map((l) => target(l) + ' from ' + (l.originSelectionRange ? editor.document.getText(l.originSelectionRange) : '?')),
        };
    });
    await check('definition: closing </Card> works too', async () => {
        const { links } = await definitions('Card>', 0);
        return { ok: links.length === 1 && target(links[0]) === 'components/Card.alo', text: links.map(target) };
    });
    await check('definition: nothing for an unknown component', async () => {
        const { links } = await definitions('Crad');
        return { ok: links.length === 0, text: links.map(target) };
    });
    await check('definition: nothing inside <script>', async () => {
        const { links } = await definitions('Card>"');
        return { ok: links.length === 0, text: links.map(target) };
    });
    await check('hover: file and props of a component', async () => {
        const hover = await hoverText('Profile');
        return {
            ok: hover.includes('components/Profile.alo') && hover.includes('- `class`') && hover.includes('- `full-name` (read as `props.fullName`)'),
            text: hover,
        };
    });
    await check('hover: unsaved changes in the component count', async () => {
        const component = await open('components/Profile.alo');
        await component.edit((e) => e.insert(new vscode.Position(1, 4), '{{ props.age }}'));
        const hover = await hoverText('Profile');
        await open('components/Profile.alo');
        await revert();
        return { ok: hover.includes('- `age`'), text: hover };
    });
    await check('hover: an unknown component suggests the right name', async () => {
        const hover = await hoverText('Crad');
        return { ok: hover.includes('no such component') && hover.includes('Did you mean `<Card>`?'), text: hover };
    });
    await check('hover: a broken component shows its error', async () => {
        fs.writeFileSync(path.join(WS, 'components', 'Broken.alo'), '<head></head>\n<template><p>x</p></template>\n');
        const editor = await fresh('pages/d2/page.alo', '<template>\n    <Broken />\n</template>\n');
        const hovers = await vscode.commands.executeCommand('vscode.executeHoverProvider', editor.document.uri, new vscode.Position(1, 7));
        const hover = hovers.flatMap((h) => h.contents.map((c) => c.value ?? c)).join('\n');
        fs.rmSync(path.join(WS, 'components', 'Broken.alo'));
        return { ok: hover.includes('Could not read the component'), text: hover };
    });
    await check('hover: plain HTML tags get no Alo hover', async () => {
        const hover = await hoverText('div class');
        return { ok: !hover.includes('Alo component'), text: hover.slice(0, 60) };
    });
}


// ---------------------------------------------------------------- step 10: prop completion and the file watcher

async function propCompletionAndWatcher() {
    fs.writeFileSync(
        path.join(WS, 'components', 'Profile.alo'),
        '<template>\n    <div class="{{ props.class }}">{{ props.fullName }}<slot /></div>\n</template>\n',
    );
    const ours = (items) => items.filter((i) => (i.detail ?? '').startsWith('Prop of'));
    const labels = (items) => items.map(labelOf);

    await check('props after <Card and a space', async () => {
        const { items } = await completionsAt('pages/p1/page.alo', '<template>\n    <Card |/>\n</template>\n', ' ');
        const list = labels(ours(items)).sort();
        return { ok: list.join() === 'class,title', text: list };
    });
    await check('no HTML attributes inside a component tag', async () => {
        const { items } = await completionsAt('pages/p1/page.alo', '<template>\n    <Card |/>\n</template>\n');
        const html = labels(items).filter((l) => ['id', 'tabindex', 'onclick', 'style'].includes(l));
        return { ok: html.length === 0 && labels(items).includes('title'), text: html };
    });
    await check('HTML attributes are still offered on HTML tags', async () => {
        const { items } = await completionsAt('pages/p1/page.alo', '<template>\n    <div |></div>\n</template>\n');
        return { ok: labels(items).includes('id') && ours(items).length === 0, text: labels(items).filter((l) => ['id', 'class'].includes(l)) };
    });
    await check('props already written are not offered again', async () => {
        const { items } = await completionsAt('pages/p1/page.alo', '<template>\n    <Card title="a" |/>\n</template>\n', ' ');
        return { ok: labels(ours(items)).join() === 'class', text: labels(ours(items)) };
    });
    await check('a camelCase prop is offered as kebab-case with ="|"', async () => {
        const { items } = await completionsAt('pages/p1/page.alo', '<template>\n    <Profile\n        |\n    />\n</template>\n');
        const item = ours(items).find((i) => labelOf(i) === 'full-name');
        return { ok: item?.insertText.value === 'full-name="$1"' && item.label.description === 'props.fullName', text: item?.insertText.value };
    });
    await check('no props inside a quoted value', async () => {
        const { items } = await completionsAt('pages/p1/page.alo', '<template>\n    <Card title="a |" />\n</template>\n', ' ');
        return { ok: ours(items).length === 0, text: labels(ours(items)) };
    });

    const componentNames = async () => {
        const { items } = await completionsAt('pages/p2/page.alo', '<template>\n    <|\n</template>\n', '<');
        return items.filter((i) => i.detail === 'Alo component').map(labelOf);
    };
    // The watcher hears about changes made outside VS Code (a terminal, Finder) a moment later.
    const waitFor = async (condition) => {
        for (let i = 0; i < 30; i++) {
            if (await condition()) return true;
            await sleep(200);
        }
        return false;
    };

    await check('cache: the project is remembered and forgotten on a file change', async () => {
        const { projects } = vscode.extensions.getExtension('msilabs.alo-vscode').exports;
        await componentNames();
        const remembered = projects.cache.has(WS);
        const first = projects.forFile(path.join(WS, 'pages', 'p2', 'page.alo'));
        const same = projects.forFile(path.join(WS, 'components', 'Card.alo')) === first;
        fs.writeFileSync(path.join(WS, 'components', 'Temp.alo'), '<template></template>\n');
        const forgotten = await waitFor(async () => !projects.cache.has(WS));
        fs.rmSync(path.join(WS, 'components', 'Temp.alo'));
        await waitFor(async () => !(await componentNames()).includes('Temp'));
        return { ok: remembered && same && forgotten, text: { remembered, same, forgotten } };
    });
    await check('watcher: a new component file shows up', async () => {
        await componentNames();
        fs.writeFileSync(path.join(WS, 'components', 'NewThing.alo'), '<template><p>new</p></template>\n');
        const ok = await waitFor(async () => (await componentNames()).includes('NewThing'));
        return { ok, text: await componentNames() };
    });
    await check('watcher: a deleted component file goes away', async () => {
        fs.rmSync(path.join(WS, 'components', 'NewThing.alo'));
        const ok = await waitFor(async () => !(await componentNames()).includes('NewThing'));
        return { ok, text: await componentNames() };
    });
    await check('watcher: renaming a folder renames its components', async () => {
        fs.renameSync(path.join(WS, 'components', 'blog'), path.join(WS, 'components', 'news'));
        const ok = await waitFor(async () => {
            const names = await componentNames();
            return names.includes('News.PostCard') && !names.includes('Blog.PostCard');
        });
        const names = await componentNames();
        fs.renameSync(path.join(WS, 'components', 'news'), path.join(WS, 'components', 'blog'));
        await waitFor(async () => (await componentNames()).includes('Blog.PostCard'));
        return { ok, text: names.filter((n) => n.includes('.')) };
    });
    await check('watcher: the status bar count updates without switching files', async () => {
        const api = vscode.extensions.getExtension('msilabs.alo-vscode').exports;
        await open('components/Counter.alo');
        const count = () => Number(/(\d+) components?/.exec(api.status.tooltip.value)?.[1]);
        const before = count();
        fs.writeFileSync(path.join(WS, 'components', 'Extra.alo'), '<template><p>x</p></template>\n');
        const ok = await waitFor(async () => count() === before + 1);
        const after = count();
        fs.rmSync(path.join(WS, 'components', 'Extra.alo'));
        return { ok, text: `${before} → ${after}` };
    });
}


// ---------------------------------------------------------------- step 11: diagnostics
// Runs first, on the clean example: Alo stops at the first error, so a broken file left by
// another test would hide the error a test here expects.

async function diagnostics() {
    const problemsIn = (file) =>
        vscode.languages.getDiagnostics(vscode.Uri.file(path.join(WS, file))).filter((d) => d.source === 'alo');
    const allProblems = () =>
        vscode.languages.getDiagnostics().flatMap(([uri, list]) => list.filter((d) => d.source === 'alo').map((d) => ({ uri, d })));
    const describe = (d) => `${['error', 'warning', 'info', 'hint'][d.severity]}: ${d.message.split('\n')[0]}`;

    // Edits a file without saving it, waits for a problem in `file`, then throws the edit away.
    async function problemAfterEdit(editFile, edit, file = editFile) {
        const editor = await open(editFile);
        await editor.edit(edit);
        await waitUntil(() => problemsIn(file).length > 0);
        const problems = problemsIn(file);
        const texts = problems.map((d) => vscode.workspace.textDocuments.find((t) => t.uri.fsPath === path.join(WS, file))?.getText(d.range));
        await open(editFile);
        await revert();
        const cleared = await waitUntil(() => problemsIn(file).length === 0);
        return { problems, texts, cleared };
    }
    const about = 'pages/(site)/about/page.alo';
    const afterTemplate = (line) => (e) => e.insert(new vscode.Position(6, 0), line + '\n');

    await check('diagnostics: the clean example has no problems', async () => {
        await open(about);
        await sleep(1200);
        const problems = allProblems();
        return { ok: problems.length === 0, text: problems.map(({ uri, d }) => path.basename(uri.fsPath) + ' ' + describe(d)) };
    });
    await check('diagnostics: an unknown component, while typing, without saving', async () => {
        const { problems, texts, cleared } = await problemAfterEdit(about, afterTemplate('    <Crad />'));
        const [d] = problems;
        return {
            ok: problems.length === 1 && d.severity === vscode.DiagnosticSeverity.Error && d.message.includes('`<Crad>` not found') && d.message.includes('Did you mean `<Card>`?') && texts[0] === '<Crad' && cleared,
            text: problems.map(describe).concat(texts, `cleared: ${cleared}`),
        };
    });
    await check('diagnostics: a mistyped prop is a warning on the attribute', async () => {
        const { problems, texts, cleared } = await problemAfterEdit(about, afterTemplate('    <Card titel="x" />'));
        const [d] = problems;
        return {
            ok: problems.length === 1 && d.severity === vscode.DiagnosticSeverity.Warning && d.message.includes('never uses `titel`') && texts[0] === 'titel' && cleared,
            text: problems.map(describe).concat(texts),
        };
    });
    await check('diagnostics: a bad expression underlines the whole {{ }}', async () => {
        const { problems, texts } = await problemAfterEdit(about, afterTemplate('    <p>{{ a + }}</p>'));
        return { ok: texts[0] === '{{ a + }}', text: problems.map(describe).concat(texts) };
    });
    await check('diagnostics: an error inside a component points to where it is used', async () => {
        const card = 'components/Card.alo';
        const { problems } = await problemAfterEdit(card, (e) => e.insert(new vscode.Position(3, 30), '.foo.bar'));
        const related = problems[0]?.relatedInformation?.[0];
        const usedIn = related && path.relative(WS, related.location.uri.fsPath);
        return {
            ok: problems.length === 1 && related?.message === 'Used here' && usedIn.startsWith('pages'),
            text: problems.map(describe).concat(`used in ${usedIn}`),
        };
    });
    await check('diagnostics: broken JSON in data/', async () => {
        const { problems, cleared } = await problemAfterEdit('data/site.json', (e) => e.insert(new vscode.Position(0, 1), ','));
        return { ok: problems.length === 1 && problems[0].message.startsWith('Invalid JSON') && cleared, text: problems.map(describe) };
    });
    await check('diagnostics: a component used nowhere gets a warning', async () => {
        await open(about);
        const file = path.join(WS, 'components', 'Lonely.alo');
        fs.writeFileSync(file, '<template><p>alone</p></template>\n');
        await waitUntil(() => problemsIn('components/Lonely.alo').length > 0);
        const problems = problemsIn('components/Lonely.alo');
        fs.rmSync(file);
        const cleared = await waitUntil(() => problemsIn('components/Lonely.alo').length === 0);
        return { ok: problems.length === 1 && problems[0].message.includes('never used') && cleared, text: problems.map(describe).concat(`cleared: ${cleared}`) };
    });
}


// ---------------------------------------------------------------- step 12: quick fixes
// Also runs early, on the clean example, for the same reason as the diagnostics.

async function quickFixes() {
    const about = 'pages/(site)/about/page.alo';
    const problemsIn = (uri) => vscode.languages.getDiagnostics(uri).filter((d) => d.source === 'alo');

    // Types `line` into the about page, waits for Alo's problem, and returns its quick fixes.
    async function fixesFor(line) {
        const editor = await open(about);
        // The previous test's squiggle must be gone first, or it would be mistaken for the new one.
        await waitUntil(() => problemsIn(editor.document.uri).length === 0);
        await editor.edit((e) => e.insert(new vscode.Position(6, 0), line + '\n'));
        await waitUntil(() => problemsIn(editor.document.uri).length > 0);
        const [diagnostic] = problemsIn(editor.document.uri);
        const actions = diagnostic
            ? await vscode.commands.executeCommand('vscode.executeCodeActionProvider', editor.document.uri, diagnostic.range, vscode.CodeActionKind.QuickFix.value)
            : [];
        // The command does not hand back each action's diagnostics, so Alo's fixes are picked by kind.
        // That leaves out VS Code's own Copilot "Fix" and "Explain".
        return { editor, actions: actions.filter((a) => a.kind?.value === 'quickfix') };
    }
    async function applyAndRead(editor, action) {
        await vscode.workspace.applyEdit(action.edit);
        const line = editor.document.lineAt(6).text.trim();
        const cleared = await waitUntil(() => problemsIn(editor.document.uri).length === 0);
        return { line, cleared };
    }
    const titles = (actions) => actions.map((a) => a.title + (a.isPreferred ? ' (preferred)' : ''));

    await check('quick fix: <Crad>…</Crad> becomes <Card>…</Card>', async () => {
        const { editor, actions } = await fixesFor('    <Crad>x</Crad>');
        const fix = actions.find((a) => a.title === 'Change to `<Card>`');
        const result = fix ? await applyAndRead(editor, fix) : {};
        await open(about);
        await revert();
        return { ok: fix?.isPreferred && result.line === '<Card>x</Card>' && result.cleared, text: { titles: titles(actions), ...result } };
    });
    await check('quick fix: titel becomes title', async () => {
        const { editor, actions } = await fixesFor('    <Card titel="x" />');
        const fix = actions.find((a) => a.title === 'Change to `title`');
        const result = fix ? await applyAndRead(editor, fix) : {};
        await open(about);
        await revert();
        return { ok: result.line === '<Card title="x" />' && result.cleared, text: { titles: titles(actions), ...result } };
    });
    await check('quick fix: dat becomes data inside {{ }}', async () => {
        const { editor, actions } = await fixesFor('    <p>{{ dat.site.name }}</p>');
        const fix = actions.find((a) => a.title === 'Change to `data`');
        const result = fix ? await applyAndRead(editor, fix) : {};
        await open(about);
        await revert();
        return { ok: result.line === '<p>{{ data.site.name }}</p>' && result.cleared, text: { titles: titles(actions), ...result } };
    });
    await check('quick fix: <Section> becomes the HTML tag <section>', async () => {
        const { editor, actions } = await fixesFor('    <Section>x</Section>');
        const fix = actions.find((a) => a.title === 'Change to the HTML tag `<section>`');
        const result = fix ? await applyAndRead(editor, fix) : {};
        await open(about);
        await revert();
        return { ok: result.line === '<section>x</section>' && result.cleared, text: { titles: titles(actions), ...result } };
    });
    // Applies the named fix after typing `line` into the about page; returns the new line.
    async function fixLine(line, title) {
        const { editor, actions } = await fixesFor('    ' + line);
        const fix = actions.find((a) => a.title === title);
        const result = fix ? await applyAndRead(editor, fix) : {};
        await open(about);
        await revert();
        return { fix, ...result, titles: titles(actions) };
    }
    for (const [name, line, title, want] of [
        ['logic on an <li> is wrapped in <template>', '<ul><li if="true">a</li></ul>', 'Wrap in `<template if="true">`', '<ul><template if="true"><li>a</li></template></ul>'],
        ['logic on a component is wrapped in <template>', '<Card for="x in [1]" title="a" />', 'Wrap in `<template for="x in [1]">`', '<template for="x in [1]"><Card title="a" /></template>'],
        ['for and if on one <template> are nested', '<template for="x in [1, 2]" if="true"><p>{{ x }}</p></template>', 'Move `if` into a `<template>` inside the loop', '<template for="x in [1, 2]"><template if="true"><p>{{ x }}</p></template></template>'],
        ['sort() becomes toSorted()', '<p>{{ data.features.sort().length }}</p>', 'Use `toSorted()` instead', '<p>{{ data.features.toSorted().length }}</p>'],
        ['reverse() becomes toReversed()', '<template for="f in data.features.reverse()"><p>{{ f.title }}</p></template>', 'Use `toReversed()` instead', '<template for="f in data.features.toReversed()"><p>{{ f.title }}</p></template>'],
    ]) {
        await check('quick fix: ' + name, async () => {
            const r = await fixLine(line, title);
            return { ok: r.fix?.isPreferred && r.line === want && r.cleared, text: { titles: r.titles, line: r.line, cleared: r.cleared } };
        });
    }
    await check('quick fix: a layout without <slot /> gets one back', async () => {
        const layout = 'pages/(site)/layout.alo';
        const editor = await open(layout);
        const uri = editor.document.uri;
        await waitUntil(() => problemsIn(uri).length === 0);
        const slotLine = findLine(editor.document, '<slot />');
        await editor.edit((e) => e.delete(editor.document.lineAt(slotLine).rangeIncludingLineBreak));
        await waitUntil(() => problemsIn(uri).length > 0);
        const [diagnostic] = problemsIn(uri);
        const actions = diagnostic
            ? (await vscode.commands.executeCommand('vscode.executeCodeActionProvider', uri, diagnostic.range, vscode.CodeActionKind.QuickFix.value)).filter((a) => a.kind?.value === 'quickfix')
            : [];
        const fix = actions.find((a) => a.title === 'Add `<slot />`');
        if (fix) await vscode.workspace.applyEdit(fix.edit);
        const hasSlot = editor.document.getText().includes('<slot />');
        const cleared = await waitUntil(() => problemsIn(uri).length === 0);
        await open(layout);
        await revert();
        return { ok: Boolean(fix) && hasSlot && cleared, text: { message: diagnostic?.message.split('\n')[0], titles: titles(actions), hasSlot, cleared } };
    });
    await check('quick fix: create a missing component and open it', async () => {
        const { actions } = await fixesFor('    <Testimonial />');
        const fix = actions.find((a) => a.title === 'Create components/Testimonial.alo');
        const file = path.join(WS, 'components', 'Testimonial.alo');
        let content = null;
        let opened = null;
        let cleared = false;
        if (fix) {
            await vscode.workspace.applyEdit(fix.edit);
            await vscode.commands.executeCommand(fix.command.command, ...fix.command.arguments);
            await sleep(300);
            // Like any refactoring, the new file opens with its text but unsaved, for you to look at first.
            const created = vscode.window.activeTextEditor.document;
            opened = path.relative(WS, created.uri.fsPath);
            content = created.getText();
            const aboutUri = vscode.Uri.file(path.join(WS, about));
            cleared = await waitUntil(() => problemsIn(aboutUri).length === 0);
            await revert();
            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        }
        await open(about);
        await revert();
        await vscode.workspace.fs.delete(vscode.Uri.file(file), { useTrash: false }).then(undefined, () => {});
        await waitUntil(async () => !fs.existsSync(file));
        return {
            ok: content === '<template>\n    <div class="testimonial">\n        <slot />\n    </div>\n</template>\n' && opened === 'components/Testimonial.alo' && cleared,
            text: { titles: titles(actions), opened, content, cleared },
        };
    });
}


// ---------------------------------------------------------------- `"*.alo": "html"` in the settings
// Only in `run.js --alo-as-html`: the workspace starts with settings that open .alo files as HTML.

async function aloAsHtml() {
    const extension = vscode.extensions.getExtension('msilabs.alo-vscode');
    await check('the extension starts although no file opens as Alo', async () => {
        const active = await waitUntil(() => extension.isActive, 60);
        return { ok: active, text: { active, trusted: vscode.workspace.isTrusted } };
    });
    await check('.alo files open as HTML before the fix', async () => {
        const editor = await open('components/Counter.alo');
        return { ok: editor.document.languageId === 'html', text: editor.document.languageId };
    });
    await check('"Alo: Open .alo Files as Alo" removes the setting and switches open files', async () => {
        await vscode.commands.executeCommand('alo.useAloForAloFiles');
        const settings = JSON.parse(fs.readFileSync(path.join(WS, '.vscode', 'settings.json'), 'utf8'));
        const language = vscode.window.activeTextEditor.document.languageId;
        return {
            ok: language === 'alo' && JSON.stringify(settings['files.associations']) === '{"*.foo":"bar"}',
            text: { language, settings },
        };
    });
    await check('.alo files opened after the fix are Alo', async () => {
        const editor = await open('components/Card.alo');
        return { ok: editor.document.languageId === 'alo', text: editor.document.languageId };
    });
}


// ---------------------------------------------------------------- B5–B8: data., item., props., loop variables

async function expressionCompletion() {
    const about = 'pages/(site)/about/page.alo';
    const slugPage = 'pages/(site)/blog/[slug]/page.alo';
    const suggest = async (file, insert, cursorAfter, trigger) => {
        const editor = await open(file);
        await editor.edit((e) => e.insert(new vscode.Position(6, 0), insert + '\n'));
        const offset = editor.document.offsetAt(new vscode.Position(6, 0)) + insert.indexOf(cursorAfter) + cursorAfter.length;
        const items = await completions(editor, offset, trigger);
        await revert();
        return items;
    };
    const named = (items, kinds) => items.filter((i) => kinds.includes(i.kind)).map((i) => ({ label: labelOf(i), detail: i.detail }));
    const props = [vscode.CompletionItemKind.Property];
    const vars = [vscode.CompletionItemKind.Variable];
    const labels = (list) => list.map((x) => x.label);

    await check('data. lists the data files', async () => {
        const list = named(await suggest(about, '    <p>{{ data. }}</p>', 'data.', '.'), props);
        return { ok: ['blog', 'faq', 'features', 'menu', 'site'].every((k) => labels(list).includes(k)), text: list };
    });
    await check('data.site. lists its keys with their values', async () => {
        const list = named(await suggest(about, '    <p>{{ data.site. }}</p>', 'data.site.', '.'), props);
        const name = list.find((x) => x.label === 'name');
        return { ok: name?.detail.startsWith('text: '), text: list.slice(0, 3) };
    });
    await check('a bare name lists what a page can read', async () => {
        const list = labels(named(await suggest(about, '    <p>{{ d }}</p>', '{{ d'), vars));
        return { ok: list.includes('data') && list.includes('route') && list.includes('base') && !list.includes('item') && !list.includes('props'), text: list };
    });
    await check('item. in a [slug] page lists the post fields', async () => {
        const list = labels(named(await suggest(slugPage, '    <p>{{ item. }}</p>', 'item.', '.'), props));
        return { ok: ['title', 'date', 'slug', 'body'].every((k) => list.includes(k)), text: list };
    });
    await check('a loop variable lists the fields of the list items', async () => {
        const list = labels(named(await suggest(about, '    <template for="post in data.blog"><p>{{ post. }}</p></template>', 'post.', '.'), props));
        return { ok: ['title', 'date', 'slug'].every((k) => list.includes(k)), text: list };
    });
    await check('suggestions inside <template for="...">', async () => {
        const list = labels(named(await suggest(about, '    <template for="f in data."></template>', 'data.', '.'), props));
        return { ok: list.includes('features'), text: list };
    });
    await check('no data suggestions in plain text', async () => {
        const list = labels(named(await suggest(about, '    <p>data.</p>', 'data.', '.'), props));
        return { ok: !list.includes('site'), text: list };
    });
    await check('props. in a component: read here and passed by pages', async () => {
        // An unsaved page passes `subtitle` to Card; Card itself reads `title` and `class`.
        const page = await open(about);
        await page.edit((e) => e.insert(new vscode.Position(6, 0), '    <Card title="a" subtitle="b" />\n'));
        const card = await open('components/Card.alo');
        const line = findLine(card.document, 'props.title');
        await card.edit((e) => e.insert(new vscode.Position(line, 0), '{{ props. }}\n'));
        const items = await completions(card, card.document.offsetAt(new vscode.Position(line, 9)), '.');
        await revert();
        await open(about);
        await revert();
        const list = named(items, props);
        const subtitle = list.find((x) => x.label === 'subtitle');
        const title = list.find((x) => x.label === 'title');
        return { ok: title?.detail.startsWith('Read in this component') && subtitle?.detail.startsWith('Passed in pages/'), text: list };
    });
    await check('Cmd+Click on data.site.name opens data/site.json at "name"', async () => {
        const editor = await open(about);
        await editor.edit((e) => e.insert(new vscode.Position(6, 0), '    <p>{{ data.site.name }}</p>\n'));
        const position = new vscode.Position(6, '    <p>{{ data.site.na'.length);
        const links = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', editor.document.uri, position);
        const link = links[0];
        const target = link && path.relative(WS, link.targetUri.fsPath);
        const lineText = link && fs.readFileSync(link.targetUri.fsPath, 'utf8').split('\n')[link.targetRange.start.line];
        const origin = link && editor.document.getText(link.originSelectionRange);
        await revert();
        return { ok: target === 'data/site.json' && lineText.includes('"name"') && origin === 'data.site.name', text: { target, lineText, origin } };
    });
}

// ----------------------------------------------------------------

exports.run = async function () {
    WS = vscode.workspace.workspaceFolders[0].uri.fsPath;
    log('vscode ' + vscode.version);
    if (process.env.ALO_TEST_SCENARIO === 'alo-as-html') {
        await aloAsHtml();
        return finish();
    }
    const first = await open('components/Counter.alo');
    log('language of Counter.alo: ' + first.document.languageId);
    await sleep(1500);

    await diagnostics();
    await quickFixes();
    await typingAndComments();
    await grammar();
    await snippets();
    await htmlFeatures();
    await statusBar();
    await componentCompletion();
    await definitionAndHover();
    await propCompletionAndWatcher();
    await expressionCompletion();

    await check('no problems from the hidden HTML copies', async () => {
        await sleep(1000);
        const bad = vscode.languages.getDiagnostics().filter(([uri, d]) => d.length && uri.scheme !== 'file');
        return { ok: bad.length === 0, text: bad.map(([uri]) => uri.toString()) };
    });
    await check('the helper files are not dirty', async () => {
        // VS Code may already have let go of them on a long run; their job (loading the rules) is done by then.
        const docs = vscode.workspace.textDocuments.filter((d) => d.uri.path.includes('/embedded/'));
        return { ok: docs.every((d) => !d.isDirty), text: docs.map((d) => d.languageId + (d.isDirty ? ' (dirty)' : '')) };
    });

    finish();
};

function finish() {
    const total = lines.filter((l) => /^(PASS|FAIL|ERROR)/.test(l)).length;
    const failed = lines.filter((l) => /^(FAIL|ERROR)/.test(l)).length;
    log(`${total - failed}/${total} passed`);
    log('DONE');
}
