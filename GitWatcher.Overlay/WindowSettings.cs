namespace GitWatcher.Overlay;

/// <summary>
/// The standalone window's own settings. They're in their own file, so a docked overlay that saves its settings
/// doesn't overwrite them with the ones it read when it started.
/// </summary>
internal sealed class WindowSettings
{
    private static readonly string SettingsPath = SettingsFile.GetPath("window.json");

    /// <summary>The window's position and size when it isn't maximized, in device-independent pixels.</summary>
    public double? Left { get; set; }

    public double? Top { get; set; }

    public double? Width { get; set; }

    public double? Height { get; set; }

    public bool Maximized { get; set; }

    public static WindowSettings Load()
    {
        return SettingsFile.Load<WindowSettings>(SettingsPath) ?? new WindowSettings();
    }

    public void Save()
    {
        SettingsFile.Save(SettingsPath, this);
    }
}
