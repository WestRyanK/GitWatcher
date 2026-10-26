using System.IO;
using System.Text.Json;

namespace GitWatcher.Overlay;

/// <summary>
/// Reads and writes the app's settings files, which are next to the viewer's settings in ~/.git-watcher.
/// </summary>
internal static class SettingsFile
{
    public static string GetPath(string fileName)
    {
        return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".git-watcher", fileName);
    }

    // A missing or damaged file gives null, which means the defaults.
    public static T? Load<T>(string path)
        where T : class
    {
        try
        {
            return JsonSerializer.Deserialize<T>(File.ReadAllText(path));
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or JsonException)
        {
            return null;
        }
    }

    public static void Save<T>(string path, T value)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            string temporaryPath = $"{path}.{Environment.ProcessId}.tmp";
            File.WriteAllText(temporaryPath, JsonSerializer.Serialize(value, new JsonSerializerOptions { WriteIndented = true }));
            File.Move(temporaryPath, path, overwrite: true);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            // Losing a setting isn't worth interrupting the user for.
        }
    }
}
