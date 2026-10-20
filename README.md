# Git Watcher

Git Watcher shows a live, read-only view of a git repository while you work in the terminal: the commit graph with
branches, remote branches, tags, merges, and HEAD; the working tree status; and diffs of any commit's files or your
uncommitted changes. It updates on its own as the repository changes, so you don't have to keep running
`git log --graph` and `git status`.

It runs as a small local web server with a page you can open in any browser, or docked beside your shell in
Windows Terminal.

## Prerequisites

* **Git** and **Node.js** (any current version). The server uses only Node's built-in modules, so there's nothing
  to install with npm.
* For the Windows Terminal panel: **Windows Terminal**, the **.NET 10 SDK**, and the **WebView2 runtime**, which
  comes with Windows 11.

## Install

Clone the repository and run the installer:

```powershell
git clone https://github.com/WestRyanK/GitWatcher.git
cd GitWatcher
./Install.ps1
```

`Install.ps1` installs two things, both pointing back at your clone, so they run its current code:

* The `GitWatcher` PowerShell module, with the `Start-GitWatcher` command, in `Documents\PowerShell\Modules`.
* The `/git-watcher` Claude Code skill, in `~/.claude/skills` (or `CLAUDE_CONFIG_DIR\skills`), so you can open the
  viewer from Claude Code in any repository.

Run it again after you move the clone, or after an update changes the skill.

## Running it

### Docked in Windows Terminal

From PowerShell in Windows Terminal (or a classic console window), in any folder of a repository, run:

```powershell
Start-GitWatcher
```

Pass `-Path` to show a different repository. In Windows Terminal, this splits the current tab: a new pane on the
right reserves room for the viewer, and the panel sits exactly over that pane. Your shell's pane gets narrower, so its text wraps before the panel instead of
going under it. The panel follows the window when you move or resize it, hides when you minimize the window or
switch to another tab, and closes (with its pane) when you close the window or exit the shell. It works with the tab
row hidden too (quake mode, focus mode, or full screen).

* **Width:** resize the pane with Windows Terminal's pane resizing (Alt+Shift+arrow keys by default). The panel
  follows it, and the next pane opens at the same width.
* **Minimize:** the panel's minimize button closes the pane, so your shell gets its full width back, and leaves a
  small button in the terminal's top-right corner. Click it to split the pane again and reopen the panel. Closing the
  pane yourself does the same as minimizing. The viewer keeps running while it's minimized, so it reopens instantly.
* The width and the minimized state are saved in `~/.git-watcher/overlay.json`.

In a classic console window, which has no panes, the panel covers the right side of the window instead, below any
title bar. Drag its left edge to change the width (double-click the edge to reset it).

To open the panel by typing `gw`, add an alias to your PowerShell profile:

```powershell
Set-Alias gw Start-GitWatcher
```

### In a browser

```powershell
node GitWatcher.Server/server.js
```

Then open <http://localhost:4173>. Set `PORT` to use a different port. Pass a path as the first argument to view a
different repository.

### In Claude Code

After installing, type `/git-watcher` in any repository (or ask Claude to open Git Watcher or the git graph). It
reuses a viewer that's already running for that repository, or starts one on a free port from 4173 to 4182. In the
desktop app it opens the viewer in the Browser pane. In the terminal it gives you the URL. It never adds files to
the repository. The skill's template is [`GitWatcher.Skill/SKILL.md`](GitWatcher.Skill/SKILL.md).

In this repository, you can also start **git-watcher** from the desktop app's Browser pane **Dev servers** menu.
The entry is in [`.claude/launch.json`](.claude/launch.json).

## Using it

* **Commits:** the graph lays commits out in lanes, with badges for branches, tags, and HEAD. The commit filter,
  **Commits from** (`current`: HEAD only, `local`: local branches and HEAD, or `all`: also remote branches and tags),
  **Show** (how many commits), and **Live** are in the **Options** menu (the sliders icon at the top right).
