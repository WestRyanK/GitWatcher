'use strict';

const rowHeight = 26;
const laneWidth = 14;
const graphPadding = 10;
const nodeRadius = 4;
const pollIntervalMs = 3000;
const laneColors = [
    '#0969da', '#1a7f37', '#cf222e', '#8250df', '#bf8700',
    '#1b7c83', '#d1242f', '#6639ba', '#953800', '#57606a',
];

const elements = {
    repoName: document.getElementById('repo-name'),
    headInfo: document.getElementById('head-info'),
    filter: document.getElementById('filter'),
    scope: document.getElementById('scope'),
    limit: document.getElementById('limit'),
    workspace: document.getElementById('workspace'),
    workspaceSplitter: document.getElementById('workspace-splitter'),
    sidebar: document.getElementById('sidebar'),
    sidebarSplitter: document.getElementById('sidebar-splitter'),
    layout: document.getElementById('layout'),
    splitter: document.getElementById('splitter'),
    graphPane: document.getElementById('graph-pane'),
    detailsPane: document.getElementById('details-pane'),
    branchesPane: document.getElementById('branches-pane'),
    branchesCount: document.getElementById('branches-count'),
    showRemoteBranches: document.getElementById('show-remote-branches'),
    branchFilter: document.getElementById('branch-filter'),
    branches: document.getElementById('branches'),
    workingTreePane: document.getElementById('working-tree-pane'),
    workingTreeCount: document.getElementById('working-tree-count'),
    workingTree: document.getElementById('working-tree'),
    autoRefresh: document.getElementById('auto-refresh'),
    refresh: document.getElementById('refresh'),
    status: document.getElementById('status'),
    optionsToggle: document.getElementById('options-toggle'),
    options: document.getElementById('options'),

    graphScroll: document.getElementById('graph-scroll'),
    graph: document.getElementById('graph'),
    details: document.getElementById('details'),
};

const state = {
    data: null,
    fingerprint: null,
    selectedHash: null,
    rowByHash: new Map(),
    detailsCache: new Map(),
    loading: false,
    branches: null,
    selectedBranch: null,
    workingTree: null,
    workingTreeSerialized: null,
    loadingWorkingTree: false,
};

function laneColor(lane) {
    return laneColors[lane % laneColors.length];
}

// Assigns each commit a lane (column). Commits must be in topological order, children first.
// Each row records the line segments drawn through it: from the top edge into the commit,
// straight through the row, and from the commit down to the bottom edge.
function computeLayout(commits) {
    const lanes = [];
    const rows = [];
    let laneCount = 0;

    for (const commit of commits) {
        const before = lanes.slice();
        let column = lanes.indexOf(commit.hash);
        if (column === -1) {
            column = lanes.indexOf(null);
            if (column === -1) {
                column = lanes.length;
                lanes.push(null);
            }
        }

        const segments = [];
        for (let lane = 0; lane < before.length; lane++) {
            if (before[lane] === commit.hash) {
                segments.push({ kind: 'in', from: lane, to: column, color: laneColor(lane) });
                lanes[lane] = null;
            } else if (before[lane] !== null && before[lane] !== undefined) {
                segments.push({ kind: 'through', from: lane, to: lane, color: laneColor(lane) });
            }
        }

        commit.parents.forEach((parent, index) => {
            let target = lanes.indexOf(parent);
            if (target === -1) {
                target = index === 0 && lanes[column] === null ? column : lanes.indexOf(null);
                if (target === -1) {
                    target = lanes.length;
                    lanes.push(null);
                }
                lanes[target] = parent;
            }
            segments.push({ kind: 'out', from: column, to: target, color: laneColor(target) });
        });

        while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
            lanes.pop();
        }

        laneCount = Math.max(laneCount, before.length, lanes.length, column + 1);
        rows.push({ commit, column, segments });
    }

    return { rows, laneCount };
}

function laneX(lane) {
    return graphPadding + lane * laneWidth;
}

function curve(x1, y1, x2, y2) {
    if (x1 === x2) {
        return `M${x1} ${y1}V${y2}`;
    }
    const middle = (y1 + y2) / 2;
    return `M${x1} ${y1}C${x1} ${middle} ${x2} ${middle} ${x2} ${y2}`;
}

