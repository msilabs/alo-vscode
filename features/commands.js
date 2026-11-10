'use strict';

const path = require('path');
const vscode = require('vscode');
const { findProjectRoot } = require('../lib/project');
const { runAlo } = require('./run-alo');

const RUNS_CODE = 'it runs the code in your templates';

// The project of the active editor, or else the first open folder that is an Alo project.
function activeProject(projects) {
    const document = vscode.window.activeTextEditor?.document;
    if (document?.uri.scheme === 'file') {
        const project = projects.forFile(document.uri.fsPath);
        if (project) return project;
    }
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
        if (findProjectRoot(path.join(folder.uri.fsPath, '_'))) return projects.forFile(path.join(folder.uri.fsPath, '_'));
    }
    vscode.window.showErrorMessage('No Alo project here: Alo looks for a folder with a `pages/` folder in it.');
    return null;
}

// ---------------------------------------------------------------- Alo: New…

const KINDS = [
    { kind: 'page', label: 'Page', detail: 'pages/…/page.alo', example: 'blog/first-post  (or . for the home page)' },
    { kind: 'layout', label: 'Layout', detail: 'pages/…/layout.alo', example: 'blog' },
    { kind: 'component', label: 'Component', detail: 'components/….alo', example: 'Card  or  blog/PostCard' },
    { kind: 'post', label: 'Post', detail: 'data/…/<today>-name.md, as a draft', example: 'blog/hello-world' },
];

// `alo new` in the editor: asks what and the name, creates the file and opens it.
// `kind` and `name` can be given directly (a keybinding or a test); then nothing is asked.
async function createNew(projects, kind, name) {
    const project = activeProject(projects);
    if (!project) return undefined;

    if (!kind) {
        const picked = await vscode.window.showQuickPick(KINDS, { title: 'Alo: New…', placeHolder: 'What do you want to create?' });
        if (!picked) return undefined;
        kind = picked.kind;
    }
    const about = KINDS.find((k) => k.kind === kind);
    if (name === undefined) {
        name = await vscode.window.showInputBox({ title: `Alo: New ${about.label}`, prompt: `For example: ${about.example}`, ignoreFocusOut: true });
        if (name === undefined || name.trim() === '') return undefined;
    }

    const scaffold = project.core.loadCli('scaffold');
    try {
        const { file, note } = scaffold.plan(kind, name.trim());
        scaffold.create(project.root, [kind, name.trim()]);
        const document = await vscode.workspace.openTextDocument(path.join(project.root, ...file.split('/')));
        await vscode.window.showTextDocument(document);
        vscode.window.setStatusBarMessage(`Alo: created ${file}. ${note}`, 6000);
        return { file };
    } catch (err) {
        if (err.name !== 'AloError') throw err;
        vscode.window.showErrorMessage(err.hint ? `${err.message} ${err.hint}` : err.message);
        return { error: err.message };
    }
}

// ---------------------------------------------------------------- Alo: Build

function build(projects) {
    const project = activeProject(projects);
    if (!project) return undefined;
    if (!vscode.workspace.isTrusted) {
        vscode.window.showWarningMessage(`Trust this folder to build it: building ${RUNS_CODE}.`);
        return undefined;
    }
    return new Promise((resolve) => {
        runAlo({
            name: 'Alo: build',
            core: project.core,
            root: project.root,
            args: ['build'],
            onExit(code) {
                if (code === 0) vscode.window.setStatusBarMessage('Alo: the site is built in dist/', 6000);
                else vscode.window.showErrorMessage('Alo: the build failed. The terminal shows why.');
                resolve(code);
            },
        });
    });
}

// ---------------------------------------------------------------- Alo: Start / Stop Dev Server

// One running `alo dev` per project, its URL, and a status bar item that opens it.
class DevServers {
    constructor() {
        this.running = new Map(); // root → { stop, terminal, url }
        this.changed = new vscode.EventEmitter();
        this.onDidChange = this.changed.event;
        this.item = vscode.window.createStatusBarItem('alo.devServer', vscode.StatusBarAlignment.Right, 99);
        this.item.name = 'Alo dev server';
        this.item.command = 'alo.openInBrowser';
        this.onDidChange(() => this.updateItem());
    }

    urlFor(root) {
        return this.running.get(root)?.url ?? null;
    }

    updateItem() {
        const first = [...this.running.values()].find((server) => server.url);
        if (!first) return this.item.hide();
        this.item.text = `$(radio-tower) ${first.url.replace(/^https?:\/\//, '').replace(/\/$/, '')}`;
        this.item.tooltip = `Alo dev server is running at ${first.url}. Click to open it in the browser.`;
        this.item.show();
    }

    // Starts `alo dev` and resolves with its URL once it is listening, or null if it stopped first.
    start(project) {
        if (!vscode.workspace.isTrusted) {
            vscode.window.showWarningMessage(`Trust this folder to run the dev server: ${RUNS_CODE}.`);
            return Promise.resolve(null);
        }
        const existing = this.running.get(project.root);
        if (existing) {
            existing.terminal.show(true);
            return Promise.resolve(existing.url);
        }
        return new Promise((resolve) => {
            // Filled in as the server starts; the status bar and CodeLens read `url`.
            const state = { url: null, stop: null, terminal: null };
            this.running.set(project.root, state);
            let output = '';
            const run = runAlo({
                name: 'Alo: dev',
                core: project.core,
                root: project.root,
                args: ['dev'],
                onOutput: (text) => {
                    if (state.url) return;
                    output += text;
                    const found = /running at (https?:\/\/\S+)/.exec(output);
                    if (found) {
                        state.url = found[1];
                        this.changed.fire();
                        resolve(state.url);
                    }
                },
                onExit: () => {
                    this.running.delete(project.root);
                    this.changed.fire();
                    resolve(null);
                },
            });
            state.stop = run.stop;
            state.terminal = run.terminal;
        });
    }

    stop(root) {
        const server = this.running.get(root);
        if (!server) return false;
        server.stop();
        return true;
    }

    dispose() {
        for (const server of this.running.values()) server.stop();
        this.item.dispose();
        this.changed.dispose();
    }
}

function registerCommands(context, projects) {
    const devServers = new DevServers();
    const openInBrowser = async (root, urlPath = '/') => {
        root ??= activeProject(projects)?.root;
        const url = root && devServers.urlFor(root);
        if (url) await vscode.env.openExternal(vscode.Uri.parse(new URL(urlPath.replace(/^\//, ''), url).toString()));
        return url;
    };

    context.subscriptions.push(
        devServers,
        vscode.commands.registerCommand('alo.new', (kind, name) => createNew(projects, kind, name)),
        vscode.commands.registerCommand('alo.build', () => build(projects)),
        vscode.commands.registerCommand('alo.startDevServer', async () => {
            const project = activeProject(projects);
            return project ? devServers.start(project) : null;
        }),
        vscode.commands.registerCommand('alo.stopDevServer', () => {
            const project = activeProject(projects);
            return project ? devServers.stop(project.root) : false;
        }),
        vscode.commands.registerCommand('alo.openInBrowser', openInBrowser),
        // From a CodeLens: start the server if needed, then open the page.
        vscode.commands.registerCommand('alo.previewPage', async (root, urlPath) => {
            const project = projects.forFile(path.join(root, '_'));
            if (!devServers.urlFor(root) && !(await devServers.start(project))) return null;
            return openInBrowser(root, urlPath);
        }),
    );
    return devServers;
}

module.exports = { registerCommands };
