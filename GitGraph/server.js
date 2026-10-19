// Read-only live git graph viewer. No npm dependencies.
//
// Usage: node GitGraph/server.js [repoPath]
// Port comes from the PORT environment variable (default 4173).
// The repository defaults to the one containing the current working directory.
// The page's settings are saved per user in ~/.git-graph/settings.json (or GIT_GRAPH_SETTINGS), never in the repo.

'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { execFile } = require('node:child_process');

const port = Number(process.env.PORT) || 4173;
const host = '127.0.0.1';
const publicDir = path.join(__dirname, 'public');
const maxCommitLimit = 20000;
const settingsPath = process.env.GIT_GRAPH_SETTINGS || path.join(os.homedir(), '.git-graph', 'settings.json');
const maxSettingsBytes = 64 * 1024;
const settingKeyPattern = /^git-graph\.[\w.-]{1,100}$/;

// Only these git subcommands are ever run. All of them are read-only. `status` normally refreshes the index,
// but GIT_OPTIONAL_LOCKS=0 (set in runGit) stops it from writing.
const allowedGitCommands = new Set([
    'log', 'rev-list', 'for-each-ref', 'rev-parse', 'symbolic-ref', 'show', 'diff-tree', 'status',
]);

// Which commits to include, as git revision arguments.
const scopeRevisions = {
    current: ['HEAD'],
    local: ['--branches', 'HEAD'],
    all: ['--all', 'HEAD'],
};

const fieldSeparator = '\x1f';
const recordSeparator = '\x1e';

let repoRoot = process.argv[2] || process.cwd();

function runGit(args) {
    if (!allowedGitCommands.has(args[0])) {
        return Promise.reject(new Error(`git ${args[0]} is not allowed`));
    }

    return new Promise((resolve, reject) => {
        execFile(
            'git',
            ['-c', 'core.quotepath=off', '-c', 'log.showSignature=false', ...args],
            {
                cwd: repoRoot,
                maxBuffer: 256 * 1024 * 1024,
                windowsHide: true,
                // Prevent git from taking optional locks or refreshing the index.
                env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C.UTF-8' },
            },
            (error, stdout, stderr) => {
                if (error) {
                    error.message = `${error.message}\n${stderr}`;
                    reject(error);
                    return;
                }
                resolve(stdout);
            });
    });
}

async function runGitOrNull(args) {
    try {
        return (await runGit(args)).trim();
    } catch {
        return null;
    }
}

async function getRefs() {
    const output = await runGit([
        'for-each-ref',
        `--format=%(refname)${fieldSeparator}%(objectname)${fieldSeparator}%(*objectname)`,
        'refs/heads', 'refs/remotes', 'refs/tags',
    ]);

    const refs = [];
    for (const line of output.split('\n')) {
        if (!line) {
            continue;
        }
        const [fullName, objectName, peeledName] = line.split(fieldSeparator);
        let type;
        let name;
        if (fullName.startsWith('refs/heads/')) {
            type = 'branch';
            name = fullName.slice('refs/heads/'.length);
        } else if (fullName.startsWith('refs/remotes/')) {
            type = 'remote';
            name = fullName.slice('refs/remotes/'.length);
            if (name.endsWith('/HEAD')) {
                continue;
            }
        } else {
            type = 'tag';
            name = fullName.slice('refs/tags/'.length);
        }
        // Annotated tags point at a tag object; use the commit it peels to.
        refs.push({ type, name, hash: peeledName || objectName });
    }
    return { refs, raw: output };
}

async function getHead() {
    const hash = await runGitOrNull(['rev-parse', '--verify', '-q', 'HEAD']);
    const branch = await runGitOrNull(['symbolic-ref', '-q', '--short', 'HEAD']);
    return { hash, branch };
}

async function getVersion() {
    const [{ raw }, head] = await Promise.all([getRefs(), getHead()]);
    const fingerprint = crypto.createHash('sha1')
        .update(raw)
        .update(`${head.hash}|${head.branch}`)
        .digest('hex');
    return { fingerprint };
}