* **Commit details** are below the graph: the full message, author, date, and changed files. Double-click a commit
  to open them if they're collapsed. Click a pane's title to collapse it to its title row or open it again.
* **Columns:** the **Author**, **Date**, and **Commit** labels in the Commits title row line up with those columns.
  They stay against the right edge, and the subjects take the rest of the width. Drag the edge before a label to
  resize the column to its left, like a table, and double-click an edge to reset it. Show or hide them with the
  **Columns** checkboxes in the **Options** menu, or by right-clicking the Commits title row. Narrow windows start
  without the author and date.
* **Sidebar:** **Branches** and **Status** open and close separately from the buttons on the sidebar's rail, which
  is always visible. With both open, they're stacked.
  - **Branches** shows a tree with **Branches**, **Remote branches**, and **Tags** nodes. Branches are in folders by
    name (`claude/...` under **claude**), with each local branch's upstream, ahead/behind counts, and the worktree
    it's checked out in. Tags are grouped by slashes, by hyphens (`MyApp-v2026.10.02` under **MyApp**), or not at
    all: choose with **Group tags by** in the **Options** menu or by right-clicking the **Tags** node. Click a branch
    or tag to jump to its commit.
  - **Status** lists conflicted, staged, unstaged, and untracked files for the folder the viewer runs in.
* **Diffs:** click a file in **Commit details** or in the **Status** pane to see its diff, in a view over the
  Commits pane.
  - A commit's file is compared with the commit's first parent. A Status file is compared by its group: staged
    changes with HEAD, unstaged changes with the index, a conflicted file with HEAD, and an untracked file is shown
    as entirely added.
  - The whole file is shown, scrolled to the first change, with the changed words highlighted. Choose **Unified**
    or **Side by side**, and **Ignore whitespace** to hide whitespace-only changes. Side by side scrolls the two
    panes together; drag the divider between them to resize them.
  - **Syntax colors** colors the code by its language, chosen from the file's extension. Each side of the file is
    colored as a whole, so comments and strings that span lines come out right, and the changed-word highlights
    sit on top. Files over 10,000 lines or 500 KB are shown without colors. The choice is remembered.
  - The arrows (or Alt+Up and Alt+Down) step through the other files in the same list, and Escape or ✕ closes the
    view. A binary file just says that it changed, and a diff over 20,000 lines asks before showing.
* **Right-click menus:** right-click a commit to copy its hash, short hash, subject, or full message, show its
  details, or open it in Azure DevOps or GitHub (the link comes from the `origin` remote). Right-click a branch or
  tag to copy its name, go to its commit, or copy a `git checkout` command to run yourself. In the Windows Terminal
  panel, web links open in your default browser.
* **Resizing:** drag any divider to resize the panes (arrow keys work too when a divider has focus, and
  double-click resets it).
* **Settings:** the page remembers its state (the options, filters, selected commit, open tree nodes, pane sizes,
  and columns) in a per-user file, `~/.git-watcher/settings.json` (set `GIT_WATCHER_SETTINGS` to use another path).
  They survive restarts, port changes, and cleared browser data, and every repository and worktree shares them.

## Read-only by design

Git Watcher never changes your repository. Its menus copy commands for you to run instead of running them.

* `server.js` listens only on `127.0.0.1` and runs only read-only git commands (`log`, `rev-list`, `for-each-ref`,
  `rev-parse`, `symbolic-ref`, `show`, `diff-tree`, `status`, `diff`, and `ls-remote --get-url`, which only reads
  the configured URL) with `GIT_OPTIONAL_LOCKS=0`, which also stops `git status` from writing its refreshed index.
  Diffs run with `--no-ext-diff --no-textconv`, so git doesn't run external diff or text conversion programs.
  Untracked files are read directly and must be inside the repository.
