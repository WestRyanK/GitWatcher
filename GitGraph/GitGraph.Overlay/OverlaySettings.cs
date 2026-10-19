using System.IO;
using System.Text.Json;

namespace GitGraph.Overlay;

/// <summary>
/// The overlay's own settings, saved next to the viewer's settings in ~/.git-graph.
/// </summary>
internal sealed class OverlaySettings
{
    public const double DefaultWidthFraction = 0.45;

    private static readonly string SettingsPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
        ".git-graph",
        "overlay.json");

    /// <summary>The overlay's width as a fraction of the terminal's width.</summary>
    public double WidthFraction { get; set; } = DefaultWidthFraction;

    public static OverlaySettings Load()
    {
        try
        {
            string json = File.ReadAllText(SettingsPath);
            OverlaySettings? settings = JsonSerializer.Deserialize<OverlaySettings>(json);
            if (settings is not null && settings.WidthFraction > 0 && settings.WidthFraction < 1)
            {
                return settings;
            }
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or JsonException)
        {
            // A missing or damaged file means the defaults.
        }

        return new OverlaySettings();
    }

    public void Save()
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(SettingsPath)!);
            string temporaryPath = $"{SettingsPath}.{Environment.ProcessId}.tmp";
            File.WriteAllText(temporaryPath, JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true }));
            File.Move(temporaryPath, SettingsPath, overwrite: true);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            // Losing the width isn't worth interrupting the user for.
        }
    }
}
