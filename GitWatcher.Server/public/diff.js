'use strict';

// Diff view: shows one file's changes, from a commit or the working tree, over the Commits pane. The whole file is
// shown, in a unified or side-by-side layout, with the changed words highlighted. It only reads.

const diffLineLimit = 20000;
const wordDiffTokenLimit = 400;

// Parses one file's patch from git (`diff` or `show` with full context) into lines with their line numbers.
function parsePatch(patch) {
    const result = { binary: false, lines: [] };
    let oldNumber = 0;
    let newNumber = 0;
    let inHunk = false;

    for (const raw of patch.split('\n')) {
        const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
        if (hunk) {
            if (inHunk) {
                result.lines.push({ type: 'gap' });
            }
            inHunk = true;
            oldNumber = Number(hunk[1]);
            newNumber = Number(hunk[2]);
            continue;
        }
        if (!inHunk) {
            if (raw.startsWith('Binary files ') || raw.startsWith('GIT binary patch')) {
                result.binary = true;
            }
            continue;
        }
        if (raw === '' || raw.startsWith('\\')) {
            // The end of the patch, or "\ No newline at end of file".
            continue;
        }

        // Files with Windows line endings keep a carriage return at the end of each line.
        const text = raw.slice(1).replace(/\r$/, '');
        if (raw[0] === ' ') {
            result.lines.push({ type: 'context', oldNumber: oldNumber++, newNumber: newNumber++, text });
        } else if (raw[0] === '-') {
            result.lines.push({ type: 'deleted', oldNumber: oldNumber++, text });
        } else if (raw[0] === '+') {
            result.lines.push({ type: 'added', newNumber: newNumber++, text });
        } else {
            // Another file's header, which a rename can produce; its lines follow their own hunk header.
            inHunk = false;
        }
    }

    addWordHighlights(result.lines);
    return result;
}

// Splits a line into words, runs of spaces, and single punctuation characters.
function tokenize(text) {
    return text.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) || [];
}

// Marks which tokens of two lines differ, using the longest common subsequence of their tokens.
function diffWords(oldText, newText) {
    const oldTokens = tokenize(oldText);
    const newTokens = tokenize(newText);
    if (oldTokens.length * newTokens.length > wordDiffTokenLimit * wordDiffTokenLimit) {
        return null;
    }

    const lengths = Array.from({ length: oldTokens.length + 1 }, () => new Uint16Array(newTokens.length + 1));
    for (let i = oldTokens.length - 1; i >= 0; i--) {
        for (let j = newTokens.length - 1; j >= 0; j--) {
            lengths[i][j] = oldTokens[i] === newTokens[j]
                ? lengths[i + 1][j + 1] + 1
                : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
        }
    }

    const oldSegments = [];
    const newSegments = [];
    const push = (segments, text, changed) => {
        const last = segments[segments.length - 1];
        if (last && last.changed === changed) {
            last.text += text;
        } else {
            segments.push({ text, changed });
        }
    };
    let i = 0;
    let j = 0;
    while (i < oldTokens.length || j < newTokens.length) {
        if (i < oldTokens.length && j < newTokens.length && oldTokens[i] === newTokens[j]) {
            push(oldSegments, oldTokens[i++], false);
            push(newSegments, newTokens[j++], false);
        } else if (j < newTokens.length && (i === oldTokens.length || lengths[i][j + 1] >= lengths[i + 1][j])) {
            push(newSegments, newTokens[j++], true);
        } else {
            push(oldSegments, oldTokens[i++], true);
        }
    }
    return { oldSegments, newSegments };
}

// How alike two lines are, from 0 to 1: the share of their words (ignoring spaces) that they have in common.
function lineSimilarity(oldText, newText) {
    const words = (text) => tokenize(text).filter((token) => token.trim() !== '');
    const oldWords = words(oldText);
    const newWords = words(newText);
    if (oldWords.length === 0 || newWords.length === 0) {
        return 0;
    }
    const remaining = new Map();
    for (const word of newWords) {
        remaining.set(word, (remaining.get(word) || 0) + 1);
    }
    let common = 0;
    for (const word of oldWords) {
        if (remaining.get(word) > 0) {
            common++;
            remaining.set(word, remaining.get(word) - 1);
        }
    }
    return (2 * common) / (oldWords.length + newWords.length);
}

