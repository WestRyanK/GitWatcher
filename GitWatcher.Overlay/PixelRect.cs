namespace GitWatcher.Overlay;

/// <summary>
/// A screen rectangle in physical pixels.
/// </summary>
internal readonly record struct PixelRect(int Left, int Top, int Right, int Bottom)
{
    public int Width => Right - Left;

    public int Height => Bottom - Top;

    public PixelRect Intersect(PixelRect other)
    {
        return new PixelRect(
            Math.Max(Left, other.Left),
            Math.Max(Top, other.Top),
            Math.Min(Right, other.Right),
            Math.Min(Bottom, other.Bottom));
    }
}