function buildSvg(layout, headHash) {
    const width = graphPadding * 2 + Math.max(layout.laneCount - 1, 0) * laneWidth;
    const height = layout.rows.length * rowHeight;
    const pathsByColor = new Map();
    const addPath = (color, d) => {
        if (!pathsByColor.has(color)) {
            pathsByColor.set(color, []);
        }
        pathsByColor.get(color).push(d);
    };

    const nodes = [];
    layout.rows.forEach((row, index) => {
        const top = index * rowHeight;
        const center = top + rowHeight / 2;
        const bottom = top + rowHeight;
        for (const segment of row.segments) {
            if (segment.kind === 'through') {
                addPath(segment.color, curve(laneX(segment.from), top, laneX(segment.to), bottom));
            } else if (segment.kind === 'in') {
                addPath(segment.color, curve(laneX(segment.from), top, laneX(segment.to), center));
            } else {
                addPath(segment.color, curve(laneX(segment.from), center, laneX(segment.to), bottom));
            }
        }

        const x = laneX(row.column);
        const color = laneColor(row.column);
        const isMerge = row.commit.parents.length > 1;
        if (row.commit.hash === headHash) {
            nodes.push(`<circle cx="${x}" cy="${center}" r="${nodeRadius + 3}" fill="none" stroke="${color}" stroke-width="2"/>`);
        }
        nodes.push(isMerge
            ? `<circle cx="${x}" cy="${center}" r="${nodeRadius}" fill="var(--bg)" stroke="${color}" stroke-width="2.5"/>`
            : `<circle cx="${x}" cy="${center}" r="${nodeRadius}" fill="${color}" stroke="var(--node-stroke)" stroke-width="1.5"/>`);
    });

    const paths = [];
    for (const [color, parts] of pathsByColor) {
        paths.push(`<path d="${parts.join('')}" stroke="${color}" stroke-width="2" fill="none"/>`);
    }

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.innerHTML = paths.join('') + nodes.join('');
    return { svg, width };
}

function formatDate(milliseconds) {
    const date = new Date(milliseconds);
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) {
        element.className = className;
    }
    if (text !== undefined) {
        element.textContent = text;
    }
    return element;
}

function buildRefBadges(data) {
    const badgesByHash = new Map();
    const add = (hash, badge) => {
        if (!badgesByHash.has(hash)) {
            badgesByHash.set(hash, []);
        }
        badgesByHash.get(hash).push(badge);
    };

    const order = { head: 0, branch: 1, remote: 2, tag: 3 };
    for (const ref of data.refs) {
        if (ref.type === 'branch' && ref.name === data.head.branch) {
            add(ref.hash, { type: 'head', label: `HEAD → ${ref.name}` });
        } else {
            add(ref.hash, { type: ref.type, label: ref.type === 'tag' ? `🏷 ${ref.name}` : ref.name });
        }
    }
    if (data.head.hash && !data.head.branch) {
        add(data.head.hash, { type: 'head', label: 'HEAD (detached)' });
    }
    for (const badges of badgesByHash.values()) {
        badges.sort((a, b) => order[a.type] - order[b.type] || a.label.localeCompare(b.label));
    }
    return badgesByHash;
}

function render(data) {
    const scrollTop = elements.graphScroll.scrollTop;
    const layout = computeLayout(data.commits);
    const { svg, width } = buildSvg(layout, data.head.hash);
    const badgesByHash = buildRefBadges(data);

    const fragment = document.createDocumentFragment();
    fragment.appendChild(svg);
    state.rowByHash.clear();

    for (const row of layout.rows) {
        const commit = row.commit;
        const element = createElement('div', 'row');
        element.style.paddingLeft = `${width + 6}px`;
        element.dataset.hash = commit.hash;
        element.dataset.search = `${commit.subject}\n${commit.author}\n${commit.hash}`.toLowerCase();

        for (const badge of badgesByHash.get(commit.hash) || []) {
            const badgeElement = createElement('span', `ref ${badge.type}`, badge.label);
            badgeElement.title = badge.label;
            element.appendChild(badgeElement);
        }
        const subject = createElement('span', 'subject', commit.subject);
        subject.title = commit.subject;
        element.appendChild(subject);
        element.appendChild(createElement('span', 'meta', commit.author));
        element.appendChild(createElement('span', 'meta', formatDate(commit.date)));
        element.appendChild(createElement('span', 'meta hash', commit.hash.slice(0, 8)));

        state.rowByHash.set(commit.hash, element);
        fragment.appendChild(element);
    }

    elements.graph.replaceChildren(fragment);
    elements.graph.style.minWidth = `${width + 400}px`;
    elements.graphScroll.scrollTop = scrollTop;

    elements.repoName.textContent = data.repo;
    document.title = `Git Graph · ${data.repo}`;
    const headLabel = data.head.branch ? data.head.branch : `detached at ${(data.head.hash || '').slice(0, 8)}`;
    const shown = data.total !== null && data.commits.length < data.total
        ? `${data.commits.length.toLocaleString()} of ${data.total.toLocaleString()} commits`
        : `${data.commits.length.toLocaleString()} commits`;
    elements.headInfo.textContent = `HEAD: ${headLabel} · ${shown}`;

    applyFilter();
    if (state.selectedHash && state.rowByHash.has(state.selectedHash)) {
        state.rowByHash.get(state.selectedHash).classList.add('selected');
    }
}

