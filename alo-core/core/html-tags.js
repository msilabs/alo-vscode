'use strict';

const VOID_ELEMENTS = new Set([
    'area',
    'base',
    'br',
    'col',
    'embed',
    'hr',
    'img',
    'input',
    'link',
    'meta',
    'param',
    'source',
    'track',
    'wbr',
]);

const RAW_TEXT_ELEMENTS = new Set(['script', 'style']);

const BOOLEAN_ATTRIBUTES = new Set([
    'disabled',
    'checked',
    'selected',
    'hidden',
    'required',
    'readonly',
    'open',
    'multiple',
    'autofocus',
    'inert',
    'novalidate',
    'defer',
    'async',
    'controls',
    'loop',
    'muted',
    'playsinline',
    'default',
    'reversed',
    'formnovalidate',
    'itemscope',
    'allowfullscreen',
]);

// Used only to suggest "write <div> in lowercase" when someone types <DIV> or <Header>.
const HTML_TAGS = new Set(
    (
        'a abbr address area article aside audio b base bdi bdo blockquote body br button canvas caption cite code col ' +
        'colgroup data datalist dd del details dfn dialog div dl dt em embed fieldset figcaption figure footer form ' +
        'h1 h2 h3 h4 h5 h6 head header hgroup hr html i iframe img input ins kbd label legend li link main map mark ' +
        'menu meta meter nav noscript object ol optgroup option output p picture pre progress q rp rt ruby s samp ' +
        'script search section select slot small source span strong style sub summary sup table tbody td template ' +
        'textarea tfoot th thead time title tr track u ul var video wbr svg math'
    ).split(' '),
);

module.exports = { VOID_ELEMENTS, RAW_TEXT_ELEMENTS, BOOLEAN_ATTRIBUTES, HTML_TAGS };