async function getGraph(limit, scope) {
    const revisions = scopeRevisions[scope];
    const [{ refs, raw }, head, logOutput, totalOutput, toplevel] = await Promise.all([
        getRefs(),
        getHead(),
        runGit([
            'log', ...revisions, '--topo-order', `--max-count=${limit}`,
            `--format=%H${fieldSeparator}%P${fieldSeparator}%an${fieldSeparator}%at${fieldSeparator}%s${recordSeparator}`,
        ]).catch(() => ''),
        runGitOrNull(['rev-list', ...revisions, '--count']).catch(() => null),
        runGitOrNull(['rev-parse', '--show-toplevel']),
    ]);

    const commits = [];
    for (const record of logOutput.split(recordSeparator)) {
        const trimmed = record.replace(/^\n/, '');
        if (!trimmed) {
            continue;
        }
        const [hash, parents, author, timestamp, subject] = trimmed.split(fieldSeparator);
        commits.push({
            hash,
            parents: parents ? parents.split(' ') : [],
            author,
            date: Number(timestamp) * 1000,
            subject,
        });
    }

    const fingerprint = crypto.createHash('sha1')
        .update(raw)
        .update(`${head.hash}|${head.branch}`)
        .digest('hex');

    return {
        repo: toplevel ? path.basename(toplevel) : path.basename(repoRoot),
        repoPath: toplevel || repoRoot,
        head,
        refs,
        commits,
        limit,
        scope,
        total: totalOutput ? Number(totalOutput) : null,
        fingerprint,
    };
}

async function getCommitDetails(hash) {
    const format = ['%H', '%P', '%an', '%ae', '%at', '%cn', '%ce', '%ct', '%B'].join(fieldSeparator);
    const output = await runGit(['show', '-s', `--format=${format}`, hash, '--']);
    const [fullHash, parents, authorName, authorEmail, authorTime, committerName, committerEmail, committerTime, body] =
        output.split(fieldSeparator);
    const parentList = parents ? parents.split(' ') : [];

    // For merges, list the changes relative to the first parent.
    const diffArgs = parentList.length > 0
        ? ['diff-tree', '-r', '-M', '--name-status', '--no-commit-id', parentList[0], fullHash]
        : ['diff-tree', '-r', '-M', '--name-status', '--no-commit-id', '--root', fullHash];
    const diffOutput = await runGit(diffArgs);

    const files = [];
    for (const line of diffOutput.split('\n')) {
        if (!line) {
            continue;
        }
        const parts = line.split('\t');
        const status = parts[0];
        if (status.startsWith('R') || status.startsWith('C')) {
            files.push({ status: status[0], oldPath: parts[1], path: parts[2] });
        } else {
            files.push({ status, path: parts[1] });
        }
    }

    return {
        hash: fullHash,
        parents: parentList,
        author: { name: authorName, email: authorEmail, date: Number(authorTime) * 1000 },
        committer: { name: committerName, email: committerEmail, date: Number(committerTime) * 1000 },
        message: body.replace(/\s+$/, ''),
        files,
        comparedTo: parentList[0] || null,
    };
}

// Parses for-each-ref's %(upstream:track) value, such as "[ahead 2, behind 1]" or "[gone]".
function parseTrack(track) {
    const ahead = /ahead (\d+)/.exec(track);
    const behind = /behind (\d+)/.exec(track);
    return {
        ahead: ahead ? Number(ahead[1]) : 0,
        behind: behind ? Number(behind[1]) : 0,
        gone: track.includes('gone'),
    };
}