const minimumPairSimilarity = 0.4;

// In each run of deleted lines followed by added lines, pairs every deleted line with the most similar added line
// after the previous pair, so the lines keep their order, and highlights the words that changed between them.
// Lines that aren't similar enough to any other aren't paired, since highlighting most of a line helps no one.
function addWordHighlights(lines) {
    let index = 0;
    while (index < lines.length) {
        if (lines[index].type !== 'deleted') {
            index++;
            continue;
        }
        const deletedStart = index;
        while (index < lines.length && lines[index].type === 'deleted') {
            index++;
        }
        const addedStart = index;
        while (index < lines.length && lines[index].type === 'added') {
            index++;
        }
        const addedEnd = index;
        let nextAdded = addedStart;
        for (let deletedIndex = deletedStart; deletedIndex < addedStart && nextAdded < addedEnd; deletedIndex++) {
            const deleted = lines[deletedIndex];
            let best = -1;
            let bestSimilarity = minimumPairSimilarity;
            for (let addedIndex = nextAdded; addedIndex < addedEnd; addedIndex++) {
                const similarity = lineSimilarity(deleted.text, lines[addedIndex].text);
                if (similarity > bestSimilarity) {
                    best = addedIndex;
                    bestSimilarity = similarity;
                }
            }
            if (best === -1) {
                continue;
            }
            const added = lines[best];
            const words = diffWords(deleted.text, added.text);
            if (words) {
                deleted.segments = words.oldSegments;
                added.segments = words.newSegments;
            }
            nextAdded = best + 1;
        }
    }
}

function createDiffCell(className, text) {
    const cell = document.createElement('span');
    cell.className = className;
    if (text !== undefined) {
        cell.textContent = text;
    }
    return cell;
}

function createCodeCell(line, sideClass) {
    const cell = createDiffCell(`diff-code ${sideClass}`);
    if (!line) {
        return cell;
    }
    if (line.segments) {
        for (const segment of line.segments) {
            const span = document.createElement('span');
            span.textContent = segment.text;
            if (segment.changed) {
                span.className = 'diff-word';
            }
            cell.appendChild(span);
        }
    } else {
        cell.textContent = line.text;
    }
    return cell;
}

const lineClasses = { context: 'diff-context', deleted: 'diff-deleted', added: 'diff-added' };

// Unified: one column of lines, each with its old and new line numbers in one gutter that stays put while the code
// scrolls sideways.
function renderUnified(lines) {
    const grid = createDiffCell('diff-grid diff-unified');
    for (const line of lines) {
        if (line.type === 'gap') {
            grid.appendChild(createDiffCell('diff-gap', '⋯'));
            continue;
        }
        const lineClass = lineClasses[line.type];
        const gutter = createDiffCell(`diff-number diff-gutter ${lineClass}`);
        gutter.appendChild(createDiffCell('diff-gutter-number', line.oldNumber ?? ''));
        gutter.appendChild(createDiffCell('diff-gutter-number', line.newNumber ?? ''));
        grid.appendChild(gutter);
        grid.appendChild(createDiffCell(`diff-marker ${lineClass}`, line.type === 'added' ? '+' : line.type === 'deleted' ? '-' : ''));
        grid.appendChild(createCodeCell(line, lineClass));
    }
    return grid;
}

