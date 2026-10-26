namespace GitWatcher.Overlay;

/// <summary>
/// The docked overlay's own settings, saved next to the viewer's settings in ~/.git-watcher.
/// </summary>
internal sealed class OverlaySettings
{
    public const double DefaultWidthFraction = 0.45;

    private static readonly string SettingsPath = SettingsFile.GetPath("overlay.json");

    /// <summary>The overlay's width as a fraction of the terminal's width.</summary>
    public double WidthFraction { get; set; } = DefaultWidthFraction;

    /// <summary>Whether the overlay is minimized to a small button.</summary>
    public bool Collapsed { get; set; }

    public static OverlaySettings Load()
    {
        OverlaySettings? settings = SettingsFile.Load<OverlaySettings>(SettingsPath);
        return settings is not null && settings.WidthFraction > 0 && settings.WidthFraction < 1
            ? settings
            : new OverlaySettings();
    }

    public void Save()
    {
        SettingsFile.Save(SettingsPath, this);
    }
}