async function getBranches() {
    const format = [
        '%(HEAD)', '%(refname)', '%(objectname)', '%(upstream:short)', '%(upstream:track)',
        '%(worktreepath)', '%(committerdate:unix)', '%(authorname)', '%(contents:subject)',
    ].join(fieldSeparator);
    const [output, toplevel] = await Promise.all([
        runGit(['for-each-ref', `--format=${format}`, '--sort=-committerdate', 'refs/heads', 'refs/remotes']),
        runGitOrNull(['rev-parse', '--show-toplevel']),
    ]);
    const currentWorktree = toplevel ? path.resolve(toplevel).toLowerCase() : null;

    const local = [];
    const remote = [];
    for (const line of output.split('\n')) {
        if (!line) {
            continue;
        }
        const [head, fullName, hash, upstream, track, worktreePath, timestamp, author, subject] = line.split(fieldSeparator);
        const isRemote = fullName.startsWith('refs/remotes/');
        const name = fullName.replace(/^refs\/(heads|remotes)\//, '');
        if (isRemote && name.endsWith('/HEAD')) {
            continue;
        }
        const branch = {
            name,
            hash,
            date: Number(timestamp) * 1000,
            author,
            subject,
        };
        if (isRemote) {
            remote.push(branch);
        } else {
            const otherWorktree = worktreePath && path.resolve(worktreePath).toLowerCase() !== currentWorktree
                ? worktreePath
                : null;
            local.push({
                ...branch,
                current: head === '*',
                upstream: upstream || null,
                ...parseTrack(track),
                worktree: otherWorktree,
            });
        }
    }
    return { local, remote };
}

// Parses `git status --porcelain=v2 --branch -z`. See git-status(1), "Porcelain Format Version 2".
async function getStatus() {
    const output = await runGit(['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=normal']);
    const tokens = output.split('\0');
    const status = {
        branch: { head: null, oid: null, upstream: null, ahead: 0, behind: 0 },
        staged: [],
        unstaged: [],
        untracked: [],
        conflicted: [],
    };

    // Returns the text after the first `count` space-separated fields.
    const rest = (token, count) => {
        let index = 0;
        for (let field = 0; field < count; field++) {
            index = token.indexOf(' ', index) + 1;
        }
        return token.slice(index);
    };

    for (let index = 0; index < tokens.length; index++) {
        const token = tokens[index];
        if (!token) {
            continue;
        }
        if (token.startsWith('# ')) {
            const [, key, ...values] = token.split(' ');
            if (key === 'branch.oid') {
                status.branch.oid = values[0] === '(initial)' ? null : values[0];
            } else if (key === 'branch.head') {
                status.branch.head = values[0] === '(detached)' ? null : values[0];
            } else if (key === 'branch.upstream') {
                status.branch.upstream = values[0];
            } else if (key === 'branch.ab') {
                status.branch.ahead = Math.abs(Number(values[0]));
                status.branch.behind = Math.abs(Number(values[1]));
            }
            continue;
        }

        const type = token[0];
        if (type === '?') {
            status.untracked.push({ status: '?', path: token.slice(2) });
        } else if (type === 'u') {
            status.conflicted.push({ status: token.slice(2, 4), path: rest(token, 10) });
        } else if (type === '1' || type === '2') {
            const [stagedCode, unstagedCode] = token.slice(2, 4);
            const filePath = rest(token, type === '1' ? 8 : 9);
            // Renames and copies are followed by a token holding the original path.
            const oldPath = type === '2' ? tokens[++index] : undefined;
            if (stagedCode !== '.') {
                status.staged.push({ status: stagedCode, path: filePath, oldPath });
            }
            if (unstagedCode !== '.') {
                status.unstaged.push({ status: unstagedCode, path: filePath });
            }
        }
    }
    return status;
}

async function readSettings() {
    try {
        const settings = JSON.parse(await fs.promises.readFile(settingsPath, 'utf8'));
        return settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
    } catch {
        // A missing or damaged file means no saved settings yet.
        return {};
    }
}

// Accepts only a flat object of "git-graph.*" keys with short string values.
function validateSettings(settings) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
        return false;
    }
    return Object.entries(settings).every(([key, value]) =>
        settingKeyPattern.test(key) && typeof value === 'string' && value.length <= 1000);
}

async function writeSettings(settings) {
    await fs.promises.mkdir(path.dirname(settingsPath), { recursive: true });
    // Write a temporary file and rename it, so a crash never leaves half a file.
    const temporaryPath = `${settingsPath}.${process.pid}.tmp`;
    await fs.promises.writeFile(temporaryPath, JSON.stringify(settings, null, 2), 'utf8');
    await fs.promises.rename(temporaryPath, settingsPath);
}

