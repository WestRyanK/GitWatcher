'use strict';

const rowHeight = 26;
const laneWidth = 14;
const graphPadding = 10;
const nodeRadius = 4;
const pollIntervalMs = 3000;
// Cool colors only, so a branch never looks like an error or a warning. They alternate between the blue-violet and
// green-teal families so that neighbors in the list (lanes next to each other) never look alike, including where the
// list wraps around, and all of them read on both the light and dark themes. The first is the main line's.
const laneColors = [
    '#2f81f7', // blue
    '#b04fc9', // orchid
    '#1f9d8b', // teal
    '#5a67d8', // indigo
    '#2da44e', // green
    '#a78bfa', // lavender
    '#0aa2c0', // cyan
    '#8957e5', // violet
    '#6e7f96', // slate
    '#0f766e', // pine
];

const elements = {
    repoName: document.getElementById('repo-name'),
    headLink: document.getElementById('head-link'),
    headCount: document.getElementById('head-count'),
    shortcuts: document.getElementById('shortcuts'),
    shortcutsClose: document.getElementById('shortcuts-close'),
    filter: document.getElementById('filter'),
    scope: document.getElementById('scope'),
    limit: document.getElementById('limit'),
    workspace: document.getElementById('workspace'),
    workspaceSplitter: document.getElementById('workspace-splitter'),
    sidebar: document.getElementById('sidebar'),
    sidebarPanes: document.getElementById('sidebar-panes'),
    sidebarSplitter: document.getElementById('sidebar-splitter'),
    layout: document.getElementById('layout'),
    splitter: document.getElementById('splitter'),
    graphPane: document.getElementById('graph-pane'),
    detailsPane: document.getElementById('details-pane'),
    branchesPane: document.getElementById('branches-pane'),
    branchesCount: document.getElementById('branches-count'),
    branchFilter: document.getElementById('branch-filter'),
    branches: document.getElementById('branches'),
    workingTreePane: document.getElementById('working-tree-pane'),
    workingTreeCount: document.getElementById('working-tree-count'),
    workingTree: document.getElementById('working-tree'),
    autoRefresh: document.getElementById('auto-refresh'),
    refresh: document.getElementById('refresh'),
    status: document.getElementById('status'),
    repoBanner: document.getElementById('repo-banner'),
    repoBannerTitle: document.getElementById('repo-banner-title'),
    repoBannerMessage: document.getElementById('repo-banner-message'),
    repoBannerHint: document.getElementById('repo-banner-hint'),
    optionsToggle: document.getElementById('options-toggle'),
    options: document.getElementById('options'),

    graphScroll: document.getElementById('graph-scroll'),
    graphPane: document.getElementById('graph-pane'),
    columnHeaders: document.getElementById('column-headers'),
    columnToggles: [...document.querySelectorAll('.column-toggle')],
    tagGrouping: document.getElementById('tag-grouping'),
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

// Finds the default branch's commits: its first-parent history, which is drawn in the leftmost lane, and everything
// merged into it. Uses both the local branch and its copy on origin, and falls back to main, then master, when
// origin/HEAD isn't set.
function findMainBranch(data) {
    const commitsByHash = new Map(data.commits.map((commit) => [commit.hash, commit]));
    const mainLine = new Set();
    const merged = new Set();
    const names = [...new Set([data.defaultBranch, 'main', 'master'].filter(Boolean))];
    for (const name of names) {
        const tips = data.refs.filter((ref) =>
            (ref.type === 'branch' && ref.name === name) || (ref.type === 'remote' && ref.name === `origin/${name}`));
        if (tips.length === 0) {
            continue;
        }
        const pending = [];
        for (const tip of tips) {
            let commit = commitsByHash.get(tip.hash);
            while (commit && !mainLine.has(commit.hash)) {
                mainLine.add(commit.hash);
                commit = commitsByHash.get(commit.parents[0]);
            }
            pending.push(tip.hash);
        }
        while (pending.length > 0) {
            const commit = commitsByHash.get(pending.pop());
            if (commit && !merged.has(commit.hash)) {
                merged.add(commit.hash);
                pending.push(...commit.parents);
            }
        }
        break;
    }
    return { mainLine, merged };
}

// Assigns each commit a lane (column). Commits must be in topological order, children first.
// Each row records the line segments drawn through it: from the top edge into the commit,
// through the row, and from the commit down to the bottom edge.
// Lane 0 is kept for the main line, branches merged into main sit left of branches that aren't, and a merge's parents
// are laid out left to right in parent order. A lane is { hash, merged, color }: the commit it leads to, whether the
// commit that drew it is merged into main, and its color, which stays the same when the lane moves sideways. Two lanes
// can lead to the same commit; they join at that commit's row.
function computeLayout(commits, { mainLine, merged }) {
    const lanes = [];
    const rows = [];
    let laneCount = 0;
    let column = -1;
    const firstFreeLane = mainLine.size > 0 ? 1 : 0;

    // A free lane at or after start for a merged branch, left of every unmerged one. When there's no room, one is
    // inserted there and the unmerged lanes move right.
    const mergedLane = (start) => {
        const unmerged = lanes.findIndex((lane) => lane !== null && !lane.merged);
        const end = unmerged === -1 ? lanes.length : unmerged;
        for (let index = start; index < end; index++) {
            if (lanes[index] === null) {
                return index;
            }
        }
        const index = Math.max(start, end);
        while (lanes.length < index) {
            lanes.push(null);
        }
        lanes.splice(index, 0, null);
        if (column >= index) {
            column++;
        }
        return index;
    };

    // A free lane at or after start for an unmerged branch, right of every merged one.
    const unmergedLane = (start) => {
        let index = start;
        lanes.forEach((lane, at) => {
            if (lane !== null && lane.merged) {
                index = Math.max(index, at + 1);
            }
        });
        while (index < lanes.length && lanes[index] !== null) {
            index++;
        }
        while (lanes.length <= index) {
            lanes.push(null);
        }
        return index;
    };

    // A color for a lane starting at index: the lane's usual color, unless an open lane already has it. Lane 0's color
    // is kept for the main line.
    const newColor = (index) => {
        const used = new Set(lanes.filter((lane) => lane !== null).map((lane) => lane.color));
        if (index === 0 || !used.has(laneColor(index))) {
            return laneColor(index);
        }
        return laneColors.slice(firstFreeLane).find((color) => !used.has(color)) ?? laneColor(index);
    };

    for (const commit of commits) {
        const before = lanes.slice();
        const isMerged = merged.has(commit.hash);
        const newLane = (start) => (isMerged ? mergedLane(start) : unmergedLane(start));
        // A merged commit only follows lanes drawn by merged commits, so an unmerged branch never carries on as merged.
        const canUse = (lane, hash) => lane !== null && lane.hash === hash && (lane.merged || !isMerged);

        column = -1;
        if (mainLine.has(commit.hash) && (lanes.length === 0 || lanes[0] === null || lanes[0].hash === commit.hash)) {
            column = 0;
            if (lanes.length === 0) {
                lanes.push(null);
            }
        } else {
            column = lanes.findIndex((lane) => canUse(lane, commit.hash));
            if (column === -1) {
                column = newLane(firstFreeLane);
            }
        }
        // The commit takes the color of the lane it sits in, and passes it on to its first parent's lane.
        const color = lanes[column] ? lanes[column].color : newColor(column);
        lanes.forEach((lane, index) => {
            if (lane !== null && lane.hash === commit.hash) {
                lanes[index] = null;
            }
        });

        const parentLanes = [];
        let previous = -1;
        commit.parents.forEach((parent, index) => {
            let target;
            if (index === 0) {
                // The branch carries on down its own lane, even if another lane already leads to the first parent, so
                // where it forks off another branch it joins at the fork commit rather than partway down a line.
                target = column;
            } else {
                // Later parents go right of the one before, in a second lane if the parent's lane is to the left.
                target = lanes.findIndex((lane, at) => at > previous && canUse(lane, parent));
                if (target === -1) {
                    target = newLane(Math.max(previous + 1, firstFreeLane));
                }
            }
            if (lanes[target] === null) {
                lanes[target] = { hash: parent, merged: isMerged, color: index === 0 ? color : newColor(target) };
            }
            previous = target;
            parentLanes.push(lanes[target]);
        });

        // Lanes are matched up by identity, since an inserted lane can move the ones to its right.
        const segments = [];
        before.forEach((lane, index) => {
            if (lane === null) {
                return;
            }
            if (lane.hash === commit.hash) {
                segments.push({ kind: 'in', from: index, to: column, color: lane.color });
            } else {
                segments.push({ kind: 'through', from: index, to: lanes.indexOf(lane), color: lane.color });
            }
        });
        for (const lane of parentLanes) {
            segments.push({ kind: 'out', from: column, to: lanes.indexOf(lane), color: lane.color });
        }

        while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
            lanes.pop();
        }

        laneCount = Math.max(laneCount, before.length, lanes.length, column + 1);
        rows.push({ commit, column, color, segments });
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
        const color = row.color;
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

    // The default branch, and its copy on origin, come before every other label, picked the same way as in
    // findMainBranch.
    const isMainRef = (ref, name) =>
        (ref.type === 'branch' && ref.name === name) || (ref.type === 'remote' && ref.name === `origin/${name}`);
    const mainName = [data.defaultBranch, 'main', 'master']
        .find((name) => name && data.refs.some((ref) => isMainRef(ref, name)));

    const order = { head: 0, branch: 1, remote: 2, tag: 3 };
    for (const ref of data.refs) {
        const main = isMainRef(ref, mainName);
        if (ref.type === 'branch' && ref.name === data.head.branch) {
            add(ref.hash, { type: 'head', label: `HEAD → ${ref.name}`, main });
        } else {
            add(ref.hash, { type: ref.type, label: ref.type === 'tag' ? `🏷 ${ref.name}` : ref.name, main });
        }
    }
    if (data.head.hash && !data.head.branch) {
        add(data.head.hash, { type: 'head', label: 'HEAD (detached)', main: false });
    }
    for (const badges of badgesByHash.values()) {
        badges.sort((a, b) => b.main - a.main || order[a.type] - order[b.type] || a.label.localeCompare(b.label));
    }
    return badgesByHash;
}

function render(data) {
    const scrollTop = elements.graphScroll.scrollTop;
    const layout = computeLayout(data.commits, findMainBranch(data));
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

        // The branch and tag labels and the subject share one column, so the columns after it line up on every row.
        const description = createElement('span', 'column col-description');
        for (const badge of badgesByHash.get(commit.hash) || []) {
            const badgeElement = createElement('span', `ref ${badge.type}`, badge.label);
            badgeElement.title = badge.label;
            description.appendChild(badgeElement);
        }
        const subject = createElement('span', 'subject', commit.subject);
        subject.title = commit.subject;
        description.appendChild(subject);
        element.appendChild(description);
        element.appendChild(createElement('span', 'meta column col-author', commit.author));
        element.appendChild(createElement('span', 'meta column col-date', formatDate(commit.date)));
        element.appendChild(createElement('span', 'meta column col-hash hash', commit.hash.slice(0, 8)));

        state.rowByHash.set(commit.hash, element);
        fragment.appendChild(element);
    }

    elements.graph.replaceChildren(fragment);
    // The columns fit the pane instead of scrolling sideways, so their labels in the title row stay over them.
    elements.graph.style.minWidth = `${width + 60}px`;
    alignColumnHeaders();
    elements.graphScroll.scrollTop = scrollTop;

    elements.repoName.textContent = data.repo;
    document.title = `Git Watcher · ${data.repo}`;
    const headLabel = data.head.branch ? data.head.branch : `detached at ${(data.head.hash || '').slice(0, 8)}`;
    const shown = data.total !== null && data.commits.length < data.total
        ? `${data.commits.length.toLocaleString()} of ${data.total.toLocaleString()} commits`
        : `${data.commits.length.toLocaleString()} commits`;
    elements.headLink.textContent = `HEAD: ${headLabel}`;
    elements.headCount.textContent = ` · ${shown}`;

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
    elements.status.title = text;
}

