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

test('a component in a folder written without its folder gets its full name', () => {
    const message = 'Component `<PostCard>` not found.\nDid you mean `<Blog.PostCard>`? (components/blog/PostCard.alo)\nA component in a folder is always written with its full name, even inside the same folder.';
    const { text, fixes: list } = fixes('[[<PostCard]] post="{{ post }}">x</PostCard>', message);
    assert.deepEqual(list.map((f) => f.title), ['Change to `<Blog.PostCard>`']);
    assert.equal(apply(text, list[0].edits), '<Blog.PostCard post="{{ post }}">x</Blog.PostCard>');
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

test('logic on an element is wrapped in a <template>', () => {
    let { text, fixes: [fix] } = fixes('<ul><li [[if]]="ok">a</li></ul>', '`<li if>` will not work.\nLogic only works on `<template>`: wrap the element in `<template if="ok">`.');
    assert.equal(fix.title, 'Wrap in `<template if="ok">`');
    assert.equal(apply(text, fix.edits), '<ul><template if="ok"><li>a</li></template></ul>');

    ({ text, fixes: [fix] } = fixes('<p [[else]]>b</p>', '`<p else>` will not work.\nLogic only works on `<template>`: wrap the element in `<template else>`.'));
    assert.equal(apply(text, fix.edits), '<template else><p>b</p></template>');

    ({ text, fixes: [fix] } = fixes('[[<Card]] for="x in xs" title="a" />', 'Logic can only be written on a <template> tag.\n<template for="x in [1]">'));
    assert.equal(apply(text, fix.edits), '<template for="x in xs"><Card title="a" /></template>');

    ({ text, fixes: [fix] } = fixes('<div><img [[if]]="pic" src="a.png"></div>', '`<img if>` will not work.'));
    assert.equal(apply(text, fix.edits), '<div><template if="pic"><img src="a.png"></template></div>', 'a void element has no closing tag');

    ({ text, fixes: [fix] } = fixes('<li [[else-if]]="b">x</li>', '`<li else-if>` will not work.'));
    assert.equal(apply(text, fix.edits), '<template else-if="b"><li>x</li></template>');
});

test('for and if on the same <template> are nested', () => {
    const { text, fixes: [fix] } = fixes(
        '<template for="x in xs" [[if]]="x.ok">\n    <p>{{ x }}</p>\n</template>',
        '`for` and `if` cannot be on the same `<template>`.\nNest one inside the other:',
    );
    assert.equal(apply(text, fix.edits), '<template for="x in xs"><template if="x.ok">\n    <p>{{ x }}</p>\n</template></template>');
});

test('sort() and reverse() become toSorted() and toReversed()', () => {
    let { text, fixes: [fix] } = fixes('<p>[[{{ data.blog.sort().length }}]]</p>', '`sort()` changes data, so it cannot be used on data arrays.');
    assert.equal(fix.title, 'Use `toSorted()` instead');
    assert.equal(apply(text, fix.edits), '<p>{{ data.blog.toSorted().length }}</p>');
    ({ text, fixes: [fix] } = fixes('<template [[for]]="p in data.blog.reverse()">', '`reverse()` changes data, so it cannot be used on data arrays.'));
    assert.equal(apply(text, fix.edits), '<template for="p in data.blog.toReversed()">');
    assert.deepEqual(fixes('<p>[[{{ data.blog.push(1) }}]]</p>', '`push()` changes data, so it cannot be used on data arrays.').fixes, []);
});

test('a layout without <slot /> gets one before </template>', () => {
    let { text, fixes: [fix] } = fixes('[[<]]template>\n    <main>hi</main>\n</template>\n', 'The layout has no `<slot />`.');
    assert.equal(apply(text, fix.edits), '<template>\n    <main>hi</main>\n    <slot />\n</template>\n');
    ({ text, fixes: [fix] } = fixes('[[<]]template><main></main></template>', 'The layout has no `<slot />`.'));
    assert.equal(apply(text, fix.edits), '<template><main></main><slot /></template>');
});