function applyFilter() {
    const query = elements.filter.value.trim().toLowerCase();
    for (const element of state.rowByHash.values()) {
        element.classList.toggle('dimmed', query !== '' && !element.dataset.search.includes(query));
    }
}

function setStatus(text) {
    elements.status.textContent = text;
}

async function fetchJson(url) {
    const response = await fetch(url, { cache: 'no-store' });
    const body = await response.json();
    if (!response.ok) {
        throw new Error(body.error || `HTTP ${response.status}`);
    }
    return body;
}

async function loadGraph() {
    if (state.loading) {
        return;
    }
    state.loading = true;
    setStatus('Loading…');
    try {
        const data = await fetchJson(`/api/graph?scope=${elements.scope.value}&limit=${elements.limit.value}`);
        state.data = data;
        state.fingerprint = data.fingerprint;
        render(data);
        loadBranches();
        setStatus(`Updated ${new Date().toLocaleTimeString()}`);
    } catch (error) {
        setStatus(`Error: ${error.message}`);
    } finally {
        state.loading = false;
    }
}

async function poll() {
    if (!elements.autoRefresh.checked || document.hidden || state.loading) {
        return;
    }
    loadWorkingTree();
    try {
        const { fingerprint } = await fetchJson('/api/version');
        if (fingerprint !== state.fingerprint) {
            await loadGraph();
        }
    } catch (error) {
        setStatus(`Error: ${error.message}`);
    }
}

function selectCommit(hash, scrollIntoView) {
    for (const element of elements.graph.querySelectorAll('.row.selected')) {
        element.classList.remove('selected');
    }
    state.selectedHash = hash;
    writeSetting(settingKeys.selectedCommit, hash);
    const row = state.rowByHash.get(hash);
    if (row) {
        row.classList.add('selected');
        if (scrollIntoView) {
            row.scrollIntoView({ block: 'center' });
        }
    }
    showDetails(hash);
}

async function showDetails(hash) {
    elements.details.replaceChildren(createElement('p', 'muted', 'Loading…'));
    try {
        let details = state.detailsCache.get(hash);
        if (!details) {
            details = await fetchJson(`/api/commit/${hash}`);
            state.detailsCache.set(hash, details);
        }
        if (state.selectedHash === hash) {
            renderDetails(details);
        }
    } catch (error) {
        elements.details.replaceChildren(createElement('p', 'muted', `Error: ${error.message}`));
    }
}

async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return;
    }
    const textArea = createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.select();
    const copied = document.execCommand('copy');
    textArea.remove();
    if (!copied) {
        throw new Error('Copy failed');
    }
}

const copyIcon = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 3.5v-.5A1.5 1.5 0 0 0 9 1.5H4A1.5 1.5 0 0 0 2.5 3v5A1.5 1.5 0 0 0 4 9.5h.5"/></svg>';
const copiedIcon = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 8.5l3.25 3.25L13 5"/></svg>';
const copyFailedIcon = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';

function createCopyButton(text) {
    const button = createElement('button', 'copy-button');
    button.type = 'button';
    const setState = (icon, label, className) => {
        button.innerHTML = icon;
        button.title = label;
        button.setAttribute('aria-label', label);
        button.dataset.state = className;
    };
    setState(copyIcon, 'Copy the full commit hash', 'idle');
    button.addEventListener('click', async () => {
        try {
            await copyText(text);
            setState(copiedIcon, 'Copied', 'copied');
        } catch {
            setState(copyFailedIcon, 'Copy failed', 'failed');
        }
        setTimeout(() => {
            setState(copyIcon, 'Copy the full commit hash', 'idle');
        }, 1500);
    });
    return button;
}

