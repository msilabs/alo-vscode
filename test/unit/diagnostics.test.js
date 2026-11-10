'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadCore } = require('../../lib/project');
const { checkProject, problemRange } = require('../../lib/diagnostics');

function project(files) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alo-vscode-check-'));
    for (const [file, content] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        fs.writeFileSync(path.join(root, file), content);
    }
    return root;
}

const PAGE = 'pages/page.alo';
const CARD = '<template>\n    <article>{{ props.title }}<slot /></article>\n</template>\n';

function check(root, overlay = {}) {
    return checkProject(root, loadCore(root), new Map(Object.entries(overlay)), { sfc: new Map(), data: new Map() });
}

test('a clean project has no problems', () => {
    const root = project({ [PAGE]: '<template>\n    <Card title="a" />\n</template>\n', 'components/Card.alo': CARD });
    assert.deepEqual(check(root), []);
});

test('an unknown component is an error with a hint', () => {
    const root = project({ [PAGE]: '<template>\n    <Crad />\n</template>\n', 'components/Card.alo': CARD });
    const problems = check(root);
    // Card is now used nowhere, which Alo reports as a warning before it stops at the error.
    assert.deepEqual(
        problems.map((p) => `${p.severity}: ${p.message}`),
        ['warning: `<Card>` is never used.', 'error: Component `<Crad>` not found.'],
    );
    const problem = problems[1];
    assert.equal(problem.file, PAGE);
    assert.equal(problem.line, 2);
    assert.match(problem.message, /<Crad>/);
    assert.match(problem.hint, /Did you mean `<Card>`/);
});

test('the bundled Alo suggests the full name for a component in a folder', () => {
    const root = project({
        [PAGE]: '<template>\n    <Blog.PostList />\n</template>\n',
        'components/blog/PostList.alo': '<template>\n    <PostCard />\n</template>\n',
        'components/blog/PostCard.alo': '<template>c</template>\n',
    });
    const error = check(root).find((p) => p.severity === 'error');
    assert.equal(error.message, 'Component `<PostCard>` not found.');
    assert.match(error.hint, /^Did you mean `<Blog\.PostCard>`\?/);
});

test('a mistyped prop is a warning', () => {
    const root = project({ [PAGE]: '<template>\n    <Card titel="a" />\n</template>\n', 'components/Card.alo': CARD });
    const problems = check(root);
    assert.equal(problems.length, 1);
    assert.equal(problems[0].severity, 'warning');
    assert.match(problems[0].message, /never uses `titel`/);
});

test('unsaved editor text counts instead of the disk', () => {
    const root = project({ [PAGE]: '<template>\n    <Card title="a" />\n</template>\n', 'components/Card.alo': CARD });
    const problems = check(root, { [PAGE]: '<template>\n    <Crad />\n</template>\n' });
    assert.equal(problems.at(-1).severity, 'error');
});

test('an error inside a component says where it was used', () => {
    const root = project({
        [PAGE]: '<template>\n    <Card title="a" />\n</template>\n',
        'components/Card.alo': '<template>\n    <p>{{ props.title.x.y }}</p>\n</template>\n',
    });
    const error = check(root).at(-1);
    assert.equal(error.file, 'components/Card.alo');
    assert.deepEqual(error.calledFrom, { file: PAGE, line: 2, column: 5 });
});

test('problemRange underlines the tag, the expression or the word', () => {
    const page = '<template>\n    <Crad />\n    <p>{{ a + }}</p>\n    <Card titel="x" />\n</template>';
    const pick = (line, column) => {
        const { start, end } = problemRange(page, line, column);
        return page.split('\n')[start.line].slice(start.character, end.character);
    };
    assert.equal(pick(2, 5), '<Crad');
    assert.equal(pick(3, 8), '{{ a + }}');
    assert.equal(pick(4, 11), 'titel');
    assert.equal(pick(undefined, undefined), '<template>', 'no line: the first line');
    assert.equal(pick(99, 1), '<template>', 'a line past the end: the first line');
});
