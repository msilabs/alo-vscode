'use strict';

const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const { createOverlayReader } = require('../lib/diagnostics');
const { componentProps } = require('../lib/project');
const { writtenAttributes } = require('../lib/prop-completion');
const { expressionContext, loopVariables, pathAt, describe, mergeItems, dataLocation } = require('../lib/expressions');

const posix = (p) => p.split(path.sep).join('/');

// The text of every open file in the project, saved or not.
function openTexts(root) {
    const texts = new Map();
    for (const document of vscode.workspace.textDocuments) {
        if (document.uri.scheme !== 'file') continue;
        const relative = path.relative(root, document.uri.fsPath);
        if (!relative.startsWith('..') && !path.isAbsolute(relative)) texts.set(posix(relative), document.getText());
    }
    return texts;
}

function allAloFiles(root, dir, found = []) {
    let entries = [];
    try {
        entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true });
    } catch {
        return found;
    }
    for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const relative = `${dir}/${entry.name}`;
        if (entry.isDirectory()) allAloFiles(root, relative, found);
        else if (entry.name.endsWith('.alo')) found.push(relative);
    }
    return found;
}

// Every attribute written on `<Name ...>` anywhere in the project, as prop names, with where.
function passedProps(root, name, texts, propName) {
    const passed = new Map();
    const escaped = name.replace(/\./g, '\\.');
    const tag = new RegExp(`<${escaped}(?=[\\s/>])((?:[^>"']|"[^"]*"|'[^']*')*)>`, 'g');
    for (const file of [...allAloFiles(root, 'pages'), ...allAloFiles(root, 'components')]) {
        const text = texts.get(file) ?? fs.readFileSync(path.join(root, file), 'utf8');
        for (const match of text.matchAll(tag)) {
            for (const attribute of writtenAttributes(' ' + match[1])) {
                const prop = propName(attribute);
                if (!passed.has(prop)) passed.set(prop, file);
            }
        }
    }
    return passed;
}

function resolve(scope, segments) {
    try {
        let value = scope[segments[0]];
        for (const segment of segments.slice(1)) value = value?.[segment];
        return value;
    } catch {
        // Alo's data refuses some reads; there is simply nothing to suggest then.
        return undefined;
    }
}

// Everything an expression in this file can read: data, route, base, and item, props and loop
// variables where they exist. `notes` explains where a name or prop comes from.
function buildScope(document, project, offset) {
    const { root, core } = project;
    const texts = openTexts(root);
    const reader = createOverlayReader(root, texts);
    const file = posix(path.relative(root, document.uri.fsPath));
    const scope = { route: { path: '/' }, base: '/' };
    const notes = { data: 'Everything in data/', route: 'The page being built', base: 'The site’s base path, e.g. `/` or `/repo/`' };

    let collection = null;
    try {
        const made = core.load('data').createData(reader, { mode: 'dev', warn: () => {} });
        scope.data = made.data;
        collection = made.collection;
    } catch {
        // Broken JSON or YAML: the diagnostics show that; there is just no data to suggest.
    }

    if (/(^|\/)\[slug\]\/page\.alo$/.test(file) && collection) {
        try {
            const { pages } = core.load('routes').findRoutes(reader, () => {});
            const route = pages.find((page) => page.file === file);
            if (route?.dynamic) {
                scope.item = mergeItems(collection(route.dynamic.dataDir, file).map((entry) => entry.item));
                notes.item = `One file of ${route.dynamic.dataDir}/`;
            }
        } catch {
            // No files in the folder yet: Alo reports that as an error.
        }
    }

    const component = project.components?.find((c) => c.file === file);
    if (component) {
        const props = {};
        notes.props = `The attributes written on <${component.name}>`;
        const propNotes = {};
        try {
            for (const prop of componentProps(document.getText(), file, core).props) {
                props[prop] = undefined;
                propNotes[prop] = 'Read in this component';
            }
        } catch {
            // A broken component: diagnostics show it.
        }
        const { propName } = core.load('attributes');
        for (const [prop, where] of passedProps(root, component.name, texts, propName)) {
            if (!(prop in props)) props[prop] = undefined;
            propNotes[prop] = propNotes[prop] ? `${propNotes[prop]}; passed in ${where}` : `Passed in ${where}`;
        }
        scope.props = props;
        scope.propNotes = propNotes;
    }

    for (const loop of loopVariables(document.getText(), offset)) {
        const list = loop.source ? resolve(scope, loop.source) : undefined;
        scope[loop.name] = Array.isArray(list) ? (list.some((x) => x && typeof x === 'object') ? mergeItems(list) : list[0]) : undefined;
        notes[loop.name] = loop.source ? `One item of ${loop.source.join('.')}` : 'A loop variable';
        if (loop.index) {
            scope[loop.index] = 0;
            notes[loop.index] = 'The loop’s index, from 0';
        }
    }
    return { scope, notes };
}

function completionProvider(projects) {
    return {
        provideCompletionItems(document, position) {
            if (document.uri.scheme !== 'file') return undefined;
            const offset = document.offsetAt(position);
            const context = expressionContext(document.getText(), offset);
            if (!context) return undefined;
            const project = projects.forFile(document.uri.fsPath);
            if (!project) return undefined;

            const { scope, notes } = buildScope(document, project, offset);
            const range = new vscode.Range(document.positionAt(context.start), position);
            const item = (label, kind, detail, documentation) => {
                const completion = new vscode.CompletionItem(label, kind);
                completion.range = range;
                completion.detail = detail;
                if (documentation) completion.documentation = new vscode.MarkdownString(documentation);
                completion.sortText = '0' + label;
                return completion;
            };

            if (context.path.length === 0) {
                return Object.keys(scope)
                    .filter((name) => name !== 'propNotes')
                    .map((name) => item(name, vscode.CompletionItemKind.Variable, notes[name] ?? '', null));
            }

            const value = resolve(scope, context.path);
            if (Array.isArray(value)) return [item('length', vscode.CompletionItemKind.Property, `number: ${value.length}`, null)];
            if (!value || typeof value !== 'object') return undefined;

            const isProps = context.path.length === 1 && context.path[0] === 'props';
            return Object.keys(value).map((key) =>
                item(key, vscode.CompletionItemKind.Property, isProps ? scope.propNotes?.[key] ?? 'prop' : describe(value[key]), null),
            );
        },
    };
}

// Cmd+Click on `data.site.name` opens data/site.json at the `"name"` line.
function definitionProvider(projects) {
    return {
        provideDefinition(document, position) {
            if (document.uri.scheme !== 'file') return undefined;
            const found = pathAt(document.getText(), document.offsetAt(position));
            if (!found || found.segments[0] !== 'data') return undefined;
            const project = projects.forFile(document.uri.fsPath);
            if (!project) return undefined;
            const location = dataLocation(project.root, found.segments, project.core.load('data').toKey);
            if (!location) return undefined;
            const target = new vscode.Range(location.line, 0, location.line, 0);
            return [
                {
                    originSelectionRange: new vscode.Range(document.positionAt(found.start), document.positionAt(found.end)),
                    targetUri: vscode.Uri.file(location.file),
                    targetRange: target,
                },
            ];
        },
    };
}

function registerExpressionFeatures(context, projects) {
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider('alo', completionProvider(projects), '.'),
        vscode.languages.registerDefinitionProvider('alo', definitionProvider(projects)),
    );
}

module.exports = { registerExpressionFeatures };