// Side by side: the old file on the left and the new file on the right, each in its own pane that scrolls sideways
// on its own, with a divider between them that can be dragged. A run of changes lines up its deleted and added
// lines, leaving blanks where one side has more. Lines don't wrap, so the rows of the two panes always line up, and
// their vertical scrolling is kept in step. Returns the view and the pane that scrolls vertically.
function renderSideBySide(lines) {
    const leftGrid = createDiffCell('diff-grid diff-split-side');
    const rightGrid = createDiffCell('diff-grid diff-split-side');
    const appendRow = (left, right) => {
        const leftClass = left ? lineClasses[left.type] : 'diff-empty';
        const rightClass = right ? lineClasses[right.type] : 'diff-empty';
        leftGrid.appendChild(createDiffCell(`diff-number ${leftClass}`, left?.oldNumber ?? ''));
        leftGrid.appendChild(createCodeCell(left, leftClass));
        rightGrid.appendChild(createDiffCell(`diff-number ${rightClass}`, right?.newNumber ?? ''));
        rightGrid.appendChild(createCodeCell(right, rightClass));
    };

    let index = 0;
    while (index < lines.length) {
        const line = lines[index];
        if (line.type === 'gap') {
            leftGrid.appendChild(createDiffCell('diff-gap', '⋯'));
            rightGrid.appendChild(createDiffCell('diff-gap', '⋯'));
            index++;
        } else if (line.type === 'context') {
            appendRow(line, line);
            index++;
        } else {
            const deleted = [];
            const added = [];
            while (index < lines.length && lines[index].type === 'deleted') {
                deleted.push(lines[index++]);
            }
            while (index < lines.length && lines[index].type === 'added') {
                added.push(lines[index++]);
            }
            for (let row = 0; row < Math.max(deleted.length, added.length); row++) {
                appendRow(deleted[row], added[row]);
            }
        }
    }

    const view = createDiffCell('diff-split-view');
    const leftPane = createDiffCell('diff-split-pane diff-split-left');
    const rightPane = createDiffCell('diff-split-pane diff-split-right');
    const divider = createDiffCell('diff-split-divider');
    divider.setAttribute('role', 'separator');
    divider.setAttribute('aria-orientation', 'vertical');
    divider.title = 'Drag to resize. Double-click to reset.';
    leftPane.appendChild(leftGrid);
    rightPane.appendChild(rightGrid);
    view.append(leftPane, divider, rightPane);

    // The right pane has the vertical scroll bar. The left pane follows it, and passes its own wheel scrolling on.
    rightPane.addEventListener('scroll', () => {
        leftPane.scrollTop = rightPane.scrollTop;
    });
    leftPane.addEventListener('wheel', (event) => {
        if (event.deltaY !== 0 && !event.shiftKey) {
            rightPane.scrollTop += event.deltaY;
        }
    }, { passive: true });
    attachSplitDivider(view, divider);

    return { element: view, scroller: rightPane };
}

const diffSplitSettingKey = 'git-watcher.diff-split';
const diffSplitDefault = 50;

function setDiffSplit(view, percent) {
    const clamped = Math.min(Math.max(percent, 15), 85);
    view.style.setProperty('--diff-split-left', `${clamped}%`);
    return clamped;
}

// Dragging the divider sets the left pane's share of the width, which is remembered. Double-clicking resets it.
function attachSplitDivider(view, divider) {
    const saved = Number.parseFloat(readSetting(diffSplitSettingKey) || '');
    setDiffSplit(view, Number.isFinite(saved) ? saved : diffSplitDefault);

    divider.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) {
            return;
        }
        event.preventDefault();
        divider.setPointerCapture(event.pointerId);
        divider.classList.add('dragging');
        document.body.classList.add('resizing');
        let percent = null;
        const onMove = (moveEvent) => {
            const rect = view.getBoundingClientRect();
            percent = setDiffSplit(view, ((moveEvent.clientX - rect.left) / rect.width) * 100);
        };
        const onEnd = () => {
            divider.removeEventListener('pointermove', onMove);
            divider.removeEventListener('pointerup', onEnd);
            divider.removeEventListener('pointercancel', onEnd);
            divider.classList.remove('dragging');
            document.body.classList.remove('resizing');
            if (percent !== null) {
                writeSetting(diffSplitSettingKey, percent.toFixed(1));
            }
        };
        divider.addEventListener('pointermove', onMove);
        divider.addEventListener('pointerup', onEnd);
        divider.addEventListener('pointercancel', onEnd);
    });

    divider.addEventListener('dblclick', () => {
        setDiffSplit(view, diffSplitDefault);
        writeSetting(diffSplitSettingKey, null);
    });
}
const diffState = {
    files: [],
    index: 0,
    source: null,
    request: 0,
    expandedGraphPane: false,
    showLargeDiff: false,
};