function renderDetails(details) {
    const [subject] = details.message.split('\n');
    const container = document.createDocumentFragment();
    container.appendChild(createElement('h2', null, subject));

    const list = createElement('dl');
    const addField = (label, value) => {
        list.appendChild(createElement('dt', null, label));
        const valueElement = createElement('dd');
        if (value instanceof Node) {
            valueElement.appendChild(value);
        } else {
            valueElement.textContent = value;
        }
        list.appendChild(valueElement);
    };

    const commitField = createElement('span', 'hash-field');
    commitField.appendChild(createElement('span', 'mono', details.hash));
    commitField.appendChild(createCopyButton(details.hash));
    addField('Commit', commitField);
    if (details.parents.length > 0) {
        const parents = createElement('span', 'mono');
        details.parents.forEach((parent, index) => {
            if (index > 0) {
                parents.appendChild(document.createTextNode(' '));
            }
            const link = createElement('a', null, parent.slice(0, 8));
            link.title = state.rowByHash.has(parent) ? 'Go to parent' : 'Parent is not loaded; show more commits';
            link.addEventListener('click', () => selectCommit(parent, true));
            parents.appendChild(link);
        });
        addField(details.parents.length > 1 ? 'Parents' : 'Parent', parents);
    }
    addField('Author', `${details.author.name} <${details.author.email}>`);
    addField('Date', new Date(details.author.date).toLocaleString());
    if (details.committer.name !== details.author.name || details.committer.date !== details.author.date) {
        addField('Committer', `${details.committer.name}, ${new Date(details.committer.date).toLocaleString()}`);
    }
    const refs = state.data ? buildRefBadges(state.data).get(details.hash) : null;
    if (refs && refs.length > 0) {
        const refList = createElement('span');
        for (const badge of refs) {
            refList.appendChild(createElement('span', `ref ${badge.type}`, badge.label));
            refList.appendChild(document.createTextNode(' '));
        }
        addField('Refs', refList);
    }
    container.appendChild(list);
    container.appendChild(createElement('pre', null, details.message));

    const filesHeading = details.parents.length > 1
        ? `Changed files (${details.files.length}, vs. first parent)`
        : `Changed files (${details.files.length})`;
    container.appendChild(createElement('h2', null, filesHeading));
    const files = createElement('ul', 'files');
    for (const file of details.files) {
        const item = createElement('li');
        item.appendChild(createElement('span', `status status-${file.status}`, file.status));
        const pathText = file.oldPath ? `${file.oldPath} → ${file.path}` : file.path;
        item.appendChild(createElement('span', 'mono', pathText));
        files.appendChild(item);
    }
    container.appendChild(files);

    elements.details.replaceChildren(container);
}

const settingKeys = {
    scope: 'git-graph.scope',
    limit: 'git-graph.limit',
    autoRefresh: 'git-graph.auto-refresh',
    commitFilter: 'git-graph.commit-filter',
    branchFilter: 'git-graph.branch-filter',
    selectedCommit: 'git-graph.selected-commit',
    showRemoteBranches: 'git-graph.show-remote-branches',
    collapsedPrefix: 'git-graph.collapsed.',
};
const keyboardResizeStep = 24;
const settingsSaveDelayMs = 300;

// Settings live in a per-user file that the server reads and writes (/api/settings), so they don't depend on the
// browser keeping site data or on the server getting the same port. The page keeps a copy in memory, and saves
// changes shortly after they happen.
const settings = {
    values: {},
    saveTimer: null,
};

function readSetting(key) {
    return Object.hasOwn(settings.values, key) ? settings.values[key] : null;
}

function writeSetting(key, value) {
    if (value === null) {
        delete settings.values[key];
    } else {
        settings.values[key] = String(value);
    }
    clearTimeout(settings.saveTimer);
    settings.saveTimer = setTimeout(saveSettings, settingsSaveDelayMs);
}

function saveSettings(keepalive = false) {
    clearTimeout(settings.saveTimer);
    settings.saveTimer = null;
    return fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings.values),
        keepalive,
    }).catch(() => {
        // The next change saves everything again.
    });
}