// Shows the banner for a missing repository with the server's explanation, or hides it when message is null.
// notRepository means the followed shell is in a folder outside any repository, rather than the repository being gone.
function setRepoProblem(message, notRepository = false) {
    elements.repoBanner.hidden = message === null;
    elements.repoBannerTitle.textContent = notRepository ? 'Not a git repository' : 'Repository not found';
    elements.repoBannerMessage.textContent = message ?? '';
    elements.repoBannerHint.textContent = notRepository
        ? 'Git Watcher shows a repository again once the terminal changes to a folder in one.'
        : 'Git Watcher keeps checking and picks up again if it comes back.';
    document.body.classList.toggle('repo-missing', message !== null);
}

function describeError(error) {
    if (error.notRepository) {
        return 'Not a git repository';
    }
    return error.repoMissing ? 'Repository not found' : `Error: ${error.message}`;
}

async function fetchJson(url) {
    const response = await fetch(url, { cache: 'no-store' });
    const body = await response.json();
    if (!response.ok) {
        if (body.repoMissing) {
            setRepoProblem(body.error, Boolean(body.notRepository));
        }
        throw Object.assign(new Error(body.error || `HTTP ${response.status}`), {
            repoMissing: Boolean(body.repoMissing),
            notRepository: Boolean(body.notRepository),
        });
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
        // A followed shell moved to another repository. Start over, so nothing from the last one is left on the page.
        if (state.data && data.repoRoot !== state.data.repoRoot) {
            location.reload();
            return;
        }
        setRepoProblem(null);
        state.data = data;
        state.fingerprint = data.fingerprint;
        render(data);
        loadBranches();
        setStatus(`Updated ${new Date().toLocaleTimeString()}`);
    } catch (error) {
        setStatus(describeError(error));
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
        } else if (!elements.repoBanner.hidden) {
            // The repository came back unchanged, as after renaming its folder back.
            setRepoProblem(null);
            setStatus(`Updated ${new Date().toLocaleTimeString()}`);
        }
    } catch (error) {
        setStatus(describeError(error));
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
    // Click a file to see its diff.
    const files = createElement('ul', 'files');
    details.files.forEach((file, index) => {
        const item = createElement('li');
        const button = createElement('button', 'file-item');
        button.type = 'button';
        button.title = 'Show the diff';
        button.appendChild(createElement('span', `status status-${file.status}`, file.status));
        const pathText = file.oldPath ? `${file.oldPath} → ${file.path}` : file.path;
        button.appendChild(createElement('span', 'mono', pathText));
        button.addEventListener('click', () => openDiff({ kind: 'commit', hash: details.hash }, details.files, index));
        item.appendChild(button);
        files.appendChild(item);
    });
    container.appendChild(files);

    elements.details.replaceChildren(container);
}

