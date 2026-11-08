'use strict';

const { AloError, suggest } = require('./errors.js');
const { evaluate } = require('./expression.js');
const { VOID_ELEMENTS, HTML_TAGS } = require('./html-tags.js');
const { isStatic, isWholeExpression, wholeValueOutcome, decodeEntities, propName } = require('./attributes.js');
const { LOGIC_ATTRIBUTES, isLogicTemplate } = require('./sfc.js');
const { expectedPath } = require('./components.js');

const UNCHECKED_PROPS = ['class', 'id'];

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const FOR_PATTERN = /^\s*(?:([A-Za-z_$][\w$]*)|\(\s*([A-Za-z_$][\w$]*)\s*,\s*([A-Za-z_$][\w$]*)\s*\))\s+in\s+([\s\S]+)$/;

function escapeHtml(text) {
    return text.replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

function isComponentName(name) {
    return /^[A-Z]/.test(name);
}

function location(ctx, node) {
    return { file: ctx.file, line: node.line, column: node.column, source: ctx.source };
}

function fail(ctx, node, message, hint) {
    throw new AloError({ ...location(ctx, node), message, hint });
}

function describe(value) {
    if (value === null) return '`null`';
    if (value === undefined) return '`undefined`';
    if (typeof value === 'object') return 'an object';
    if (typeof value === 'string') return 'a string';
    return `\`${String(value)}\``;
}

function stringify(value, part, ctx) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'function') {
        ctx.warn({
            ...location(ctx, part),
            message: `\`{{ ${part.code} }}\` is a function, so its source code will be printed.`,
            hint: 'Add `()` to call the function.',
        });
    } else if (typeof value === 'object') {
        const what = Array.isArray(value) ? 'an array, so it will be printed as comma-separated text' : 'an object, so it will be printed as `[object Object]`';
        ctx.warn({
            ...location(ctx, part),
            message: `\`{{ ${part.code} }}\` is ${what}.`,
            hint: Array.isArray(value)
                ? 'Use `<template for>` to show each item, or `.join(\', \')`.'
                : 'Print a single field, e.g. `{{ post.title }}`.',
        });
    }
    return String(value);
}

function evaluatePart(part, ctx) {
    return evaluate(part.code, ctx.scope, location(ctx, part));
}

function renderParts(parts, ctx, inAttribute) {
    let out = '';
    for (const part of parts) {
        if (part.type === 'text') {
            out += part.value;
            continue;
        }
        if (part.raw && inAttribute) {
            fail(ctx, part, '`{{{ }}}` cannot be used in an attribute.', '`{{{ }}}` only works in text. Use `{{ }}` in attributes.');
        }
        const text = stringify(evaluatePart(part, ctx), part, ctx);
        out += part.raw ? text : escapeHtml(text);
    }
    return out;
}

function renderAttribute(attr, ctx) {
    if (isStatic(attr)) return ' ' + attr.raw;

    const quote = attr.quote || '"';
    if (isWholeExpression(attr) && !attr.parts[0].raw) {
        const part = attr.parts[0];
        const outcome = wholeValueOutcome(attr.name, evaluatePart(part, ctx));
        if (outcome.kind === 'drop') return '';
        if (outcome.kind === 'bare') return ' ' + attr.name;
        return ` ${attr.name}=${quote}${escapeHtml(stringify(outcome.value, part, ctx))}${quote}`;
    }
    return ` ${attr.name}=${quote}${renderParts(attr.parts, ctx, true)}${quote}`;
}

function checkElementLogic(node, ctx) {
    const logic = node.attrs.find((attr) => LOGIC_ATTRIBUTES.includes(attr.name));
    if (!logic) return;

    if (isComponentName(node.name)) {
        const value = logic.value === null ? '' : `="${logic.value}"`;
        const rest = node.attrs.filter((attr) => attr !== logic).map((attr) => ' ' + attr.raw).join('');
        fail(ctx, node, 'Logic can only be written on a <template> tag.', `<template ${logic.name}${value}>\n  <${node.name}${rest} />\n</template>`);
    }

    for (const attr of node.attrs) {
        const looksLikeLoop = attr.name === 'for' && attr.value !== null && FOR_PATTERN.test(attr.value);
        if (attr.name === 'for' && !looksLikeLoop) continue;
        if (!LOGIC_ATTRIBUTES.includes(attr.name)) continue;
        ctx.warn({
            ...location(ctx, attr),
            message: `\`<${node.name} ${attr.name}>\` will not work.`,
            hint: `Logic only works on \`<template>\`: wrap the element in \`<template ${attr.name}${attr.value === null ? '' : `="${attr.value}"`}>\`.`,
        });
    }
}

