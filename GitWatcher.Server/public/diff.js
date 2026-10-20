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

// Syntax colors come from highlight.js (public/vendor/highlight.js), chosen by the file's extension. Each side of the
// file, old and new, is highlighted as a whole, so comments and strings that span lines are colored right, and then
// split back into lines. Larger files are shown without colors, since highlighting them would be slow.
const syntaxLineLimit = 10000;
const syntaxCharacterLimit = 500000;

// Extensions that highlight.js doesn't know by name.
const syntaxLanguageAliases = {
    config: 'xml',
    csproj: 'xml',
    manifest: 'xml',
    nuspec: 'xml',
    props: 'xml',
    resx: 'xml',
    svg: 'xml',
    targets: 'xml',
    vcxproj: 'xml',
    xaml: 'xml',
    psd1: 'powershell',
    psm1: 'powershell',
};

function syntaxLanguageFor(filePath) {
    if (typeof hljs === 'undefined') {
        return null;
    }
    const name = filePath.split('/').pop().toLowerCase();
    if (name === 'makefile') {
        return 'makefile';
    }
    const dot = name.lastIndexOf('.');
    if (dot <= 0) {
        return null;
    }
    const extension = name.slice(dot + 1);
    const language = syntaxLanguageAliases[extension] || extension;
    return hljs.getLanguage(language) ? language : null;
}

// Turns highlight.js's HTML into a list of pieces for each line. Each piece is { text, classes }, where classes are
// the token scopes it's inside, outermost first.
function splitHighlightedLines(html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    const lines = [[]];
    const walk = (node, classes) => {
        for (const child of node.childNodes) {
            if (child.nodeType === Node.TEXT_NODE) {
                child.data.split('\n').forEach((part, index) => {
                    if (index > 0) {
                        lines.push([]);
                    }
                    if (part) {
                        lines[lines.length - 1].push({ text: part, classes });
                    }
                });
            } else if (child.nodeType === Node.ELEMENT_NODE) {
                walk(child, child.className ? [...classes, child.className] : classes);
            }
        }
    };
    walk(template.content, []);
    return lines;
}

// Gives each line its syntax pieces for the old side, the new side, or both (context lines), as line.syntax.old and
// line.syntax.new.
function addSyntaxHighlights(lines, filePath) {
    const language = syntaxLanguageFor(filePath);
    if (!language || lines.length > syntaxLineLimit) {
        return;
    }
    const sides = {
        old: lines.filter((line) => line.type === 'context' || line.type === 'deleted'),
        new: lines.filter((line) => line.type === 'context' || line.type === 'added'),
    };
    const texts = {};
    for (const [side, sideLines] of Object.entries(sides)) {
        texts[side] = sideLines.map((line) => line.text).join('\n');
        if (texts[side].length > syntaxCharacterLimit) {
            return;
        }
    }

    for (const [side, sideLines] of Object.entries(sides)) {
        let highlighted;
        try {
            highlighted = splitHighlightedLines(hljs.highlight(texts[side], { language, ignoreIllegals: true }).value);
        } catch {
            // Shown without colors.
            return;
        }
        sideLines.forEach((line, index) => {
            const pieces = highlighted[index] || [];
            // Only pieces that spell out the line exactly can be laid over its words.
            if (pieces.map((piece) => piece.text).join('') === line.text) {
                line.syntax ??= {};
                line.syntax[side] = pieces;
            }
        });
    }
}

// Appends a run of text in its syntax colors: a span for each token scope it's inside, outermost first.
function appendSyntaxText(parent, text, classes) {
    let node = document.createTextNode(text);
    for (let index = classes.length - 1; index >= 0; index--) {
        const span = document.createElement('span');
        span.className = classes[index];
        span.appendChild(node);
        node = span;
    }
    parent.appendChild(node);
}

function createDiffCell(className, text) {
    const cell = document.createElement('span');
    cell.className = className;
    if (text !== undefined) {
        cell.textContent = text;
    }
    return cell;
}

