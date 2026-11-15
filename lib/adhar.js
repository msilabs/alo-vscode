'use strict';

const fs = require('fs');
const path = require('path');

// In a project made with `adhar init --web` the Alo site is `web/`, and the folder above it holds
// the `adhar` script and `api/`. Returns that folder, or null for any other Alo project.
function findAdharRoot(siteRoot) {
    const parent = path.dirname(siteRoot);
    if (path.join(parent, 'web') !== siteRoot) return null;
    const isFile = fs.existsSync(path.join(parent, 'adhar')) && fs.statSync(path.join(parent, 'adhar')).isFile();
    const hasApi = fs.existsSync(path.join(parent, 'api')) && fs.statSync(path.join(parent, 'api')).isDirectory();
    return isFile && hasApi ? parent : null;
}

module.exports = { findAdharRoot };
