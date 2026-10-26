namespace GitWatcher.Overlay;

/// <summary>
/// The standalone window's own settings. They're in their own file, so a docked overlay that saves its settings
/// doesn't overwrite them with the ones it read when it started.
/// </summary>
/// <remarks>
/// Several windows can be open at once, so each change reads the file again and saves it right away, with
/// <see cref="Update"/>, instead of saving a copy read at startup.
/// </remarks>
internal sealed class WindowSettings
{
    public const int MaximumRecentFolders = 10;

    private static readonly string SettingsPath = SettingsFile.GetPath("window.json");

    /// <summary>The window's position and size when it isn't maximized, in device-independent pixels.</summary>
    public double? Left { get; set; }

    public double? Top { get; set; }

    public double? Width { get; set; }

    public double? Height { get; set; }

    public bool Maximized { get; set; }

    /// <summary>The repositories most recently shown in a window, newest first.</summary>
    public List<string> RecentFolders { get; set; } = [];

    public static WindowSettings Load()
    {
        return SettingsFile.Load<WindowSettings>(SettingsPath) ?? new WindowSettings();
    }

    public static void Update(Action<WindowSettings> change)
    {
        WindowSettings settings = Load();
        change(settings);
        SettingsFile.Save(SettingsPath, settings);
    }

    public void AddRecentFolder(string folder)
    {
        RecentFolders.RemoveAll(recent => GitFolder.AreSame(recent, folder));
        RecentFolders.Insert(0, folder);
        if (RecentFolders.Count > MaximumRecentFolders)
        {
            RecentFolders.RemoveRange(MaximumRecentFolders, RecentFolders.Count - MaximumRecentFolders);
        }
    }
}
