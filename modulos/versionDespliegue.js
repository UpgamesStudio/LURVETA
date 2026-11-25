'use strict';

const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const esCommit = valor => /^[a-f0-9]{40}$/.test(valor || '');

function commitDesplegado() {
    // El despliegue por CLI incluye la revisión del checkout en el propio paquete.
    try {
        const revision = readFileSync(join(__dirname, '..', '.lurveta-build-commit'), 'utf8').trim();
        if (esCommit(revision)) return revision;
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    // Railway proporciona esta variable para los despliegues iniciados por GitHub.
    const revision = process.env.RAILWAY_GIT_COMMIT_SHA;
    return esCommit(revision) ? revision : null;
}

module.exports = { commitDesplegado };