const diffElements = {
    view: document.getElementById('diff-view'),
    body: document.getElementById('diff-body'),
    title: document.getElementById('diff-title'),
    source: document.getElementById('diff-source'),
    position: document.getElementById('diff-position'),
    previous: document.getElementById('diff-previous'),
    next: document.getElementById('diff-next'),
    unified: document.getElementById('diff-unified'),
    sideBySide: document.getElementById('diff-side-by-side'),
    ignoreWhitespace: document.getElementById('diff-ignore-whitespace'),
    close: document.getElementById('diff-close'),
};

function isDiffOpen() {
    return !diffElements.view.hidden;
}

// Opens the diff view on one file of a list, which previous and next step through. The source is
// { kind: 'commit', hash } or { kind: 'worktree' }; each file is { path, oldPath, status, group }.
function openDiff(source, files, index) {
    diffState.source = source;
    diffState.files = files;
    diffState.index = index;

    // The view covers the Commits pane, so it needs the pane open.
    if (elements.graphPane.classList.contains('collapsed')) {
        setPaneCollapsed('graph-pane', false);
        diffState.expandedGraphPane = true;
    }
    diffElements.view.hidden = false;
    closeContextMenu();
    loadDiff();
}

function closeDiff() {
    diffElements.view.hidden = true;
    diffElements.body.replaceChildren();
    if (diffState.expandedGraphPane) {
        setPaneCollapsed('graph-pane', true);
        diffState.expandedGraphPane = false;
    }
}

function describeDiffSource(file) {
    if (diffState.source.kind === 'commit') {
        return `${diffState.source.hash.slice(0, 8)} compared with its first parent`;
    }
    const groups = { staged: 'Staged', unstaged: 'Not staged', untracked: 'Untracked', conflicted: 'Conflict, compared with HEAD' };
    return groups[file.group];
}

async function loadDiff() {
    const file = diffState.files[diffState.index];
    const request = ++diffState.request;
    diffState.showLargeDiff = false;

    diffElements.title.textContent = file.oldPath ? `${file.oldPath} → ${file.path}` : file.path;
    diffElements.title.title = diffElements.title.textContent;
    diffElements.source.textContent = describeDiffSource(file);
    diffElements.position.textContent = `${diffState.index + 1} of ${diffState.files.length}`;
    diffElements.previous.disabled = diffState.index === 0;
    diffElements.next.disabled = diffState.index === diffState.files.length - 1;
    diffElements.body.replaceChildren(createElement('p', 'diff-message', 'Loading…'));

    const query = new URLSearchParams({ path: file.path });
    if (file.oldPath) {
        query.set('oldPath', file.oldPath);
    }
    if (diffState.source.kind === 'commit') {
        query.set('commit', diffState.source.hash);
    } else {
        query.set('worktree', file.group);
    }
    if (diffElements.ignoreWhitespace.checked) {
        query.set('ignoreWhitespace', '1');
    }

    try {
        const result = await fetchJson(`/api/diff?${query}`);
        if (request === diffState.request) {
            diffState.result = result;
            renderDiff();
        }
    } catch (error) {
        if (request === diffState.request) {
            diffElements.body.replaceChildren(createElement('p', 'diff-message', `Couldn't load the diff: ${error.message}`));
        }
    }
}

