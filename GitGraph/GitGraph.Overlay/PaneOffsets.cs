namespace GitGraph.Overlay;

/// <summary>
/// Where a pane sits inside the terminal's client area, so the overlay can follow the pane while the window moves
/// or resizes, between UI Automation measurements.
/// </summary>
/// <remarks>
/// Windows Terminal keeps a split's proportions when the window resizes, so the pane's left edge is kept as a
/// fraction of the width. Its other edges keep their distance from the client area's edges.
/// </remarks>
internal readonly record struct PaneOffsets(double LeftFraction, int Top, int Right, int Bottom)
{
    public static PaneOffsets Measure(PixelRect client, PixelRect pane)
    {
        double leftFraction = client.Width > 0 ? (pane.Left - client.Left) / (double)client.Width : 0;
        return new PaneOffsets(leftFraction, pane.Top - client.Top, client.Right - pane.Right, client.Bottom - pane.Bottom);
    }

    public PixelRect Apply(PixelRect client)
    {
        int left = client.Left + (int)Math.Round(client.Width * LeftFraction);
        return new PixelRect(left, client.Top + Top, client.Right - Right, client.Bottom - Bottom);
    }
}