* The only request that writes anything is `PUT /api/settings`, which saves the settings file above. The server only
  accepts it from the viewer page itself: JSON from the same origin, holding `git-watcher.*` string values. It
  rejects every other request that isn't `GET`.

## How it works

* [`GitWatcher.Server`](GitWatcher.Server) holds the Node server (`server.js`) and the page it serves (`public/`).
* [`GitWatcher.Overlay`](GitWatcher.Overlay) is the WPF app for the Windows Terminal panel.
* [`GitWatcher.psm1`](GitWatcher.psm1) is the PowerShell module with `Start-GitWatcher`, which builds the panel when
  needed and starts it. [`Install.ps1`](Install.ps1) installs the module and the
  Claude Code skill.
* [`GitWatcher.Skill`](GitWatcher.Skill) holds the `/git-watcher` skill's template.

### The server and page

The page is plain HTML, JavaScript, and SVG in `GitWatcher.Server/public`. The diff view's syntax colors come from
[highlight.js](https://highlightjs.org/) 11.11.1 (BSD-3-Clause), whose prebuilt files from cdnjs are kept in
`public/vendor/highlight.js`: the core with its common languages, plus PowerShell and batch files. To add another
language, add its file from `https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/languages/` there, in
`index.html`, and in `server.js`'s list of static files.

* `GET /api/graph?scope=S&limit=N` returns commits from `git log --topo-order`, plus refs and HEAD.
  `public/app.js` lays the commits out in lanes and draws the graph as plain SVG.
* `GET /api/version` returns a fingerprint of the refs and HEAD. The page polls it every 3 seconds and reloads the
  graph when it changes. This covers new commits, branch moves, and checkouts.
* `GET /api/branches` returns local and remote branches from `git for-each-ref`, with upstreams, ahead/behind
  counts, and worktrees, plus every tag.
* `GET /api/status` returns `git status --porcelain=v2 --branch`. The **Status** pane polls it with the graph.
* `GET /api/commit/<hash>` returns the commit's message and its changed files. A merge's files are compared with
  its first parent.
* `GET /api/diff?commit=<hash>&path=<path>` or `GET /api/diff?worktree=<group>&path=<path>` (add `oldPath` for a
  rename and `ignoreWhitespace=1`) returns the patch from `git diff` or `git show` with full context.
* `GET /api/settings` and `PUT /api/settings` read and save the page's settings.

### The Windows Terminal panel

The panel is `GitWatcher.Overlay`, a small WPF app. `Start-GitWatcher` builds it on first use, and again
whenever its sources change. An open panel locks the program, so after an update the script starts the current
version and asks you to close every panel. The next run then rebuilds it.

* It finds the terminal window through the console of the shell that started it: Windows Terminal owns that
  console's hidden window. `--terminal-window <hwnd>` picks a window directly.
* It reserves room with `wt --window 0 split-pane --vertical`, which splits the active tab of the most recently used
  Windows Terminal window, the one you just typed in. Before splitting again on restore, it brings that window to the
  front. The new pane gets a unique title and runs a small Windows PowerShell loop that waits on a named event. The
  panel signals the event to close the pane, and the loop also ends if the panel's process is gone. If the pane
  doesn't appear in the terminal window within 10 seconds, the panel closes it and covers the window instead.
* The panel is an owned window of the terminal window, so it stays just above the terminal (not above every
  window) and hides with it. A `SetWinEventHook` location-change hook keeps it in place while the window moves.
  Nothing is injected into Windows Terminal.
* Every half second it asks UI Automation where Windows Terminal's panes (`TermControl` elements) are. That gives the
  placeholder pane's exact bounds (and its width for next time), shows whether its tab is active (only the active
  tab's panes are reported), and gives the top of the panes for the minimized button and the classic overlay.
* It starts its own `server.js` on a free port for the shell's current folder, shows it with WebView2, and stops the
  server when it closes. The server also exits on its own if the panel's process goes away. The page settings are
  shared with the browser view.
