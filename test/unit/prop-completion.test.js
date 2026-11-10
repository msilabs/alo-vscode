'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { componentTagContext } = require('../../lib/prop-completion');

// `|` marks the cursor.
function contextAt(textWithCursor) {
    const offset = textWithCursor.indexOf('|');
    return componentTagContext(textWithCursor.replace('|', ''), offset);
}

test('inside a component tag, where an attribute name goes', () => {
    assert.deepEqual(contextAt('<p><Card |/></p>'), { name: 'Card', start: 9, written: [] });
    assert.deepEqual(contextAt('<p><Card ti| /></p>'), { name: 'Card', start: 9, written: [] });
    assert.deepEqual(contextAt('<Blog.PostCard |>'), { name: 'Blog.PostCard', start: 15, written: [] });
    assert.deepEqual(contextAt('<Profile\n    full-name="A"\n    |\n/>'), { name: 'Profile', start: 31, written: ['full-name'] });
});

test('lists the attributes already written, before and after the cursor', () => {
    assert.deepEqual(contextAt('<Card title="a" | class="{{ x }}" featured />').written, ['title', 'class', 'featured']);
    assert.deepEqual(contextAt('<Card title="a > b" |>').written, ['title']);
    assert.deepEqual(contextAt('<Card post="{{ a > b }}" |/>').written, ['post']);
});

test('not where a prop name cannot go', () => {
    assert.equal(contextAt('<Card title="ab|" />'), null, 'inside a quoted value');
    assert.equal(contextAt('<Card| />'), null, 'still the tag name');
    assert.equal(contextAt('<Card title="a">|</Card>'), null, 'after the tag closed');
    assert.equal(contextAt('<div |>'), null, 'HTML tag');
    assert.equal(contextAt('<script>\n const a = "<Card |";\n</script>'), null, 'inside <script>');
    assert.equal(contextAt('<!-- <Card | -->'), null, 'inside a comment');
    assert.equal(contextAt('<p>{{ a <Card | }}</p>'), null, 'inside {{ }}');
});