const settingKeys = {
    scope: 'git-watcher.scope',
    limit: 'git-watcher.limit',
    autoRefresh: 'git-watcher.auto-refresh',
    commitFilter: 'git-watcher.commit-filter',
    branchFilter: 'git-watcher.branch-filter',
    selectedCommit: 'git-watcher.selected-commit',
    collapsedPrefix: 'git-watcher.collapsed.',
    tagGrouping: 'git-watcher.tag-grouping',
    theme: 'git-watcher.theme',
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
            if (key.startsWith('git-watcher.')) {
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
        storageKey: 'git-watcher.details-height',
        minimum: 120,
    },
    {
        element: elements.workspaceSplitter,
        container: elements.workspace,
        pane: elements.sidebar,
        paneIsBefore: true,
        horizontal: false,
        variable: '--sidebar-width',
        storageKey: 'git-watcher.sidebar-width',
        minimum: 180,
    },
    {
        element: elements.sidebarSplitter,
        container: elements.sidebarPanes,
        pane: elements.branchesPane,
        paneIsBefore: true,
        horizontal: true,
        variable: '--branches-height',
        storageKey: 'git-watcher.branches-height',
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

function isPaneOpen(pane) {
    return !pane.classList.contains('collapsed');
}

// A stack drops its splitter and lets the open pane fill the space when either pane is collapsed. The Branches and
// Status panes open and close separately from the sidebar's rail; with both closed, only the rail is left.
function updateStacks() {
    const sidebarPanes = [elements.branchesPane, elements.workingTreePane];
    elements.sidebar.classList.toggle('collapsed', sidebarPanes.every((pane) => pane.classList.contains('collapsed')));
    for (const stack of [elements.sidebarPanes, elements.layout]) {
        const panes = [...stack.querySelectorAll(':scope > .pane')];
        stack.classList.toggle('has-closed-pane', panes.some((pane) => pane.classList.contains('collapsed')));
    }
    elements.workspace.classList.toggle('sidebar-collapsed', elements.sidebar.classList.contains('collapsed'));
}

const paneToggles = [...document.querySelectorAll('.pane-toggle')];

// Several toggles can control one pane: a pane's title and its button on the sidebar rail.
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
    // Earlier versions had a Remote checkbox; the Remote branches node replaced it.
    if (readSetting('git-watcher.show-remote-branches') !== null) {
        writeSetting('git-watcher.show-remote-branches', null);
    }

    // Earlier versions collapsed the Branches and Status panes together as the whole sidebar.
    const legacySidebarKey = `${settingKeys.collapsedPrefix}sidebar`;
    if (readSetting(legacySidebarKey) !== null) {
        const sidebarCollapsed = readSetting(legacySidebarKey);
        for (const paneId of ['branches-pane', 'working-tree-pane']) {
            if (readSetting(settingKeys.collapsedPrefix + paneId) === null) {
                writeSetting(settingKeys.collapsedPrefix + paneId, sidebarCollapsed);
            }
        }
        writeSetting(legacySidebarKey, null);
    }

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

// Opens or closes a pane for the user, from its toggles or its key, and remembers it.
function togglePane(paneId) {
    const collapsed = isPaneOpen(document.getElementById(paneId));
    setPaneCollapsed(paneId, collapsed);
    writeSetting(settingKeys.collapsedPrefix + paneId, String(collapsed));
    loadBranches();
    loadWorkingTree();
}

for (const toggle of paneToggles) {
    toggle.addEventListener('click', () => togglePane(toggle.getAttribute('aria-controls')));
}


elements.branchFilter.addEventListener('input', renderBranches);
elements.tagGrouping.addEventListener('change', renderBranches);

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

// Indents a branch tree row by its depth in the tree.
function indentBranchRow(row, depth) {
    row.style.paddingLeft = `${6 + depth * 14}px`;
}

function createBranchItem(branch, displayName = branch.name, depth = 0) {
    const item = createElement('button', 'branch-item');
    item.type = 'button';
    indentBranchRow(item, depth);
    item.dataset.hash = branch.hash;
    item.dataset.name = branch.name;
    item.dataset.refName = branch.name;
    // Only local branches have a current flag.
    item.dataset.kind = 'current' in branch ? 'local' : 'remote';
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
    line.appendChild(createElement('span', 'branch-name', displayName));
    for (const tag of formatSyncTags(branch)) {
        const tagElement = createElement('span', `branch-tag ${tag.className}`, tag.text);
        tagElement.title = tag.title;
        line.appendChild(tagElement);
    }
    item.appendChild(line);
    item.appendChild(createElement('span', 'branch-subject', `${formatDate(branch.date)} · ${branch.subject}`));
    return item;
}

// How tags are grouped into folders by their names: "MyApp-v2026.10.02" goes in a "MyApp" folder when grouping
// by hyphens. The choice is in the Options menu and the Tags node's right-click menu.
const tagSeparators = { slash: '/', hyphen: '-', none: null };
const tagGroupingLabels = { slash: 'Group by slash (/)', hyphen: 'Group by hyphen (-)', none: "Don't group" };

function setTagGrouping(grouping) {
    elements.tagGrouping.value = grouping;
    writeSetting(settingKeys.tagGrouping, grouping);
    renderBranches();
}

// The Remote branches and Tags nodes are closed by default, unlike the branch folders, so each has its own setting.
const closedByDefaultNodes = {
    remote: 'git-watcher.remote-branches-open',
    tags: 'git-watcher.tags-open',
};

// Branch folders collapsed by the user, by path ("local:claude", "remote:origin/claude"). Folders are open by default.
const branchFolderSettingKey = 'git-watcher.collapsed-branch-folders';
let collapsedBranchFolders = null;

function getCollapsedBranchFolders() {
    if (collapsedBranchFolders === null) {
        try {
            collapsedBranchFolders = new Set(JSON.parse(readSetting(branchFolderSettingKey) || '[]'));
        } catch {
            collapsedBranchFolders = new Set();
        }
    }
    return collapsedBranchFolders;
}

// Saved settings are limited to 1,000 characters each, so keep only as many folders as fit.
function saveCollapsedBranchFolders() {
    const paths = [];
    for (const path of getCollapsedBranchFolders()) {
        if (JSON.stringify([...paths, path]).length > 1000) {
            break;
        }
        paths.push(path);
    }
    writeSetting(branchFolderSettingKey, paths.length > 0 ? JSON.stringify(paths) : null);
}

// Groups branches into folders by the parts of their names: "claude/fix-x" goes in a "claude" folder. The separator
// can be changed (tags can be grouped by hyphens), and with no separator the list is flat.
function buildBranchTree(branches, separator = '/') {
    const root = { folders: new Map(), branches: [] };
    for (const branch of branches) {
        const parts = separator ? branch.name.split(separator).filter((part) => part !== '') : [branch.name];
        if (parts.length === 0) {
            parts.push(branch.name);
        }
        let node = root;
        for (const part of parts.slice(0, -1)) {
            if (!node.folders.has(part)) {
                node.folders.set(part, { folders: new Map(), branches: [] });
            }
            node = node.folders.get(part);
        }
        node.branches.push({ branch, leafName: parts[parts.length - 1] });
    }
    return root;
}

function countTreeBranches(node) {
    let count = node.branches.length;
    for (const folder of node.folders.values()) {
        count += countTreeBranches(folder);
    }
    return count;
}

function treeHasCurrentBranch(node) {
    return node.branches.some((entry) => entry.branch.current)
        || [...node.folders.values()].some(treeHasCurrentBranch);
}

// Folders come first, alphabetically, then the folder's branches in the order they were given. While filtering,
// every folder is open, so all matches show.
function appendBranchTree(fragment, node, depth, pathPrefix, filtering, createItem = createBranchItem) {
    const folderNames = [...node.folders.keys()].sort((a, b) => a.localeCompare(b));
    for (const name of folderNames) {
        const folder = node.folders.get(name);
        const path = `${pathPrefix}${name}`;
        const collapsed = !filtering && getCollapsedBranchFolders().has(path);

        const hasCurrent = collapsed && treeHasCurrentBranch(folder);
        fragment.appendChild(createFolderRow(name, path, depth, !collapsed, countTreeBranches(folder), hasCurrent));
        if (!collapsed) {
            appendBranchTree(fragment, folder, depth + 1, `${path}/`, filtering, createItem);
        }
    }

    for (const entry of node.branches) {
        fragment.appendChild(createItem(entry.branch, entry.leafName, depth));
    }
}

function createFolderRow(name, path, depth, expanded, count, hasCurrent) {
    const row = createElement('button', 'branch-folder');
    row.type = 'button';
    row.dataset.path = path;
    row.setAttribute('aria-expanded', String(expanded));
    indentBranchRow(row, depth);
    row.innerHTML = '<svg class="chevron" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>';
    row.appendChild(createElement('span', 'branch-folder-name', name));
    if (hasCurrent) {
        const marker = createElement('span', 'current-marker');
        marker.title = 'Contains the current branch (HEAD)';
        row.appendChild(marker);
    }
    row.appendChild(createElement('span', 'branch-folder-count', String(count)));
    return row;
}

function createTagItem(tag, displayName = tag.name, depth = 0) {
    const item = createElement('button', 'branch-item tag-item');
    item.type = 'button';
    indentBranchRow(item, depth);
    item.dataset.hash = tag.hash;
    item.dataset.name = `tag:${tag.name}`;
    item.dataset.refName = tag.name;
    item.dataset.kind = 'tag';
    item.classList.toggle('selected', item.dataset.name === state.selectedBranch);
    item.title = [
        tag.name,
        `${tag.hash.slice(0, 8)} ${tag.subject}`,
        `${tag.annotated ? 'Tagged by' : 'Committed by'} ${tag.author}, ${formatDate(tag.date)}`,
    ].join('\n');

    const line = createElement('span', 'branch-line');
    line.appendChild(createElement('span', 'branch-name', `🏷 ${displayName}`));
    item.appendChild(line);
    item.appendChild(createElement('span', 'branch-subject', `${formatDate(tag.date)} · ${tag.subject}`));
    return item;
}

function renderBranches() {
    const data = state.branches;
    if (!data) {
        return;
    }
    const query = elements.branchFilter.value.trim().toLowerCase();
    const matches = (branch) => query === '' || branch.name.toLowerCase().includes(query);

    // The current branch first, then the most recently updated.
    const local = data.local.filter(matches).sort((a, b) => Number(b.current) - Number(a.current) || b.date - a.date);
    const remote = data.remote.filter(matches);

    const filtering = query !== '';
    // Tags in name order, ignoring case and comparing numbers by value, so "v2026.9" comes before "v2026.10".
    const tags = (data.tags || []).filter(matches)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    const fragment = document.createDocumentFragment();

    // The tree has a top-level node each for the local branches, the remote branches, and the tags. Branches starts
    // open. Remote branches and Tags start closed, because a repository can have many of them. While filtering,
    // every node with a match is open.
    const appendRootNode = (name, path, items, open, pathPrefix, createItem, separator = '/') => {
        if (items.length === 0) {
            return;
        }
        const tree = buildBranchTree(items, separator);
        const isOpen = filtering || open;
        fragment.appendChild(createFolderRow(name, path, 0, isOpen, items.length, !isOpen && treeHasCurrentBranch(tree)));
        if (isOpen) {
            appendBranchTree(fragment, tree, 1, pathPrefix, filtering, createItem);
        }
    };
    const collapsedFolders = getCollapsedBranchFolders();
    const openByDefault = (path) => readSetting(closedByDefaultNodes[path]) === 'true';
    appendRootNode('Branches', 'branches', local, !collapsedFolders.has('branches'), 'local:', createBranchItem);
    appendRootNode('Remote branches', 'remote', remote, openByDefault('remote'), 'remote:', createBranchItem);
    appendRootNode('Tags', 'tags', tags, openByDefault('tags'), 'tags:', createTagItem, tagSeparators[elements.tagGrouping.value]);
    if (local.length === 0 && remote.length === 0 && tags.length === 0) {
        fragment.appendChild(createElement('p', 'status-summary', query ? 'No branches or tags match.' : 'No branches.'));
    }

    const scrollTop = elements.branches.scrollTop;
    elements.branches.replaceChildren(fragment);
    elements.branches.scrollTop = scrollTop;
    elements.branchesCount.textContent = `${data.local.length}`;
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

// Redrawing the tree replaces its rows, so the folder that was opened or closed gets the focus back.
function renderBranchesKeepingFolderFocus(folder) {
    const hadFocus = folder === document.activeElement;
    renderBranches();
    if (hadFocus) {
        elements.branches.querySelector(`.branch-folder[data-path="${CSS.escape(folder.dataset.path)}"]`)?.focus();
    }
}

elements.branches.addEventListener('click', (event) => {
    const folder = event.target.closest('.branch-folder');
    if (folder && Object.hasOwn(closedByDefaultNodes, folder.dataset.path)) {
        writeSetting(closedByDefaultNodes[folder.dataset.path], folder.getAttribute('aria-expanded') === 'true' ? null : 'true');
        renderBranchesKeepingFolderFocus(folder);
        return;
    }
    if (folder) {
        const folders = getCollapsedBranchFolders();
        if (folders.has(folder.dataset.path)) {
            folders.delete(folder.dataset.path);
        } else {
            folders.add(folder.dataset.path);
        }
        saveCollapsedBranchFolders();
        renderBranchesKeepingFolderFocus(folder);
        return;
    }

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

// With a branch or folder focused, Up and Down move between the rows and Left and Right close and open folders. Enter
// is a button's own key: it goes to a branch's commit or opens or closes a folder. The arrows stay in the pane, so
// they don't also move through the graph.
elements.branches.addEventListener('keydown', (event) => {
    const row = event.target.closest('.branch-item, .branch-folder');
    if (!row || event.ctrlKey || event.altKey || event.metaKey || !event.key.startsWith('Arrow')) {
        return;
    }
    event.preventDefault();
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        const rows = [...elements.branches.querySelectorAll('.branch-item, .branch-folder')];
        rows[rows.indexOf(row) + (event.key === 'ArrowDown' ? 1 : -1)]?.focus();
    } else if (row.classList.contains('branch-folder')) {
        const expanded = row.getAttribute('aria-expanded') === 'true';
        if (expanded === (event.key === 'ArrowLeft')) {
            row.click();
        }
    }
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
        { key: 'conflicted', title: 'Conflicts', files: data.conflicted, className: 'status-conflict' },
        { key: 'staged', title: 'Staged', files: data.staged },
        { key: 'unstaged', title: 'Changes', files: data.unstaged },
        { key: 'untracked', title: 'Untracked', files: data.untracked, className: 'status-untracked' },
    ];
    // Every file in the order shown, so the diff view's previous and next step through them.
    const diffFiles = [];
    let total = 0;
    for (const group of groups) {
        if (group.files.length === 0) {
            continue;
        }
        total += group.files.length;
        fragment.appendChild(createElement('div', 'pane-group', `${group.title} (${group.files.length})`));
        for (const file of group.files) {
            const index = diffFiles.length;
            diffFiles.push({ ...file, group: group.key });
            const item = createElement('button', 'status-item');
            item.type = 'button';
            item.title = 'Show the diff';
            item.appendChild(createElement('span', `status ${group.className || statusClass(file.status)}`, file.status));
            const pathText = file.oldPath ? `${file.oldPath} → ${file.path}` : file.path;
            item.appendChild(createElement('span', 'mono', pathText));
            item.addEventListener('click', () => openDiff({ kind: 'worktree' }, diffFiles, index));
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

// Selects a commit and opens the Commit details pane if it's collapsed.
function showCommitDetails(hash, scrollIntoView) {
    if (elements.detailsPane.classList.contains('collapsed')) {
        setPaneCollapsed('details-pane', false);
        writeSetting(`${settingKeys.collapsedPrefix}details-pane`, 'false');
    }
    selectCommit(hash, scrollIntoView);
}

// Selects the HEAD commit and scrolls the graph to it, from the HEAD label in the toolbar or the H key. Like clicking
// the commit, this leaves the Commit details pane open or closed as it was.
function goToHead() {
    const hash = state.data?.head.hash;
    if (!hash) {
        return;
    }
    if (!state.rowByHash.has(hash)) {
        setStatus('HEAD isn\'t in the shown commits.');
        return;
    }
    if (isDiffOpen()) {
        closeDiff();
    }
    selectCommit(hash, true);
}

elements.headLink.addEventListener('click', goToHead);

// Selects the commit above (-1) or below (1) the selected one, or the first commit when none is selected, and scrolls
// just enough to show it.
function selectAdjacentCommit(step) {
    const hashes = [...state.rowByHash.keys()];
    if (hashes.length === 0) {
        return;
    }
    const index = hashes.indexOf(state.selectedHash);
    const next = index === -1 ? 0 : Math.min(Math.max(index + step, 0), hashes.length - 1);
    if (next !== index) {
        revealCommit(hashes[next]);
    }
}

// Selects a commit from the keyboard, scrolling just enough to show it.
function revealCommit(hash) {
    selectCommit(hash, false);
    state.rowByHash.get(hash).scrollIntoView({ block: 'nearest' });
}

// Goes from the selected commit to its first parent, or to its child: the one that continues from it as a first
// parent if there is one, and the closest above it if there are several. Holding either key follows a branch's history.
function selectParentOrChild(toParent) {
    const hash = state.selectedHash;
    const commits = state.data?.commits;
    if (!commits || !state.rowByHash.has(hash)) {
        return;
    }
    let next;
    if (toParent) {
        next = commits.find((commit) => commit.hash === hash).parents[0];
        if (!next) {
            setStatus('This commit has no parent.');
            return;
        }
    } else {
        const children = commits.filter((commit) => commit.parents.includes(hash));
        const continuing = children.filter((commit) => commit.parents[0] === hash);
        next = (continuing.length > 0 ? continuing : children).at(-1)?.hash;
        if (!next) {
            setStatus('This commit has no child in the shown commits.');
            return;
        }
    }
    if (!state.rowByHash.has(next)) {
        setStatus('The parent isn\'t in the shown commits.');
        return;
    }
    revealCommit(next);
}

// Copies the selected commit's short hash, as the right-click menu's Copy short hash does.
function copySelectedHash() {
    const hash = state.selectedHash;
    if (hash && state.rowByHash.has(hash)) {
        copyWithStatus(() => hash.slice(0, 8), 'the short hash');
    }
}

// Opens the Options menu with the commit filter's text selected, ready to type over.
function focusCommitFilter() {
    setOptionsOpen(true);
    elements.filter.select();
}

function toggleShortcuts() {
    if (elements.shortcuts.open) {
        elements.shortcuts.close();
    } else {
        closeContextMenu();
        setOptionsOpen(false);
        elements.shortcuts.showModal();
    }
}

elements.shortcutsClose.addEventListener('click', () => elements.shortcuts.close());

// Clicking the backdrop, outside the dialog's box, closes it.
elements.shortcuts.addEventListener('click', (event) => {
    const box = elements.shortcuts.getBoundingClientRect();
    const inside = event.clientX >= box.left && event.clientX <= box.right
        && event.clientY >= box.top && event.clientY <= box.bottom;
    if (event.target === elements.shortcuts && !inside) {
        elements.shortcuts.close();
    }
});

// Opens the Commit details pane for the selected commit, or closes it.
function setDetailsOpen(open) {
    if (open) {
        if (state.selectedHash && state.rowByHash.has(state.selectedHash)) {
            showCommitDetails(state.selectedHash, false);
        }
    } else if (isPaneOpen(elements.detailsPane)) {
        togglePane('details-pane');
    }
}

// The page's keys, listed for the user in the shortcuts dialog (index.html), which ? opens. Keys typed into a text
// box, or with Alt or Win, are left alone, as are Enter on a button and the graph's keys while a diff or menu is open.
// Ctrl+C copies text instead while there's a text selection.
const pageKeys = {
    arrowup: () => selectAdjacentCommit(-1),
    arrowdown: () => selectAdjacentCommit(1),
    arrowleft: () => selectParentOrChild(false),
    arrowright: () => selectParentOrChild(true),
    enter: () => setDetailsOpen(true),
    escape: () => setDetailsOpen(false),
    h: goToHead,
    'ctrl+c': copySelectedHash,
    '/': focusCommitFilter,
    b: () => togglePane('branches-pane'),
    s: () => togglePane('working-tree-pane'),
    ',': () => setOptionsOpen(elements.options.hidden),
    '?': toggleShortcuts,
};
const graphKeys = new Set(['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'enter', 'escape', 'ctrl+c']);

document.addEventListener('keydown', (event) => {
    const key = (event.ctrlKey ? 'ctrl+' : '') + event.key.toLowerCase();
    if (event.defaultPrevented || event.altKey || event.metaKey || !Object.hasOwn(pageKeys, key)) {
        return;
    }
    if (event.target.isContentEditable || event.target.closest?.('input, select, textarea')) {
        return;
    }
    if (key === 'enter' && event.target.closest?.('button, a, [role="separator"]')) {
        return;
    }
    if (key === 'ctrl+c' && getSelection().toString() !== '') {
        return;
    }
    // The shortcuts dialog is modal: only ? works under it, and Escape closes it.
    if (elements.shortcuts.open && key !== '?') {
        return;
    }
    // An open diff or menu has these keys to itself, and closing one with Escape leaves the details open.
    if (graphKeys.has(key) && (isDiffOpen() || !elements.options.hidden || !contextMenu.element.hidden)) {
        return;
    }
    event.preventDefault();
    pageKeys[key]();
});

elements.graph.addEventListener('dblclick', (event) => {
    const row = event.target.closest('.row');
    if (row) {
        showCommitDetails(row.dataset.hash, false);
    }
});

// The right-click menu for commits, branches, and tags. Every action only reads: it copies text, selects a commit,
// or opens a web page. Nothing changes the repository; a checkout command is copied for the user to run.
const contextMenu = {
    element: document.getElementById('context-menu'),
    target: null,
};

function closeContextMenu() {
    if (contextMenu.element.hidden) {
        return;
    }
    contextMenu.element.hidden = true;
    contextMenu.element.replaceChildren();
    contextMenu.target?.classList.remove('context-target');
    contextMenu.target = null;
}

// Items are { label, action } objects, with `checked` for an item that can be on or off, or 'separator'.
function openContextMenu(event, target, items) {
    event.preventDefault();
    closeContextMenu();
    contextMenu.target = target;
    target.classList.add('context-target');

    for (const item of items) {
        if (item === 'separator') {
            const separator = createElement('div', 'context-menu-separator');
            separator.setAttribute('role', 'separator');
            contextMenu.element.appendChild(separator);
            continue;
        }
        const button = createElement('button', 'context-menu-item');
        button.type = 'button';
        if (item.checked === undefined) {
            button.setAttribute('role', 'menuitem');
        } else {
            // A checkable item shows a check mark when it's on.
            button.setAttribute('role', 'menuitemcheckbox');
            button.setAttribute('aria-checked', String(item.checked));
            button.appendChild(createElement('span', 'context-menu-check', item.checked ? '✓' : ''));
        }
        button.appendChild(document.createTextNode(item.label));
        button.addEventListener('click', () => {
            closeContextMenu();
            item.action();
        });
        contextMenu.element.appendChild(button);
    }

    // Open at the pointer, kept inside the window.
    contextMenu.element.hidden = false;
    const menuRect = contextMenu.element.getBoundingClientRect();
    const left = Math.max(4, Math.min(event.clientX, window.innerWidth - menuRect.width - 4));
    const top = Math.max(4, Math.min(event.clientY, window.innerHeight - menuRect.height - 4));
    contextMenu.element.style.left = `${left}px`;
    contextMenu.element.style.top = `${top}px`;
    contextMenu.element.querySelector('button')?.focus();
}

async function copyWithStatus(getText, description) {
    try {
        await copyText(await getText());
        setStatus(`Copied ${description}`);
    } catch (error) {
        setStatus(`Couldn't copy ${description}: ${error.message}`);
    }
}

async function getCommitDetails(hash) {
    let details = state.detailsCache.get(hash);
    if (!details) {
        details = await fetchJson(`/api/commit/${hash}`);
        state.detailsCache.set(hash, details);
    }
    return details;
}

// In a browser this opens a new tab. The Windows Terminal overlay opens it in the default browser.
function openWebPage(url) {
    window.open(url, '_blank', 'noopener');
}

elements.graph.addEventListener('contextmenu', (event) => {
    const row = event.target.closest('.row');
    if (!row) {
        return;
    }
    const hash = row.dataset.hash;
    const subject = row.querySelector('.subject').textContent;
    const items = [
        { label: 'Copy commit hash', action: () => copyWithStatus(() => hash, 'the commit hash') },
        { label: 'Copy short hash', action: () => copyWithStatus(() => hash.slice(0, 8), 'the short hash') },
        { label: 'Copy subject', action: () => copyWithStatus(() => subject, 'the subject') },
        { label: 'Copy message', action: () => copyWithStatus(async () => (await getCommitDetails(hash)).message, 'the message') },
        'separator',
        { label: 'Show details', action: () => showCommitDetails(hash, false) },
    ];
    const web = state.data?.web;
    if (web) {
        items.push({ label: `Open in ${web.provider}`, action: () => openWebPage(`${web.commitUrl}${hash}`) });
    }
    openContextMenu(event, row, items);
});

elements.branches.addEventListener('contextmenu', (event) => {
    const tagsNode = event.target.closest('.branch-folder[data-path="tags"]');
    if (tagsNode) {
        openContextMenu(event, tagsNode, Object.entries(tagGroupingLabels).map(([grouping, label]) => ({
            label,
            checked: elements.tagGrouping.value === grouping,
            action: () => setTagGrouping(grouping),
        })));
        return;
    }

    const item = event.target.closest('.branch-item');
    if (!item) {
        return;
    }
    const name = item.dataset.refName;
    const kind = item.dataset.kind;
    const noun = kind === 'tag' ? 'tag' : 'branch';
    // A remote branch is checked out as a new local branch that tracks it. A tag is checked out as a detached HEAD.
    const checkout = kind === 'remote' ? `git checkout --track ${name}` : `git checkout ${name}`;
    openContextMenu(event, item, [
        { label: `Copy ${noun} name`, action: () => copyWithStatus(() => name, `the ${noun} name`) },
        { label: 'Go to commit', action: () => selectCommit(item.dataset.hash, true) },
        { label: 'Copy checkout command', action: () => copyWithStatus(() => checkout, `"${checkout}"`) },
    ]);
});

document.addEventListener('pointerdown', (event) => {
    if (!contextMenu.element.contains(event.target)) {
        closeContextMenu();
    }
});

contextMenu.element.addEventListener('keydown', (event) => {
    const buttons = [...contextMenu.element.querySelectorAll('button')];
    const index = buttons.indexOf(document.activeElement);
    if (event.key === 'Escape') {
        event.preventDefault();
        closeContextMenu();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        buttons[(index + step + buttons.length) % buttons.length].focus();
    }
});

for (const scroller of [elements.graphScroll, elements.branches]) {
    scroller.addEventListener('scroll', closeContextMenu);
}
window.addEventListener('blur', closeContextMenu);
window.addEventListener('resize', closeContextMenu);
elements.filter.addEventListener('input', applyFilter);
elements.scope.addEventListener('change', loadGraph);
elements.limit.addEventListener('change', loadGraph);
elements.refresh.addEventListener('click', () => {
    loadGraph();
    loadWorkingTree();
});
document.addEventListener('visibilitychange', poll);

// Theme: System follows the system's light or dark mode as it changes; Light and Dark override it. The page's colors
// switch on the root element's data-theme. The choice is also kept in local storage, which the page's head reads to
// set the theme before it first draws.
const themeButtons = [...document.querySelectorAll('.theme-button')];
const systemDarkQuery = matchMedia('(prefers-color-scheme: dark)');

function applyTheme() {
    const choice = readSetting(settingKeys.theme) || 'system';
    const dark = choice === 'dark' || (choice === 'system' && systemDarkQuery.matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    for (const button of themeButtons) {
        button.setAttribute('aria-pressed', String(button.dataset.themeChoice === choice));
    }
    try {
        localStorage.setItem('gitWatcherTheme', choice);
    } catch {
        // Without local storage, the page may draw in the system's theme for a moment before the settings load.
    }
}

for (const button of themeButtons) {
    button.addEventListener('click', () => {
        const choice = button.dataset.themeChoice;
        writeSetting(settingKeys.theme, choice === 'system' ? null : choice);
        applyTheme();
    });
}
systemDarkQuery.addEventListener('change', applyTheme);

// Toolbar and filter controls whose values are remembered.
const rememberedControls = [
    { element: elements.scope, key: settingKeys.scope, event: 'change' },
    { element: elements.limit, key: settingKeys.limit, event: 'change' },
    { element: elements.autoRefresh, key: settingKeys.autoRefresh, event: 'change', checkbox: true },
    { element: elements.filter, key: settingKeys.commitFilter, event: 'input' },
    { element: elements.branchFilter, key: settingKeys.branchFilter, event: 'input' },
    { element: elements.tagGrouping, key: settingKeys.tagGrouping, event: 'change' },
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

// Inside the Windows Terminal overlay, the page is hosted by WebView2, and the overlay's minimize and close buttons
// live in this toolbar to keep everything on one line. They ask the overlay to act through WebView2's messages.
const webViewHost = window.chrome?.webview;
if (webViewHost) {
    document.getElementById('host-controls').hidden = false;
    document.getElementById('host-minimize').addEventListener('click', () => webViewHost.postMessage('minimize'));
    document.getElementById('host-close').addEventListener('click', () => webViewHost.postMessage('close'));

    // F11 makes the overlay fill the screen, and again puts it back. It's Windows Terminal's full screen key too, so
    // taking it here keeps it from being forwarded below.
    const fullScreenShortcut = document.getElementById('shortcut-fullscreen');
    fullScreenShortcut.hidden = false;
    fullScreenShortcut.nextElementSibling.hidden = false;
    document.addEventListener('keydown', (event) => {
        const modified = event.ctrlKey || event.altKey || event.shiftKey || event.metaKey;
        if (event.key === 'F11' && !event.defaultPrevented && !modified) {
            event.preventDefault();
            webViewHost.postMessage('fullscreen');
        }
    });

    // Windows Terminal's layout keys, such as Alt+Shift+arrow keys to resize the pane, come to the page while it has
    // the keyboard. The overlay says which keys it forwards to the terminal, named by their modifiers and key code,
    // such as "alt+shift+72". The page sends those back, unless something on the page already used the key.
    let terminalKeys = new Set();
    webViewHost.addEventListener('message', (event) => {
        if (Array.isArray(event.data?.terminalKeys)) {
            terminalKeys = new Set(event.data.terminalKeys);
        }
    });
    window.addEventListener('keydown', (event) => {
        if (event.defaultPrevented) {
            return;
        }
        const modifiers = [
            event.ctrlKey && 'ctrl',
            event.altKey && 'alt',
            event.shiftKey && 'shift',
            event.metaKey && 'win',
        ];
        const name = [...modifiers.filter(Boolean), event.keyCode].join('+');
        if (terminalKeys.has(name)) {
            event.preventDefault();
            webViewHost.postMessage({ terminalKey: name });
        }
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

// The columns after the graph: the description (branch labels and subject), author, date, and commit. The author,
// date, and commit columns have widths and stay against the right edge, and the description takes the rest, so
// resizing the pane (for example, opening the sidebar) only changes the description. Widths are CSS variables on the
// graph pane. A column dragged narrower than the minimum is hidden.
const columnDefaults = { author: 110, date: 112, hash: 64 };
const columnMinimumWidth = 24;
const descriptionMinimumWidth = 60;
const columnMaximumWidth = 2000;
const columnWidths = {};

// The width each column had when it was last shown, so a hidden column comes back at that width.
const columnRestoreWidths = {};
const columnLabels = { author: 'Author', date: 'Date', hash: 'Commit' };

// Which column each label's edge resizes: the one to its left.
const resizedByEdgeOf = { author: 'description', date: 'author', hash: 'date' };

function setColumnWidth(column, width) {
    const clamped = Math.min(Math.max(Math.round(width), 0), columnMaximumWidth);
    const visibleWidth = clamped < columnMinimumWidth ? 0 : clamped;
    columnWidths[column] = visibleWidth;
    if (visibleWidth > 0) {
        columnRestoreWidths[column] = visibleWidth;
    }
    elements.graphPane.style.setProperty(`--col-${column}`, `${visibleWidth}px`);
    elements.graphPane.classList.toggle(`hide-${column}`, visibleWidth === 0);
    for (const checkbox of elements.columnToggles) {
        if (checkbox.dataset.column === column) {
            checkbox.checked = visibleWidth > 0;
        }
    }
    alignColumnHeaders();
}

function saveColumnWidth(column) {
    writeSetting(`git-watcher.column-${column}`, String(columnWidths[column]));
    writeSetting(`git-watcher.column-${column}-restore`, String(columnRestoreWidths[column] ?? columnDefaults[column]));
}

// Shows a hidden column at the width it had, or hides a column, giving its space to the subjects.
function setColumnVisible(column, visible) {
    setColumnWidth(column, visible ? (columnRestoreWidths[column] || columnDefaults[column]) : 0);
    saveColumnWidth(column);
}

// Without saved widths, a narrow window (such as the Windows Terminal overlay) starts without the author and date.
function loadColumnWidths() {
    // Earlier versions saved a width for the description; it now always takes the space that's left.
    if (readSetting('git-watcher.column-description') !== null) {
        writeSetting('git-watcher.column-description', null);
    }

    const narrow = window.innerWidth < 760;
    for (const column of Object.keys(columnDefaults)) {
        const restore = Number.parseInt(readSetting(`git-watcher.column-${column}-restore`) || '', 10);
        columnRestoreWidths[column] = Number.isFinite(restore) && restore >= columnMinimumWidth ? restore : columnDefaults[column];
        const saved = Number.parseInt(readSetting(`git-watcher.column-${column}`) || '', 10);
        const fallback = narrow && column !== 'hash' ? 0 : columnDefaults[column];
        setColumnWidth(column, Number.isFinite(saved) ? saved : fallback);
    }
}

// Places each label over its column, measured from the first row, so it follows the column widths, the graph's
// width, and the list's scroll bar. A hidden column's label shrinks to just its edge, where the column would be.
function alignColumnHeaders() {
    const row = elements.graph.querySelector('.row');
    elements.columnHeaders.hidden = !row;
    if (!row) {
        return;
    }

    const origin = elements.columnHeaders.getBoundingClientRect().left;
    const rowRect = row.getBoundingClientRect();
    const contentRight = rowRect.right - Number.parseFloat(getComputedStyle(row).paddingRight);
    let nextLeft = contentRight + 8;
    for (const header of [...elements.columnHeaders.querySelectorAll('.column-header')].reverse()) {
        const cell = row.querySelector(`.col-${header.dataset.column}`);
        const hidden = getComputedStyle(cell).display === 'none';
        const rect = cell.getBoundingClientRect();
        const left = hidden ? nextLeft : rect.left;
        header.style.left = `${left - origin}px`;
        header.style.width = `${hidden ? 0 : rect.width}px`;
        nextLeft = left - (hidden ? 0 : 8);
    }
}

new ResizeObserver(alignColumnHeaders).observe(elements.graphScroll);

for (const header of elements.columnHeaders.querySelectorAll('.column-header')) {
    const column = resizedByEdgeOf[header.dataset.column];
    const resizer = header.querySelector('.column-resizer');

    // Dragging an edge resizes the column to its left, and the columns after it move along, like a table. The right
    // edge stays put, so the commit column, the last one, gives or takes the difference. The description has no
    // width of its own: its edge only moves the columns after it, which changes how much space it gets.
    resizer.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) {
            return;
        }
        event.preventDefault();
        const startX = event.clientX;
        const startHash = columnWidths.hash;
        const startWidth = column === 'description'
            ? elements.graph.querySelector('.row .col-description').getBoundingClientRect().width
            : columnWidths[column];
        const minimumMove = column === 'description' ? descriptionMinimumWidth - startWidth : -startWidth;
        resizer.setPointerCapture(event.pointerId);
        resizer.classList.add('dragging');
        document.body.classList.add('resizing');

        const onMove = (moveEvent) => {
            const move = Math.min(Math.max(moveEvent.clientX - startX, minimumMove), startHash);
            if (column !== 'description') {
                setColumnWidth(column, startWidth + move);
            }
            setColumnWidth('hash', startHash - move);
        };
        const onEnd = () => {
            resizer.removeEventListener('pointermove', onMove);
            resizer.removeEventListener('pointerup', onEnd);
            resizer.removeEventListener('pointercancel', onEnd);
            resizer.classList.remove('dragging');
            document.body.classList.remove('resizing');
            saveColumnWidth('hash');
            if (column !== 'description') {
                saveColumnWidth(column);
            }
        };
        resizer.addEventListener('pointermove', onMove);
        resizer.addEventListener('pointerup', onEnd);
        resizer.addEventListener('pointercancel', onEnd);
    });

    // Double-clicking an edge resets the column to its left, or for the description's edge, the commit column.
    resizer.addEventListener('dblclick', () => {
        const reset = column === 'description' ? 'hash' : column;
        setColumnWidth(reset, columnDefaults[reset]);
        writeSetting(`git-watcher.column-${reset}`, null);
        writeSetting(`git-watcher.column-${reset}-restore`, null);
    });
}
for (const checkbox of elements.columnToggles) {
    checkbox.addEventListener('change', () => setColumnVisible(checkbox.dataset.column, checkbox.checked));
}

// Right-clicking the Commits title row, where the column labels are, shows or hides columns.
elements.graphPane.querySelector('.pane-header').addEventListener('contextmenu', (event) => {
    openContextMenu(event, event.currentTarget, Object.entries(columnLabels).map(([column, label]) => ({
        label,
        checked: columnWidths[column] > 0,
        action: () => setColumnVisible(column, columnWidths[column] === 0),
    })));
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
    applyTheme();
    loadLayoutSettings();
    restoreControls();
    loadColumnWidths();
    loadDiffSettings();
    await loadGraph();
    restoreSelection();
    loadWorkingTree();
    setInterval(poll, pollIntervalMs);
}

initialize();
