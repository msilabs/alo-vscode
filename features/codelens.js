'use strict';

const path = require('path');
const vscode = require('vscode');
const { routeInfo } = require('../lib/project');

const pages = (n) => `${n} page${n === 1 ? '' : 's'}`;

// The small line above a page or layout: "→ /about/ · Open in browser", "Wraps 6 pages".
function registerCodeLens(context, projects, devServers, log) {
    const changed = new vscode.EventEmitter();

    const provider = {
        onDidChangeCodeLenses: changed.event,
        provideCodeLenses(document) {
            if (document.uri.scheme !== 'file' || !/(^|[\\/])(page|layout|not-found)\.alo$/.test(document.uri.fsPath)) return [];
            const project = projects.forFile(document.uri.fsPath);
            if (!project) return [];

            let info;
            try {
                info = routeInfo(project.root, project.core).get(path.relative(project.root, document.uri.fsPath).split(path.sep).join('/'));
            } catch (err) {
                // A broken pages/ folder: the diagnostics explain it.
                log.warn(`Could not read the routes: ${err.message}`);
                return [];
            }
            if (!info) return [];

            const top = new vscode.Range(0, 0, 0, 0);
            if (info.kind === 'layout') {
                return [new vscode.CodeLens(top, { title: `Wraps ${pages(info.count)}`, command: '' })];
            }

            const route = info.count === undefined ? `→ ${info.path}` : `→ ${info.path} · ${pages(info.count)}`;
            if (!info.open || !vscode.workspace.isTrusted) return [new vscode.CodeLens(top, { title: route, command: '' })];
            const running = devServers.urlFor(project.root);
            return [
                new vscode.CodeLens(top, { title: route, command: '' }),
                new vscode.CodeLens(top, {
                    title: running ? 'Open in browser' : 'Start dev server and open',
                    command: 'alo.previewPage',
                    arguments: [project.root, info.open],
                }),
            ];
        },
    };

    context.subscriptions.push(
        changed,
        vscode.languages.registerCodeLensProvider('alo', provider),
        // A new page, a started server: the lines above the files change.
        projects.onDidChange(() => changed.fire()),
        devServers.onDidChange(() => changed.fire()),
    );
}

module.exports = { registerCodeLens };