function readRequestBody(request) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        request.on('data', (chunk) => {
            size += chunk.length;
            if (size > maxSettingsBytes) {
                reject(new Error('Request body is too large.'));
                request.destroy();
                return;
            }
            chunks.push(chunk);
        });
        request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        request.on('error', reject);
    });
}

// Saving settings is the only write. Requiring a JSON content type and this page's own origin stops other
// websites from changing them: a cross-site JSON request needs a CORS preflight, which this server never allows.
function isSameOriginJsonRequest(request) {
    const contentType = (request.headers['content-type'] || '').split(';')[0].trim();
    const origin = request.headers.origin;
    const hostHeader = request.headers.host;
    return contentType === 'application/json' && Boolean(origin) && Boolean(hostHeader)
        && (origin === `http://${hostHeader}`);
}

const staticFiles = {
    '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
    '/index.html': { file: 'index.html', type: 'text/html; charset=utf-8' },
    '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
    '/style.css': { file: 'style.css', type: 'text/css; charset=utf-8' },
};

function sendJson(response, statusCode, body) {
    response.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
    });
    response.end(JSON.stringify(body));
}

const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${host}`);

    try {
        if (url.pathname === '/api/settings' && request.method === 'PUT') {
            if (!isSameOriginJsonRequest(request)) {
                sendJson(response, 403, { error: 'Settings can only be saved from the viewer page.' });
                return;
            }
            const settings = JSON.parse(await readRequestBody(request));
            if (!validateSettings(settings)) {
                sendJson(response, 400, { error: 'Settings must be an object of git-graph.* string values.' });
                return;
            }
            await writeSettings(settings);
            sendJson(response, 200, { saved: true });
            return;
        }

        if (request.method !== 'GET' && request.method !== 'HEAD') {
            sendJson(response, 405, { error: 'Only GET is supported, except PUT /api/settings.' });
            return;
        }

        if (url.pathname === '/api/settings') {
            sendJson(response, 200, await readSettings());
            return;
        }

        if (url.pathname === '/api/version') {
            sendJson(response, 200, await getVersion());
            return;
        }

        if (url.pathname === '/api/graph') {
            const requested = Number.parseInt(url.searchParams.get('limit') || '500', 10);
            const limit = Math.min(Math.max(Number.isFinite(requested) ? requested : 500, 1), maxCommitLimit);
            const scope = url.searchParams.get('scope') || 'all';
            if (!Object.hasOwn(scopeRevisions, scope)) {
                sendJson(response, 400, { error: `Unknown scope '${scope}'.` });
                return;
            }
            sendJson(response, 200, await getGraph(limit, scope));
            return;
        }

        if (url.pathname === '/api/branches') {
            sendJson(response, 200, await getBranches());
            return;
        }

        if (url.pathname === '/api/status') {
            sendJson(response, 200, await getStatus());
            return;
        }

        const commitMatch = /^\/api\/commit\/([0-9a-f]{4,40})$/i.exec(url.pathname);
        if (commitMatch) {
            sendJson(response, 200, await getCommitDetails(commitMatch[1]));
            return;
        }

        const staticFile = staticFiles[url.pathname];
        if (staticFile) {
            const content = await fs.promises.readFile(path.join(publicDir, staticFile.file));
            response.writeHead(200, { 'Content-Type': staticFile.type, 'Cache-Control': 'no-cache' });
            response.end(content);
            return;
        }

        sendJson(response, 404, { error: 'Not found' });
    } catch (error) {
        sendJson(response, 500, { error: error.message });
    }
});

// When another program runs this server for itself (the Windows Terminal overlay sets GIT_GRAPH_PARENT_PID), exit
// once that program is gone, so a crash never leaves the server running.
const parentProcessId = Number(process.env.GIT_GRAPH_PARENT_PID) || null;
if (parentProcessId) {
    setInterval(() => {
        try {
            process.kill(parentProcessId, 0);
        } catch (error) {
            // EPERM means the process exists but can't be signaled.
            if (error.code !== 'EPERM') {
                process.exit(0);
            }
        }
    }, 2000).unref();
}

server.listen(port, host, () => {
    console.log(`git-graph: serving ${repoRoot} at http://localhost:${port}`);
});
