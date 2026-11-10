'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { quickFixes } = require('../../lib/quick-fixes');

// Applies the edits of a fix to the text, from the end so earlier offsets stay right.
function apply(text, edits) {
    return [...edits].sort((a, b) => b.start - a.start).reduce((t, e) => t.slice(0, e.start) + e.newText + t.slice(e.end), text);
}

// `[[` and `]]` mark the underlined text.
function fixes(marked, message) {
    const start = marked.indexOf('[[');
    const end = marked.indexOf(']]') - 2;
    const text = marked.replace('[[', '').replace(']]', '');
    return { text, fixes: quickFixes(text, start, end, message) };
}

test('an unknown component is renamed, with its closing tag', () => {
    const { text, fixes: [fix] } = fixes('<p>[[<Crad]] title="a">x</Crad></p>', 'Component `<Crad>` not found.\nDid you mean `<Card>`? (components/Card.alo)');
    assert.equal(fix.title, 'Change to `<Card>`');
    assert.equal(fix.preferred, true);
    assert.equal(apply(text, fix.edits), '<p><Card title="a">x</Card></p>');
});

test('a self-closing tag has no closing tag to rename', () => {
    const { text, fixes: [fix] } = fixes('[[<Crad]] />\n<p>x</p>', 'Component `<Crad>` not found.\nDid you mean `<Card>`?');
    assert.equal(apply(text, fix.edits), '<Card />\n<p>x</p>');
});

test('nested tags of the same name close in the right place', () => {
    const { text, fixes: [fix] } = fixes('[[<Crad]]><Crad>a</Crad><Crad /></Crad>', 'Component `<Crad>` not found.\nDid you mean `<Card>`?');
    assert.equal(apply(text, fix.edits), '<Card><Crad>a</Crad><Crad /></Card>');
});

test('dotted names and a > inside an attribute value', () => {
    const { text, fixes: [fix] } = fixes('[[<Blog.PostCrd]] a="x > y">b</Blog.PostCrd>', 'Component `<Blog.PostCrd>` not found.\nDid you mean `<Blog.PostCard>`?');
    assert.equal(apply(text, fix.edits), '<Blog.PostCard a="x > y">b</Blog.PostCard>');
});

test('an HTML tag written with a capital letter', () => {
    const { text, fixes: list } = fixes('[[<Section]]>x</Section>', 'Component `<Section>` not found.\nFor the HTML tag, write `<section>` in lowercase.');
    assert.equal(list[0].title, 'Change to the HTML tag `<section>`');
    assert.equal(apply(text, list[0].edits), '<section>x</section>');
});

test('a missing component can be created', () => {
    const { fixes: [fix] } = fixes('[[<Blog.TeamMember]] />', 'Component `<Blog.TeamMember>` not found.\nCreate the component: `components/blog/TeamMember.alo`');
    assert.equal(fix.title, 'Create components/blog/TeamMember.alo');
    assert.deepEqual(fix.create, {
        file: 'components/blog/TeamMember.alo',
        content: '<template>\n    <div class="team-member">\n        <slot />\n    </div>\n</template>\n',
    });
});

test('a mistyped prop becomes the attribute it should be', () => {
    let { text, fixes: [fix] } = fixes('<Card [[titel]]="x" />', '`<Card>` never uses `titel`.\nDid you mean `title`?');
    assert.equal(apply(text, fix.edits), '<Card title="x" />');
    ({ text, fixes: [fix] } = fixes('<Post [[post-dat]]="x" />', '`<Post>` never uses `postDat`.\nDid you mean `postDate`?'));
    assert.equal(fix.title, 'Change to `post-date`');
    assert.equal(apply(text, fix.edits), '<Post post-date="x" />');
});

test('an unknown name inside {{ }} changes, a property with the same name does not', () => {
    const { text, fixes: [fix] } = fixes('<p>[[{{ x.dat + dat.site }}]]</p>', '`dat` is not defined.\nDid you mean `data`? Available here: `data`, `route`.');
    assert.equal(apply(text, fix.edits), '<p>{{ x.dat + data.site }}</p>');
});

test('no fix without a suggestion', () => {
    assert.deepEqual(fixes('<Card [[zzz]]="x" />', '`<Card>` never uses `zzz`.\nUse it in components/Card.alo as `{{ props.zzz }}`, or remove the prop.').fixes, []);
    assert.deepEqual(fixes('<p>[[{{ a + }}]]</p>', 'Cannot parse the expression `a +`').fixes, []);
});