function hasContent(nodes) {
    return nodes.some((node) => !isSkippable(node));
}

function failUnknownComponent(node, ctx) {
    const { components } = ctx.project;
    const close = suggest(node.name, [...components.keys()]);
    const lower = node.name.toLowerCase();
    const hints = [];
    if (HTML_TAGS.has(lower)) hints.push(`For the HTML tag, write \`<${lower}>\` in lowercase.`);
    if (close) hints.push(`Did you mean \`<${close}>\`? (${components.get(close).file})`);
    if (hints.length === 0) hints.push(`Create the component: \`${expectedPath(node.name)}\``);
    fail(ctx, node, `Component \`<${node.name}>\` not found.`, hints.join('\n'));
}

// Whole-value `{{ }}` passes the real value; everything else becomes a plain (unescaped) string.
function propValue(attr, ctx) {
    if (attr.value === null) return true;
    if (isStatic(attr)) return decodeEntities(attr.value);

    const raw = attr.parts.find((part) => part.type === 'expr' && part.raw);
    if (raw) fail(ctx, raw, '`{{{ }}}` cannot be used in an attribute.', 'Use `{{ }}` in props; when the whole value is `{{ }}`, the real value is passed.');
    if (isWholeExpression(attr)) return evaluatePart(attr.parts[0], ctx);

    let out = '';
    for (const part of attr.parts) {
        out += part.type === 'text' ? decodeEntities(part.value) : stringify(evaluatePart(part, ctx), part, ctx);
    }
    return out;
}

function checkPropUsage(node, entry, sfc, ctx) {
    const usage = ctx.project.usage(sfc);
    if (usage.dynamic) return;

    for (const attr of node.attrs) {
        const name = propName(attr.name);
        if (UNCHECKED_PROPS.includes(name) || usage.props.has(name)) continue;
        const close = suggest(name, [...usage.props]);
        const access = /^[A-Za-z_$][\w$]*$/.test(name) ? `props.${name}` : `props['${name}']`;
        ctx.warn({
            ...location(ctx, attr),
            message: `\`<${node.name}>\` never uses \`${name}\`.`,
            hint: close
                ? `Did you mean \`${close}\`?`
                : `Use it in ${entry.file} as \`{{ ${access} }}\`, or remove the prop.`,
        });
    }
}

function renderComponent(node, ctx) {
    const entry = ctx.project.components.get(node.name);
    if (!entry) failUnknownComponent(node, ctx);

    if (ctx.stack.includes(node.name)) {
        const chain = [...ctx.stack.slice(ctx.stack.indexOf(node.name)), node.name].map((name) => `<${name}>`).join(' → ');
        fail(ctx, node, `Components call each other in a loop: ${chain}`, 'Remove the call from one of the components in the chain.');
    }

    const sfc = ctx.project.loadComponent(entry);
    const props = {};
    for (const attr of node.attrs) props[propName(attr.name)] = propValue(attr, ctx);
    checkPropUsage(node, entry, sfc, ctx);

    const content = hasContent(node.children);
    if (content && !sfc.hasSlot) {
        ctx.warn({
            ...location(ctx, node),
            message: `\`<${node.name}>\` has no \`<slot />\`, so the content inside it will not be shown.`,
            hint: `Add \`<slot />\` in ${entry.file} where the content should go.`,
        });
    }

    // Props are read only through `props`, so a prop that was not passed is simply `undefined`.
    const scope = { data: ctx.scope.data, route: ctx.scope.route, base: ctx.scope.base, props: Object.freeze(props) };

    if (!sfc.template) return '';
    const childCtx = {
        ...ctx,
        file: sfc.file,
        source: sfc.source,
        scope,
        slot: content ? { nodes: node.children, ctx } : null,
        stack: [...ctx.stack, node.name],
        inPlainTemplate: false,
        scopeAttr: sfc.scopeAttr,
    };

    try {
        const html = renderNodes(sfc.template.children, childCtx).trim();
        if (!hasScript(sfc)) return html;
        warnAboutScriptRoot(node, sfc, ctx);
        ctx.scripted.add(node.name);
        return markScriptRoot(html, node.name);
    } catch (err) {
        if (err instanceof AloError && err.file === sfc.file && !err.calledFrom) {
            err.calledFrom = { file: ctx.file, line: node.line, column: node.column };
        }
        throw err;
    }
}

