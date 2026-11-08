'use strict';

const { AloError } = require('./errors.js');
const { findExpressionEnd } = require('./html-parser.js');

const FOLDER_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const FILE_NAME = /^[A-Z][A-Za-z0-9]*\.alo$/;

function byName(a, b) {
    if (a.name < b.name) return -1;
    if (a.name > b.name) return 1;
    return 0;
}

function kebabToPascal(name) {
    return name
        .split('-')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join('');
}

function pascalToKebab(name) {
    return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

// Where a component with this Dot name would live, e.g. Blog.PostCard → components/blog/PostCard.alo
function expectedPath(dotName) {
    const parts = dotName.split('.');
    const file = parts.pop();
    return ['components', ...parts.map(pascalToKebab), file + '.alo'].join('/');
}

// Returns Map<dotName, { name, file }>; folders become Dot segments, kebab-case → PascalCase.
function scanComponents(reader, warn) {
    const components = new Map();
    if (!reader.exists('components')) return components;

    function walk(dir, prefix) {
        for (const entry of reader.list(dir).filter((e) => !e.name.startsWith('.')).sort(byName)) {
            const file = `${dir}/${entry.name}`;
            if (entry.isDirectory) {
                if (!FOLDER_NAME.test(entry.name)) {
                    throw new AloError({
                        file,
                        message: `Component folder name \`${entry.name}\` is not allowed.`,
                        hint: `Use lowercase kebab-case, e.g. \`${pascalToKebab(entry.name).replace(/[^a-z0-9-]/g, '-')}\`; it becomes PascalCase in the tag.`,
                    });
                }
                walk(file, [...prefix, kebabToPascal(entry.name)]);
                continue;
            }
            if (!entry.name.endsWith('.alo')) {
                warn({ file, message: 'Only `.alo` files are used in `components/`; this file was ignored.' });
                continue;
            }
            if (!FILE_NAME.test(entry.name)) {
                const base = entry.name.slice(0, -4);
                throw new AloError({
                    file,
                    message: `Component file name \`${entry.name}\` is not allowed.`,
                    hint: `Use PascalCase, e.g. \`${kebabToPascal(base.replace(/[^A-Za-z0-9]+/g, '-'))}.alo\`.`,
                });
            }
            const name = [...prefix, entry.name.slice(0, -4)].join('.');
            components.set(name, { name, file });
        }
    }

    walk('components', []);
    return components;
}

function skipQuoted(code, i) {
    const quote = code[i];
    for (i++; i < code.length; i++) {
        if (code[i] === '\\') i++;
        else if (code[i] === quote) return i + 1;
    }
    return i;
}

// A small JS tokenizer: just enough to tell identifiers and `props.x` apart from strings and properties.
function tokenize(code, tokens = []) {
    let i = 0;
    while (i < code.length) {
        const ch = code[i];
        if (/\s/.test(ch)) {
            i++;
        } else if (ch === '"' || ch === "'") {
            i = skipQuoted(code, i);
            tokens.push({ type: 'string' });
        } else if (ch === '`') {
            i++;
            while (i < code.length && code[i] !== '`') {
                if (code[i] === '\\') {
                    i += 2;
                } else if (code.startsWith('${', i)) {
                    const end = findExpressionEnd(code, i + 2, '}');
                    const stop = end === -1 ? code.length : end;
                    tokenize(code.slice(i + 2, stop), tokens);
                    i = stop + 1;
                } else {
                    i++;
                }
            }
            i++;
            tokens.push({ type: 'string' });
        } else if (code.startsWith('//', i)) {
            const end = code.indexOf('\n', i);
            i = end === -1 ? code.length : end;
        } else if (code.startsWith('/*', i)) {
            const end = code.indexOf('*/', i + 2);
            i = end === -1 ? code.length : end + 2;
        } else if (/[A-Za-z_$]/.test(ch)) {
            const match = /[A-Za-z_$][\w$]*/y;
            match.lastIndex = i;
            const value = match.exec(code)[0];
            tokens.push({ type: 'ident', value });
            i += value.length;
        } else if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(code[i + 1] ?? ''))) {
            const match = /[0-9._a-zA-Z]+/y;
            match.lastIndex = i;
            i += match.exec(code)[0].length;
            tokens.push({ type: 'number' });
        } else if (code.startsWith('...', i)) {
            tokens.push({ type: 'punct', value: '...' });
            i += 3;
        } else if (code.startsWith('?.', i) && !/[0-9]/.test(code[i + 2] ?? '')) {
            tokens.push({ type: 'punct', value: '.' });
            i += 2;
        } else {
            tokens.push({ type: 'punct', value: ch });
            i++;
        }
    }
    return tokens;
}

function isDot(token) {
    return Boolean(token) && token.type === 'punct' && token.value === '.';
}

// Records which `props.x` members an expression reads, and whether `props` is used as a whole
// (`props[x]`, `{{ props }}`), which turns the typo check off.
function collectProps(code, usage) {
    const tokens = tokenize(code);
    tokens.forEach((token, k) => {
        if (token.type !== 'ident' || token.value !== 'props' || isDot(tokens[k - 1])) return;
        const member = tokens[k + 2];
        if (isDot(tokens[k + 1]) && member && member.type === 'ident') usage.props.add(member.value);
        else usage.dynamic = true;
    });
}

const LOGIC = ['for', 'if', 'else-if'];

function collectFromNodes(nodes, usage) {
    for (const node of nodes) {
        if (node.type === 'text') {
            for (const part of node.parts) if (part.type === 'expr') collectProps(part.code, usage);
            continue;
        }
        if (node.type !== 'element') continue;
        for (const attr of node.attrs) {
            if (attr.value === null) continue;
            if (node.name === 'template' && LOGIC.includes(attr.name)) {
                collectProps(attr.value, usage);
                continue;
            }
            for (const part of attr.parts) if (part.type === 'expr') collectProps(part.code, usage);
        }
        collectFromNodes(node.children, usage);
    }
}

// Every `props.x` a component's template reads, for the "prop is never used" warning.
function propUsage(sfc) {
    const usage = { props: new Set(), dynamic: false };
    if (sfc.template) collectFromNodes(sfc.template.children, usage);
    return usage;
}

// Component tag names used anywhere in these nodes, whatever branch they sit in.
function referencedComponents(nodes, found = new Set()) {
    for (const node of nodes) {
        if (node.type !== 'element') continue;
        if (/^[A-Z]/.test(node.name)) found.add(node.name);
        referencedComponents(node.children, found);
    }
    return found;
}

module.exports = {
    scanComponents,
    expectedPath,
    kebabToPascal,
    propUsage,
    referencedComponents,
    tokenize,
};
