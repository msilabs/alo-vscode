'use strict';

const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const { componentProps, suggestComponent } = require('../lib/project');
const { componentNameStart } = require('../lib/component-completion');
const { componentTagAt, attributeName } = require('../lib/component-tag');
const { componentTagContext } = require('../lib/prop-completion');

// The project (from the cache) for a document, or null outside an Alo project or when Alo
// cannot list its components.
function projectOf(document, projects) {
    if (document.uri.scheme !== 'file') return null;
    const project = projects.forFile(document.uri.fsPath);
    return project?.components ? project : null;
}

// An open editor may hold changes that are not saved yet; those count.
function readFile(fsPath) {
    const open = vscode.workspace.textDocuments.find((d) => d.uri.scheme === 'file' && d.uri.fsPath === fsPath);
    return open ? open.getText() : fs.readFileSync(fsPath, 'utf8');
}

// The component tag under the cursor and the component it names (if it exists).
function tagUnderCursor(document, position, projects) {
    const tag = componentTagAt(document.getText(), document.offsetAt(position));
    if (!tag) return null;
    const project = projectOf(document, projects);
    if (!project) return null;
    const range = new vscode.Range(document.positionAt(tag.start), document.positionAt(tag.end));
    const component = project.components.find((c) => c.name === tag.name);
    return { ...project, tag, range, component };
}

function completionProvider(projects) {
    return {
        provideCompletionItems(document, position) {
            const start = componentNameStart(document.getText(), document.offsetAt(position));
            if (start < 0) return undefined;
            const project = projectOf(document, projects);
            if (!project) return undefined;

            // A component inside itself would never finish rendering.
            const self = path.relative(project.root, document.uri.fsPath).split(path.sep).join('/');
            // The typed part may contain dots (`Blog.Po`), which VS Code's own word range would cut off.
            const range = new vscode.Range(document.positionAt(start), position);

            return project.components
                .filter((component) => component.file !== self)
                .map((component) => {
                    const item = new vscode.CompletionItem(
                        { label: component.name, description: component.file },
                        vscode.CompletionItemKind.Class,
                    );
                    item.range = range;
                    item.detail = 'Alo component';
                    item.documentation = new vscode.MarkdownString(`\`<${component.name} />\` from \`${component.file}\``);
                    // Components come before HTML tags whenever both match equally well.
                    item.sortText = '0' + component.name;
                    return item;
                });
        },
    };
}

// Cmd+Click or F12 on `<Blog.PostCard` opens components/blog/PostCard.alo.
function definitionProvider(projects) {
    return {
        provideDefinition(document, position) {
            const found = tagUnderCursor(document, position, projects);
            if (!found?.component) return undefined;
            return [
                {
                    // Underlines the whole `Blog.PostCard`, not just the word `PostCard`.
                    originSelectionRange: found.range,
                    targetUri: vscode.Uri.file(path.join(found.root, found.component.file)),
                    targetRange: new vscode.Range(0, 0, 0, 0),
                },
            ];
        },
    };
}

function propsText(found) {
    const file = path.join(found.root, found.component.file);
    let usage;
    try {
        usage = componentProps(readFile(file), found.component.file, found.core);
    } catch (err) {
        return `Could not read the component: ${err.message}`;
    }
    if (usage.props.length === 0 && !usage.dynamic) return 'It reads no props.';

    const lines = usage.props.map((prop) => {
        const attribute = attributeName(prop);
        return attribute === prop ? `- \`${attribute}\`` : `- \`${attribute}\` (read as \`props.${prop}\`)`;
    });
    if (usage.dynamic) lines.push('- and more that cannot be listed, e.g. `props[key]`');
    return 'Props it reads:\n\n' + lines.join('\n');
}

// Hovering a component tag shows its file and the props it reads.
function hoverProvider(projects) {
    return {
        provideHover(document, position) {
            const found = tagUnderCursor(document, position, projects);
            if (!found) return undefined;

            const markdown = new vscode.MarkdownString();
            if (found.component) {
                markdown.appendMarkdown(`**\`<${found.tag.name}>\`** · Alo component\n\n`);
                markdown.appendMarkdown(`\`${found.component.file}\`\n\n`);
                markdown.appendMarkdown(propsText(found));
            } else {
                markdown.appendMarkdown(`**\`<${found.tag.name}>\`**: no such component in \`components/\`.`);
                const guess = suggestComponent(found.tag.name, found.components, found.core);
                if (guess) markdown.appendMarkdown(`\n\nDid you mean \`<${guess}>\`?`);
            }
            return new vscode.Hover(markdown, found.range);
        },
    };
}

// Inside `<Profile |>`, suggests the props Profile reads, written as attributes: `full-name="|"`.
function propCompletionProvider(projects) {
    return {
        provideCompletionItems(document, position) {
            const context = componentTagContext(document.getText(), document.offsetAt(position));
            if (!context) return undefined;
            const project = projectOf(document, projects);
            const component = project?.components.find((c) => c.name === context.name);
            if (!component) return undefined;

            let usage;
            try {
                usage = componentProps(readFile(path.join(project.root, component.file)), component.file, project.core);
            } catch {
                return undefined;
            }

            const written = new Set(context.written);
            const range = new vscode.Range(document.positionAt(context.start), position);
            return usage.props
                .filter((prop) => !written.has(attributeName(prop)))
                .map((prop) => {
                    const attribute = attributeName(prop);
                    const item = new vscode.CompletionItem(
                        { label: attribute, description: `props.${prop}` },
                        vscode.CompletionItemKind.Property,
                    );
                    item.insertText = new vscode.SnippetString().appendText(`${attribute}="`).appendTabstop(1).appendText('"');
                    item.range = range;
                    item.detail = `Prop of <${context.name}>`;
                    item.sortText = '0' + attribute;
                    return item;
                });
        },
    };
}

function registerComponentFeatures(context, projects) {
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider('alo', completionProvider(projects), '<', '.'),
        // A space after `<Card` opens the list of props right away.
        vscode.languages.registerCompletionItemProvider('alo', propCompletionProvider(projects), ' '),
        vscode.languages.registerDefinitionProvider('alo', definitionProvider(projects)),
        vscode.languages.registerHoverProvider('alo', hoverProvider(projects)),
    );
}

module.exports = { registerComponentFeatures };