// Older versions of the page kept settings in local storage. Move them over the first time.
function readLegacySettings() {
    const legacy = {};
    try {
        for (let index = 0; index < localStorage.length; index++) {
            const key = localStorage.key(index);
            if (key.startsWith('git-graph.')) {
                legacy[key] = localStorage.getItem(key);
            }
        }
    } catch {
        // Local storage can be unavailable; there is nothing to move then.
    }
    return legacy;
}

async function loadSettings() {
    try {
        settings.values = await fetchJson('/api/settings');
    } catch {
        settings.values = {};
    }
    if (Object.keys(settings.values).length === 0) {
        const legacy = readLegacySettings();
        if (Object.keys(legacy).length > 0) {
            settings.values = legacy;
            await saveSettings();
        }
    }
}

window.addEventListener('pagehide', () => {
    if (settings.saveTimer !== null) {
        saveSettings(true);
    }
});

function readBooleanSetting(key, defaultValue) {
    const value = readSetting(key);
    return value === null ? defaultValue : value === 'true';
}

// Each splitter resizes the pane on one side of it by setting a CSS variable on the container that holds both.
const splitters = [
    {
        element: elements.splitter,
        container: elements.layout,
        pane: elements.detailsPane,
        paneIsBefore: false,
        horizontal: true,
        variable: '--details-height',
        storageKey: 'git-graph.details-height',
        minimum: 120,
    },
    {
        element: elements.workspaceSplitter,
        container: elements.workspace,
        pane: elements.sidebar,
        paneIsBefore: true,
        horizontal: false,
        variable: '--sidebar-width',
        storageKey: 'git-graph.sidebar-width',
        minimum: 180,
    },
    {
        element: elements.sidebarSplitter,
        container: elements.sidebar,
        pane: elements.branchesPane,
        paneIsBefore: true,
        horizontal: true,
        variable: '--branches-height',
        storageKey: 'git-graph.branches-height',
        minimum: 80,
    },
];

function paneSize(splitter) {
    const rect = splitter.pane.getBoundingClientRect();
    return splitter.horizontal ? rect.height : rect.width;
}

function setPaneSize(splitter, pixels) {
    const containerRect = splitter.container.getBoundingClientRect();
    const available = splitter.horizontal ? containerRect.height : containerRect.width;
    const maximum = Math.max(available - splitter.minimum, splitter.minimum);
    const clamped = Math.round(Math.min(Math.max(pixels, splitter.minimum), maximum));
    splitter.container.style.setProperty(splitter.variable, `${clamped}px`);
    return clamped;
}

function resetPaneSize(splitter) {
    splitter.container.style.removeProperty(splitter.variable);
    writeSetting(splitter.storageKey, null);
}

function attachSplitter(splitter) {
    const element = splitter.element;
    element.classList.toggle('horizontal', splitter.horizontal);
    element.setAttribute('aria-orientation', splitter.horizontal ? 'horizontal' : 'vertical');

    // Moving the splitter toward the pane makes it smaller.
    const sizeAfterMove = (startSize, movement) => startSize + (splitter.paneIsBefore ? movement : -movement);

    element.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) {
            return;
        }
        event.preventDefault();
        const startPosition = splitter.horizontal ? event.clientY : event.clientX;
        const startSize = paneSize(splitter);
        let size = startSize;

        element.setPointerCapture(event.pointerId);
        element.classList.add('dragging');
        document.body.classList.add('resizing');
        document.body.classList.toggle('resizing-rows', splitter.horizontal);

        const onMove = (moveEvent) => {
            const position = splitter.horizontal ? moveEvent.clientY : moveEvent.clientX;
            size = setPaneSize(splitter, sizeAfterMove(startSize, position - startPosition));
        };
        const onEnd = () => {
            element.removeEventListener('pointermove', onMove);
            element.removeEventListener('pointerup', onEnd);
            element.removeEventListener('pointercancel', onEnd);
            element.classList.remove('dragging');
            document.body.classList.remove('resizing', 'resizing-rows');
            if (size !== startSize) {
                writeSetting(splitter.storageKey, String(size));
            }
        };
        element.addEventListener('pointermove', onMove);
        element.addEventListener('pointerup', onEnd);
        element.addEventListener('pointercancel', onEnd);
    });

    element.addEventListener('dblclick', () => resetPaneSize(splitter));

    element.addEventListener('keydown', (event) => {
        const backKey = splitter.horizontal ? 'ArrowUp' : 'ArrowLeft';
        const forwardKey = splitter.horizontal ? 'ArrowDown' : 'ArrowRight';
        let movement;
        if (event.key === backKey) {
            movement = -keyboardResizeStep;
        } else if (event.key === forwardKey) {
            movement = keyboardResizeStep;
        } else if (event.key === 'Home' || event.key === 'Enter') {
            event.preventDefault();
            resetPaneSize(splitter);
            return;
        } else {
            return;
        }
        event.preventDefault();
        const size = setPaneSize(splitter, sizeAfterMove(paneSize(splitter), movement));
        writeSetting(splitter.storageKey, String(size));
    });
}