// The code of one line, on the old or new side, with its changed words highlighted and its syntax colored. A changed
// word gets one highlight, with its syntax colors inside it.
function createCodeCell(line, sideClass, side) {
    const cell = createDiffCell(`diff-code ${sideClass}`);
    if (!line) {
        return cell;
    }
    const pieces = line.syntax?.[side];
    if (!line.segments && !pieces) {
        cell.textContent = line.text;
        return cell;
    }

    const segments = line.segments || [{ text: line.text, changed: false }];
    const syntax = pieces || [{ text: line.text, classes: [] }];
    let pieceIndex = 0;
    let pieceOffset = 0;
    for (const segment of segments) {
        let target = cell;
        if (segment.changed) {
            target = document.createElement('span');
            target.className = 'diff-word';
            cell.appendChild(target);
        }
        let remaining = segment.text.length;
        while (remaining > 0 && pieceIndex < syntax.length) {
            const piece = syntax[pieceIndex];
            const length = Math.min(remaining, piece.text.length - pieceOffset);
            appendSyntaxText(target, piece.text.slice(pieceOffset, pieceOffset + length), piece.classes);
            remaining -= length;
            pieceOffset += length;
            if (pieceOffset === piece.text.length) {
                pieceIndex++;
                pieceOffset = 0;
            }
        }
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
        grid.appendChild(createCodeCell(line, lineClass, line.type === 'deleted' ? 'old' : 'new'));
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
        leftGrid.appendChild(createCodeCell(left, leftClass, 'old'));
        rightGrid.appendChild(createDiffCell(`diff-number ${rightClass}`, right?.newNumber ?? ''));
        rightGrid.appendChild(createCodeCell(right, rightClass, 'new'));
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
// The rows of the shown layout, top to bottom, each with whether it shows a deleted line, an added line, or both
// (side by side, where a run of changes pairs its deleted and added lines in rows).
function overviewRows(lines, sideBySide) {
    if (!sideBySide) {
        return lines.map((line) => ({ deleted: line.type === 'deleted', added: line.type === 'added' }));
    }
    const rows = [];
    let index = 0;
    while (index < lines.length) {
        if (lines[index].type === 'gap' || lines[index].type === 'context') {
            rows.push({ deleted: false, added: false });
            index++;
            continue;
        }
        let deletedCount = 0;
        let addedCount = 0;
        while (index < lines.length && lines[index].type === 'deleted') {
            deletedCount++;
            index++;
        }
        while (index < lines.length && lines[index].type === 'added') {
            addedCount++;
            index++;
        }
        for (let row = 0; row < Math.max(deletedCount, addedCount); row++) {
            rows.push({ deleted: row < deletedCount, added: row < addedCount });
        }
    }
    return rows;
}

// Overview ruler: the diff's vertical scroll bar, as in Azure DevOps. It shows the whole file, marks each run of
// added (green) and deleted (red) rows where it is, and has a thumb over the part that's in view. Click it to center
// that spot, drag the thumb to scroll, or use the mouse wheel over it.
const rulerMinimumThumb = 16;

function showRuler(scroller, rows) {
    diffState.scroller = scroller;
    const marks = document.createDocumentFragment();
    let start = 0;
    for (let index = 1; index <= rows.length; index++) {
        const run = rows[start];
        if (index < rows.length && rows[index].deleted === run.deleted && rows[index].added === run.added) {
            continue;
        }
        if (run.deleted || run.added) {
            const mark = document.createElement('div');
            mark.className = `diff-ruler-mark ${run.deleted && run.added ? 'changed' : run.deleted ? 'deleted' : 'added'}`;
            mark.style.top = `${(start / rows.length) * 100}%`;
            mark.style.height = `${((index - start) / rows.length) * 100}%`;
            marks.appendChild(mark);
        }
        start = index;
    }
    const thumb = document.createElement('div');
    thumb.className = 'diff-ruler-thumb';
    diffElements.ruler.replaceChildren(marks, thumb);
    diffElements.ruler.hidden = false;
    diffElements.main.classList.add('has-ruler');
    updateRuler();
}

function hideRuler() {
    diffState.scroller = null;
    diffElements.ruler.hidden = true;
    diffElements.ruler.replaceChildren();
    diffElements.main.classList.remove('has-ruler');
}

// The thumb's top and height in the ruler, in pixels, for the scroller's position.
function rulerThumbBounds() {
    const { scrollTop, scrollHeight, clientHeight } = diffState.scroller;
    const rulerHeight = diffElements.ruler.clientHeight;
    const height = Math.min(rulerHeight, Math.max(rulerMinimumThumb, (clientHeight / scrollHeight) * rulerHeight));
    const top = Math.min(rulerHeight - height, (scrollTop / scrollHeight) * rulerHeight);
    return { top, height, rulerHeight };
}

function updateRuler() {
    const thumb = diffElements.ruler.querySelector('.diff-ruler-thumb');
    if (!diffState.scroller || !thumb) {
        return;
    }
    const { top, height } = rulerThumbBounds();
    thumb.hidden = diffState.scroller.scrollHeight <= diffState.scroller.clientHeight;
    thumb.style.top = `${top}px`;
    thumb.style.height = `${height}px`;
}

const diffState = {
    files: [],
    index: 0,
    source: null,
    request: 0,
    expandedGraphPane: false,
    showLargeDiff: false,
    // The element that scrolls the shown diff vertically, while the ruler is shown.
    scroller: null,
};

const diffElements = {
    view: document.getElementById('diff-view'),
    main: document.querySelector('.diff-main'),
    body: document.getElementById('diff-body'),
    ruler: document.getElementById('diff-ruler'),
    title: document.getElementById('diff-title'),
    source: document.getElementById('diff-source'),
    position: document.getElementById('diff-position'),
    previous: document.getElementById('diff-previous'),
    next: document.getElementById('diff-next'),
    unified: document.getElementById('diff-unified'),
    sideBySide: document.getElementById('diff-side-by-side'),
    ignoreWhitespace: document.getElementById('diff-ignore-whitespace'),
    syntax: document.getElementById('diff-syntax'),
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
    hideRuler();
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
    hideRuler();

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
    hideRuler();
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

    if (diffElements.syntax.checked) {
        addSyntaxHighlights(parsed.lines, diffState.files[diffState.index].path);
    }

    const sideBySide = diffElements.sideBySide.getAttribute('aria-pressed') === 'true';
    const rendered = sideBySide
        ? renderSideBySide(parsed.lines)
        : { element: renderUnified(parsed.lines), scroller: diffElements.body };
    diffElements.body.classList.toggle('diff-body-split', sideBySide);
    diffElements.body.replaceChildren(rendered.element);
    diffElements.body.scrollTop = 0;
    showRuler(rendered.scroller, overviewRows(parsed.lines, sideBySide));

    // Start at the first change, since the whole file is shown.
    const firstChange = rendered.element.querySelector('.diff-added, .diff-deleted');
    if (firstChange) {
        rendered.scroller.scrollTop = Math.max(0, firstChange.offsetTop - rendered.scroller.clientHeight / 3);
    }
    updateRuler();
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
    diffElements.syntax.checked = readSetting('git-watcher.diff-syntax') !== 'false';
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
// Scroll events don't bubble, but the capture phase sees the side-by-side pane's as well as the body's own.
diffElements.body.addEventListener('scroll', updateRuler, { capture: true, passive: true });
new ResizeObserver(updateRuler).observe(diffElements.body);

diffElements.ruler.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !diffState.scroller) {
        return;
    }
    event.preventDefault();
    const scroller = diffState.scroller;
    const ruler = diffElements.ruler;
    const rulerTop = () => ruler.getBoundingClientRect().top;
    const scrollToThumbTop = (thumbTop) => {
        scroller.scrollTop = (thumbTop / ruler.clientHeight) * scroller.scrollHeight;
    };

    // Grabbing the thumb keeps the spot under the pointer. Clicking elsewhere centers that spot, then drags from there.
    let { top, height } = rulerThumbBounds();
    let grabOffset = event.clientY - rulerTop() - top;
    if (!event.target.classList.contains('diff-ruler-thumb')) {
        grabOffset = height / 2;
        scrollToThumbTop(event.clientY - rulerTop() - grabOffset);
    }

    ruler.setPointerCapture(event.pointerId);
    ruler.classList.add('dragging');
    const onMove = (moveEvent) => {
        scrollToThumbTop(moveEvent.clientY - rulerTop() - grabOffset);
    };
    const onEnd = () => {
        ruler.removeEventListener('pointermove', onMove);
        ruler.removeEventListener('pointerup', onEnd);
        ruler.removeEventListener('pointercancel', onEnd);
        ruler.classList.remove('dragging');
    };
    ruler.addEventListener('pointermove', onMove);
    ruler.addEventListener('pointerup', onEnd);
    ruler.addEventListener('pointercancel', onEnd);
});

diffElements.ruler.addEventListener('wheel', (event) => {
    if (diffState.scroller && event.deltaY !== 0) {
        diffState.scroller.scrollTop += event.deltaY;
    }
}, { passive: true });

diffElements.syntax.addEventListener('change', () => {
    writeSetting('git-watcher.diff-syntax', diffElements.syntax.checked ? null : 'false');
    if (isDiffOpen() && diffState.result) {
        renderDiff();
    }
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
