namespace GitGraph.Overlay;

/// <summary>
/// Calculates where the overlay goes: along the right side of the terminal, below its top inset.
/// </summary>
internal static class DockLayout
{
    /// <param name="terminal">The terminal's visible client area, in physical pixels.</param>
    /// <param name="widthFraction">The overlay's width as a fraction of the terminal's width.</param>
    /// <param name="topInset">Pixels to leave uncovered at the top of the terminal.</param>
    /// <param name="minimumWidth">The narrowest the overlay can be, in pixels.</param>
    /// <param name="minimumTerminalWidth">How much of the terminal must stay uncovered, in pixels.</param>
    public static PixelRect Calculate(
        PixelRect terminal,
        double widthFraction,
        int topInset,
        int minimumWidth,
        int minimumTerminalWidth)
    {
        int maximumWidth = Math.Max(terminal.Width - minimumTerminalWidth, minimumWidth);
        int width = Math.Clamp((int)Math.Round(terminal.Width * widthFraction), minimumWidth, maximumWidth);
        width = Math.Min(width, terminal.Width);
        int top = Math.Min(terminal.Top + topInset, terminal.Bottom);
        return new PixelRect(terminal.Right - width, top, terminal.Right, terminal.Bottom);
    }
}