// A pane in the sidebar is also closed while the whole sidebar is collapsed to its rail.
function isPaneOpen(pane) {
    return !pane.classList.contains('collapsed') && !pane.closest('.sidebar.collapsed');
}

// A stack drops its splitter and lets the open pane fill the space when either pane is collapsed.
function updateStacks() {
    for (const stack of [elements.sidebar, elements.layout]) {
        const panes = [...stack.querySelectorAll(':scope > .pane')];
        stack.classList.toggle('has-closed-pane', panes.some((pane) => pane.classList.contains('collapsed')));
    }
    elements.workspace.classList.toggle('sidebar-collapsed', elements.sidebar.classList.contains('collapsed'));
}

const paneToggles = [...document.querySelectorAll('.pane-toggle')];

// Several toggles can control one element: Branches, Status, and the rail buttons all control the sidebar.
function setPaneCollapsed(paneId, collapsed) {
    document.getElementById(paneId).classList.toggle('collapsed', collapsed);
    for (const toggle of paneToggles) {
        if (toggle.getAttribute('aria-controls') === paneId) {
            toggle.setAttribute('aria-expanded', String(!collapsed));
            toggle.title = collapsed ? 'Expand' : 'Collapse';
        }
    }
    updateStacks();
}

function loadLayoutSettings() {
    elements.showRemoteBranches.checked = readBooleanSetting(settingKeys.showRemoteBranches, false);

    const paneIds = new Set(paneToggles.map((toggle) => toggle.getAttribute('aria-controls')));
    for (const paneId of paneIds) {
        setPaneCollapsed(paneId, readBooleanSetting(settingKeys.collapsedPrefix + paneId, false));
    }

    for (const splitter of splitters) {
        const savedSize = Number.parseInt(readSetting(splitter.storageKey) || '', 10);
        if (Number.isFinite(savedSize) && savedSize > 0) {
            splitter.container.style.setProperty(splitter.variable, `${savedSize}px`);
        }
    }
}

for (const toggle of paneToggles) {
    toggle.addEventListener('click', () => {
        const paneId = toggle.getAttribute('aria-controls');
        const collapsed = toggle.getAttribute('aria-expanded') === 'true';
        setPaneCollapsed(paneId, collapsed);
        writeSetting(settingKeys.collapsedPrefix + paneId, String(collapsed));
        loadBranches();
        loadWorkingTree();
    });
}

elements.showRemoteBranches.addEventListener('change', () => {
    writeSetting(settingKeys.showRemoteBranches, String(elements.showRemoteBranches.checked));
    renderBranches();
});

elements.branchFilter.addEventListener('input', renderBranches);

splitters.forEach(attachSplitter);

function formatSyncTags(branch) {
    const tags = [];
    if (branch.gone) {
        tags.push({ className: 'gone', text: 'gone', title: `Upstream ${branch.upstream} no longer exists` });
    }
    if (branch.ahead > 0) {
        tags.push({ className: 'ahead', text: `↑${branch.ahead}`, title: `${branch.ahead} ahead of ${branch.upstream}` });
    }
    if (branch.behind > 0) {
        tags.push({ className: 'behind', text: `↓${branch.behind}`, title: `${branch.behind} behind ${branch.upstream}` });
    }
    if (branch.worktree) {
        tags.push({ className: 'worktree', text: 'worktree', title: `Checked out in ${branch.worktree}` });
    }
    return tags;
}

