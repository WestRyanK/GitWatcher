namespace GitWatcher.Overlay;

/// <summary>
/// What UI Automation reports about a terminal window's panes.
/// </summary>
/// <param name="TopInset">
/// How far below the top of the client area the panes start, in physical pixels, or null if it couldn't be measured.
/// </param>
/// <param name="Pane">The screen bounds of the pane that was looked for, or null if it isn't visible.</param>
internal readonly record struct TerminalLayout(int? TopInset, PixelRect? Pane);