// Adds the component's name to data-a-c on the first element of its output, where its script finds `$el`.
// A child component's root may already carry its own name, so names are joined with a space.
function markScriptRoot(html, name) {
    let i = 0;
    for (;;) {
        const lt = html.indexOf('<', i);
        if (lt === -1) return html;
        if (html.startsWith('<!--', lt)) {
            const end = html.indexOf('-->', lt);
            if (end === -1) return html;
            i = end + 3;
            continue;
        }
        if (!/[A-Za-z]/.test(html[lt + 1] ?? '')) {
            i = lt + 1;
            continue;
        }

        let end = lt + 1;
        let quote = null;
        for (; end < html.length; end++) {
            const ch = html[end];
            if (quote) {
                if (ch === quote) quote = null;
            } else if (ch === '"' || ch === "'") {
                quote = ch;
            } else if (ch === '>') {
                break;
            }
        }
        const tag = html.slice(lt, end);
        const existing = / data-a-c="([^"]*)"/.exec(tag);
        const marked = existing ? tag.replace(existing[0], ` data-a-c="${existing[1]} ${name}"`) : `${tag} data-a-c="${name}"`;
        return html.slice(0, lt) + marked + html.slice(end);
    }
}

function hasScript(sfc) {
    return Boolean(sfc.script) && sfc.script.children.some((child) => child.value.trim() !== '');
}

function warnAboutScriptRoot(node, sfc, ctx) {
    const roots = (sfc.template?.children ?? []).filter((child) => child.type === 'element');
    const where = { file: sfc.file, line: sfc.script.line, column: sfc.script.column, source: sfc.source };
    if (roots.length === 0) {
        ctx.warn({
            ...where,
            message: `The script of \`<${node.name}>\` gets no \`$el\`, because its template has no element.`,
            hint: 'Wrap the markup in one element, e.g. `<div>…</div>`.',
        });
    } else if (roots.length > 1) {
        ctx.warn({
            ...where,
            message: `\`<${node.name}>\` has several root elements, so \`$el\` is the first one.`,
            hint: 'Wrap the markup in one element to reach all of it through `$el`.',
        });
    }
}

// Slot content renders in the caller's scope; the fallback renders in the component's own.
// Both are trimmed so the content sits exactly where the <slot> tag was.
function renderSlot(node, ctx) {
    if (ctx.slot && 'html' in ctx.slot) return ctx.slot.html.trim();
    if (ctx.slot) return renderNodes(ctx.slot.nodes, ctx.slot.ctx).trim();
    return renderNodes(node.children, ctx).trim();
}

function renderElement(node, ctx) {
    checkElementLogic(node, ctx);
    if (isComponentName(node.name)) return renderComponent(node, ctx);
    if (node.name === 'slot' && ctx.slot !== undefined && !ctx.inPlainTemplate) return renderSlot(node, ctx);

    let attrs = '';
    for (const attr of node.attrs) attrs += renderAttribute(attr, ctx);
    if (ctx.scopeAttr) attrs += ' ' + ctx.scopeAttr;

    const open = `<${node.name}${attrs}>`;
    if (VOID_ELEMENTS.has(node.name)) return open;

    // Inside a plain HTML <template>, `<slot>` belongs to Web Components and is left alone.
    const childCtx = node.name === 'template' && !ctx.inPlainTemplate ? { ...ctx, inPlainTemplate: true } : ctx;
    return open + renderNodes(node.children, childCtx) + `</${node.name}>`;
}

function renderNode(node, ctx) {
    if (node.type === 'comment') return node.value;
    if (node.type === 'text') return node.rawText ? node.value : renderParts(node.parts, ctx, false);
    return renderElement(node, ctx);
}