function createBranchItem(branch) {
    const item = createElement('button', 'branch-item');
    item.type = 'button';
    item.dataset.hash = branch.hash;
    item.dataset.name = branch.name;
    item.classList.toggle('current', Boolean(branch.current));
    item.classList.toggle('selected', branch.name === state.selectedBranch);
    item.title = [
        branch.name,
        branch.upstream ? `Upstream: ${branch.upstream}` : null,
        `${branch.hash.slice(0, 8)} ${branch.subject}`,
        `${branch.author}, ${formatDate(branch.date)}`,
    ].filter(Boolean).join('\n');

    const line = createElement('span', 'branch-line');
    if (branch.current) {
        const marker = createElement('span', 'current-marker');
        marker.title = 'Current branch (HEAD)';
        line.appendChild(marker);
    }
    line.appendChild(createElement('span', 'branch-name', branch.name));
    for (const tag of formatSyncTags(branch)) {
        const tagElement = createElement('span', `branch-tag ${tag.className}`, tag.text);
        tagElement.title = tag.title;
        line.appendChild(tagElement);
    }
    item.appendChild(line);
    item.appendChild(createElement('span', 'branch-subject', `${formatDate(branch.date)} · ${branch.subject}`));
    return item;
}

function renderBranches() {
    const data = state.branches;
    if (!data) {
        return;
    }
    const query = elements.branchFilter.value.trim().toLowerCase();
    const matches = (branch) => query === '' || branch.name.toLowerCase().includes(query);
    const showRemote = elements.showRemoteBranches.checked;

    // The current branch first, then the most recently updated.
    const local = data.local.filter(matches).sort((a, b) => Number(b.current) - Number(a.current) || b.date - a.date);
    const remote = showRemote ? data.remote.filter(matches) : [];

    const fragment = document.createDocumentFragment();
    if (showRemote) {
        fragment.appendChild(createElement('div', 'pane-group', `Local (${local.length})`));
    }
    for (const branch of local) {
        fragment.appendChild(createBranchItem(branch));
    }
    if (showRemote) {
        fragment.appendChild(createElement('div', 'pane-group', `Remote (${remote.length})`));
        for (const branch of remote) {
            fragment.appendChild(createBranchItem(branch));
        }
    }
    if (local.length === 0 && remote.length === 0) {
        fragment.appendChild(createElement('p', 'status-summary', query ? 'No branches match.' : 'No branches.'));
    }

    const scrollTop = elements.branches.scrollTop;
    elements.branches.replaceChildren(fragment);
    elements.branches.scrollTop = scrollTop;
    elements.branchesCount.textContent = showRemote
        ? `${data.local.length} local, ${data.remote.length} remote`
        : `${data.local.length}`;
}

async function loadBranches() {
    if (!isPaneOpen(elements.branchesPane)) {
        return;
    }
    try {
        state.branches = await fetchJson('/api/branches');
        renderBranches();
    } catch (error) {
        elements.branches.replaceChildren(createElement('p', 'status-summary', `Error: ${error.message}`));
    }
}

elements.branches.addEventListener('click', (event) => {
    const item = event.target.closest('.branch-item');
    if (!item) {
        return;
    }
    state.selectedBranch = item.dataset.name;
    for (const selected of elements.branches.querySelectorAll('.branch-item.selected')) {
        selected.classList.remove('selected');
    }
    item.classList.add('selected');
    selectCommit(item.dataset.hash, true);
});

function statusClass(code) {
    return /^[AMDRCT]$/.test(code) ? `status-${code === 'T' ? 'M' : code}` : '';
}

function renderWorkingTree() {
    const data = state.workingTree;
    if (!data) {
        return;
    }
    const fragment = document.createDocumentFragment();

    const branch = data.branch;
    const branchLabel = branch.head || `detached at ${(branch.oid || '').slice(0, 8)}`;
    let tracking = 'no upstream';
    if (branch.upstream) {
        const parts = [];
        if (branch.ahead > 0) {
            parts.push(`${branch.ahead} ahead`);
        }
        if (branch.behind > 0) {
            parts.push(`${branch.behind} behind`);
        }
        tracking = parts.length > 0 ? `${parts.join(', ')} of ${branch.upstream}` : `up to date with ${branch.upstream}`;
    }
    fragment.appendChild(createElement('p', 'status-summary', `${branchLabel} · ${tracking}`));

    const groups = [
        { title: 'Conflicts', files: data.conflicted, className: 'status-conflict' },
        { title: 'Staged', files: data.staged },
        { title: 'Changes', files: data.unstaged },
        { title: 'Untracked', files: data.untracked, className: 'status-untracked' },
    ];
    let total = 0;
    for (const group of groups) {
        if (group.files.length === 0) {
            continue;
        }
        total += group.files.length;
        fragment.appendChild(createElement('div', 'pane-group', `${group.title} (${group.files.length})`));
        for (const file of group.files) {
            const item = createElement('div', 'status-item');
            item.appendChild(createElement('span', `status ${group.className || statusClass(file.status)}`, file.status));
            const pathText = file.oldPath ? `${file.oldPath} → ${file.path}` : file.path;
            item.appendChild(createElement('span', 'mono', pathText));
            fragment.appendChild(item);
        }
    }
    if (total === 0) {
        fragment.appendChild(createElement('p', 'status-summary', 'Nothing to commit, working tree clean.'));
    }

    const scrollTop = elements.workingTree.scrollTop;
    elements.workingTree.replaceChildren(fragment);
    elements.workingTree.scrollTop = scrollTop;
    elements.workingTreeCount.textContent = total === 1 ? '1 file' : `${total} files`;
}