function renderDiff() {
    const result = diffState.result;
    if (result.tooLarge) {
        diffElements.body.replaceChildren(createElement('p', 'diff-message',
            `This file is too large to show (${Math.round(result.size / 1024 / 1024)} MB).`));
        return;
    }

    const parsed = result.binary ? { binary: true, lines: [] } : parsePatch(result.patch || '');
    if (parsed.binary) {
        diffElements.body.replaceChildren(createElement('p', 'diff-message', 'Binary file changed.'));
        return;
    }
    if (parsed.lines.length === 0) {
        const message = diffElements.ignoreWhitespace.checked
            ? 'No changes, apart from whitespace.'
            : 'No changes to show. The file may only have been renamed or had its mode changed.';
        diffElements.body.replaceChildren(createElement('p', 'diff-message', message));
        return;
    }
    if (parsed.lines.length > diffLineLimit && !diffState.showLargeDiff) {
        const message = createElement('div', 'diff-message');
        message.appendChild(createElement('p', null, `This diff has ${parsed.lines.length.toLocaleString()} lines, which may be slow to show.`));
        const button = createElement('button', 'diff-show-anyway', 'Show anyway');
        button.type = 'button';
        button.addEventListener('click', () => {
            diffState.showLargeDiff = true;
            renderDiff();
        });
        message.appendChild(button);
        diffElements.body.replaceChildren(message);
        return;
    }

    const sideBySide = diffElements.sideBySide.getAttribute('aria-pressed') === 'true';
    const rendered = sideBySide
        ? renderSideBySide(parsed.lines)
        : { element: renderUnified(parsed.lines), scroller: diffElements.body };
    diffElements.body.classList.toggle('diff-body-split', sideBySide);
    diffElements.body.replaceChildren(rendered.element);
    diffElements.body.scrollTop = 0;

    // Start at the first change, since the whole file is shown.
    const firstChange = rendered.element.querySelector('.diff-added, .diff-deleted');
    if (firstChange) {
        rendered.scroller.scrollTop = Math.max(0, firstChange.offsetTop - rendered.scroller.clientHeight / 3);
    }
}

function setDiffLayout(sideBySide, save) {
    diffElements.unified.setAttribute('aria-pressed', String(!sideBySide));
    diffElements.sideBySide.setAttribute('aria-pressed', String(sideBySide));
    if (save) {
        writeSetting('git-watcher.diff-side-by-side', sideBySide ? 'true' : null);
    }
    if (isDiffOpen() && diffState.result) {
        renderDiff();
    }
}

function stepDiff(step) {
    const index = diffState.index + step;
    if (index >= 0 && index < diffState.files.length) {
        diffState.index = index;
        loadDiff();
    }
}

function loadDiffSettings() {
    setDiffLayout(readSetting('git-watcher.diff-side-by-side') === 'true', false);
    diffElements.ignoreWhitespace.checked = readSetting('git-watcher.diff-ignore-whitespace') === 'true';
}

diffElements.previous.addEventListener('click', () => stepDiff(-1));
diffElements.next.addEventListener('click', () => stepDiff(1));
diffElements.close.addEventListener('click', closeDiff);
diffElements.unified.addEventListener('click', () => setDiffLayout(false, true));
diffElements.sideBySide.addEventListener('click', () => setDiffLayout(true, true));
diffElements.ignoreWhitespace.addEventListener('change', () => {
    writeSetting('git-watcher.diff-ignore-whitespace', diffElements.ignoreWhitespace.checked ? 'true' : null);
    loadDiff();
});

// Escape closes the view; Alt+Up and Alt+Down step through the files. This listens before the page's other keys, so
// Escape closes an open menu first, not the view behind it.
window.addEventListener('keydown', (event) => {
    if (!isDiffOpen() || !elements.options.hidden || !contextMenu.element.hidden) {
        return;
    }
    if (event.key === 'Escape') {
        closeDiff();
    } else if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault();
        stepDiff(event.key === 'ArrowDown' ? 1 : -1);
    }
}, true);
