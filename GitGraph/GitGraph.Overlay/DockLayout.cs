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

    /// <summary>
    /// Calculates where the minimized overlay's button goes: in the terminal's top-right corner, below its top inset.
    /// </summary>
    /// <param name="terminal">The terminal's visible client area, in physical pixels.</param>
    /// <param name="size">The button's width and height, in pixels.</param>
    /// <param name="topInset">Pixels to leave uncovered at the top of the terminal.</param>
    /// <param name="rightMargin">The gap between the button and the terminal's right edge, in pixels.</param>
    /// <param name="topMargin">The gap between the button and the top inset, in pixels.</param>
    public static PixelRect CalculateButton(PixelRect terminal, int size, int topInset, int rightMargin, int topMargin)
    {
        int right = Math.Max(terminal.Right - rightMargin, terminal.Left + size);
        int top = Math.Min(terminal.Top + topInset + topMargin, terminal.Bottom - size);
        return new PixelRect(right - size, top, right, top + size);
    }
}