async function loadWorkingTree() {
    if (!isPaneOpen(elements.workingTreePane) || state.loadingWorkingTree) {
        return;
    }
    state.loadingWorkingTree = true;
    try {
        const data = await fetchJson('/api/status');
        const serialized = JSON.stringify(data);
        if (serialized !== state.workingTreeSerialized) {
            state.workingTree = data;
            state.workingTreeSerialized = serialized;
            renderWorkingTree();
        }
    } catch (error) {
        elements.workingTree.replaceChildren(createElement('p', 'status-summary', `Error: ${error.message}`));
    } finally {
        state.loadingWorkingTree = false;
    }
}

elements.graph.addEventListener('click', (event) => {
    const row = event.target.closest('.row');
    if (row) {
        selectCommit(row.dataset.hash, false);
    }
});
elements.filter.addEventListener('input', applyFilter);
elements.scope.addEventListener('change', loadGraph);
elements.limit.addEventListener('change', loadGraph);
elements.refresh.addEventListener('click', () => {
    loadGraph();
    loadWorkingTree();
});
document.addEventListener('visibilitychange', poll);

// Toolbar and filter controls whose values are remembered.
const rememberedControls = [
    { element: elements.scope, key: settingKeys.scope, event: 'change' },
    { element: elements.limit, key: settingKeys.limit, event: 'change' },
    { element: elements.autoRefresh, key: settingKeys.autoRefresh, event: 'change', checkbox: true },
    { element: elements.filter, key: settingKeys.commitFilter, event: 'input' },
    { element: elements.branchFilter, key: settingKeys.branchFilter, event: 'input' },
];

function restoreControls() {
    for (const control of rememberedControls) {
        const saved = readSetting(control.key);
        if (saved === null) {
            continue;
        }
        if (control.checkbox) {
            control.element.checked = saved === 'true';
            continue;
        }
        const defaultValue = control.element.value;
        control.element.value = saved;
        // A select ends up with no value when the saved one is no longer an option.
        if (control.element.value !== saved) {
            control.element.value = defaultValue;
        }
    }
}

for (const control of rememberedControls) {
    control.element.addEventListener(control.event, () => {
        writeSetting(control.key, control.checkbox ? String(control.element.checked) : control.element.value);
    });
}


// The Options menu holds the commit filter and the graph settings.
function setOptionsOpen(open) {
    elements.options.hidden = !open;
    elements.optionsToggle.setAttribute('aria-expanded', String(open));
    if (open) {
        elements.filter.focus();
    }
}

elements.optionsToggle.addEventListener('click', () => {
    setOptionsOpen(elements.options.hidden);
});

// Clicking anywhere else, or pressing Escape, closes the menu.
document.addEventListener('pointerdown', (event) => {
    if (!elements.options.hidden
        && !elements.options.contains(event.target)
        && !elements.optionsToggle.contains(event.target)) {
        setOptionsOpen(false);
    }
});

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !elements.options.hidden) {
        setOptionsOpen(false);
        elements.optionsToggle.focus();
    }
});

// Selects the commit selected last time, if it's in the graph.
function restoreSelection() {
    const hash = readSetting(settingKeys.selectedCommit);
    if (hash && state.rowByHash.has(hash)) {
        selectCommit(hash, true);
    }
}

async function initialize() {
    await loadSettings();
    loadLayoutSettings();
    restoreControls();
    await loadGraph();
    restoreSelection();
    loadWorkingTree();
    setInterval(poll, pollIntervalMs);
}

initialize();