// Validates a logic <template> and returns its single logic attribute.
function logicOf(node, ctx) {
    const logic = node.attrs.filter((attr) => LOGIC_ATTRIBUTES.includes(attr.name));
    if (logic.length > 1) {
        fail(
            ctx,
            logic[1],
            `\`${logic[0].name}\` and \`${logic[1].name}\` cannot be on the same \`<template>\`.`,
            `Nest one inside the other:\n<template ${logic[0].name}="...">\n  <template ${logic[1].name}="...">…</template>\n</template>`,
        );
    }

    const other = node.attrs.find((attr) => !LOGIC_ATTRIBUTES.includes(attr.name));
    if (other) {
        fail(ctx, other, `This \`<template>\` is not part of the output, so \`${other.name}\` has no effect here.`, 'Put it on an element inside.');
    }

    const [attr] = logic;
    if (attr.name === 'else') {
        if (attr.value !== null) {
            fail(ctx, attr, '`else` takes no value.', 'Write just `<template else>`. For a condition, use `<template else-if="...">`.');
        }
        return attr;
    }

    if (attr.value === null || attr.value.trim() === '') {
        const example = attr.name === 'for' ? 'post in data.blog' : 'post.featured';
        fail(ctx, attr, `\`${attr.name}\` needs a value.`, `For example: \`<template ${attr.name}="${example}">\``);
    }
    if (attr.parts.some((part) => part.type === 'expr')) {
        const plain = attr.parts.map((part) => (part.type === 'expr' ? part.code : part.value)).join('');
        fail(ctx, attr, `\`${attr.name}\` does not need \`{{ }}\`.`, `Write it directly: \`${attr.name}="${plain}"\``);
    }
    return attr;
}

function renderFor(node, attr, ctx) {
    const match = FOR_PATTERN.exec(attr.value);
    if (!match) {
        fail(ctx, attr, `Cannot parse \`for="${attr.value}"\`.`, 'Write `post in data.blog`, or with an index `(post, i) in data.blog`.');
    }

    const [, single, pairItem, indexName, listCode] = match;
    const itemName = single ?? pairItem;
    const list = evaluate(listCode.trim(), ctx.scope, location(ctx, attr));
    if (!Array.isArray(list)) {
        const hint =
            list !== null && typeof list === 'object'
                ? `To loop over an object, write \`${itemName} in Object.entries(${listCode.trim()})\``
                : 'Check the spelling of the name.';
        fail(ctx, attr, `\`for\` needs an array, but \`${listCode.trim()}\` is ${describe(list)}.`, hint);
    }

    let out = '';
    for (let index = 0; index < list.length; index++) {
        const scope = { ...ctx.scope, [itemName]: list[index] };
        if (indexName) scope[indexName] = index;
        out += renderNodes(node.children, { ...ctx, scope });
    }
    return out;
}

function isSkippable(node) {
    return node.type === 'comment' || (node.type === 'text' && !node.rawText && node.value.trim() === '');
}

// Collects `if` plus the `else-if`/`else` templates right after it; only whitespace and comments may sit between.
function renderIfChain(nodes, start, ctx) {
    const chain = [{ node: nodes[start], attr: logicOf(nodes[start], ctx) }];
    let next = start + 1;

    for (let k = next; ; k++) {
        while (k < nodes.length && isSkippable(nodes[k])) k++;
        const candidate = nodes[k];
        if (!candidate || candidate.type !== 'element' || !isLogicTemplate(candidate)) break;

        const attr = logicOf(candidate, ctx);
        if (attr.name !== 'else-if' && attr.name !== 'else') break;
        chain.push({ node: candidate, attr });
        next = k + 1;
        if (attr.name === 'else') break;
    }

    for (const { node, attr } of chain) {
        if (attr.name === 'else' || evaluate(attr.value, ctx.scope, location(ctx, attr))) {
            return { html: renderNodes(node.children, ctx), next };
        }
    }
    return { html: '', next };
}

// ctx: { file, source, scope, warn(diagnostic), project, slot, stack, inPlainTemplate, scopeAttr, scripted }
//   scripted: Set of component names with a <script> rendered on this page
//   scopeAttr: `data-a-xxxxxx` added to every element when the file has a scoped <style>, else null
//   slot: undefined on pages, null in a component called without content,
//         { nodes, ctx } for component content, { html } for the page inside a layout
function renderNodes(nodes, ctx) {
    let out = '';
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (node.type !== 'element' || !isLogicTemplate(node)) {
            out += renderNode(node, ctx);
            continue;
        }

        const attr = logicOf(node, ctx);
        if (attr.name === 'for') {
            out += renderFor(node, attr, ctx);
        } else if (attr.name === 'if') {
            const { html, next } = renderIfChain(nodes, i, ctx);
            out += html;
            i = next - 1;
        } else {
            fail(
                ctx,
                attr,
                `\`<template ${attr.name}>\` has no \`<template if>\` before it.`,
                '`else-if` and `else` must come right after `<template if>` or `<template else-if>`; only whitespace or comments may be in between.',
            );
        }
    }
    return out;
}

module.exports = { renderNodes, escapeHtml };
