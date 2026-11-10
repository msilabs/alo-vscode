'use strict';

const vscode = require('vscode');
const { findProjectRoot, loadCore, listComponents } = require('../lib/project');

// Remembers each Alo project's core and component list, so `components/` is not read again on
// every keystroke. When a file or folder under `components/` or `pages/` is created, deleted or
// renamed, VS Code's file watcher tells us and everything is read fresh next time.
class Projects {
    constructor(log) {
        this.log = log;
        this.cache = new Map();
        this.changed = new vscode.EventEmitter();
        // Other features (the status bar) listen to this to update themselves.
        this.onDidChange = this.changed.event;

        const forget = () => {
            this.cache.clear();
            this.changed.fire();
        };
        // The second pattern covers a whole `components/` or `pages/` folder being deleted or renamed.
        this.watchers = ['**/{components,pages}/**', '**/{components,pages}'].map((pattern) => {
            const watcher = vscode.workspace.createFileSystemWatcher(pattern, false, true, false);
            watcher.onDidCreate(forget);
            watcher.onDidDelete(forget);
            return watcher;
        });
    }

    // { root, core, components, error } for a file, or null when it is not in an Alo project.
    // `components` is null and `error` is Alo's error when a component name is not allowed.
    forFile(fsPath) {
        const root = findProjectRoot(fsPath);
        if (!root) return null;

        // VS Code only watches the open folders, so projects elsewhere are read fresh every time.
        const watched = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(root)) !== undefined;
        if (watched && this.cache.has(root)) return this.cache.get(root);

        const core = loadCore(root);
        let components = null;
        let error = null;
        try {
            components = listComponents(root, core);
        } catch (err) {
            error = err;
            this.log.warn(`Could not list components in ${root}: ${err.message}`);
        }
        const project = { root, core, components, error };
        if (watched) this.cache.set(root, project);
        return project;
    }

    dispose() {
        for (const watcher of this.watchers) watcher.dispose();
        this.changed.dispose();
    }
}

module.exports = { Projects };
