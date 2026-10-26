using System.ComponentModel;
using System.Diagnostics;
using System.IO;

namespace GitWatcher.Overlay;

/// <summary>
/// Finds the repository a folder is in, the way the viewer's server does.
/// </summary>
internal static class GitFolder
{
    /// <summary>
    /// Returns the top folder of the repository or worktree that <paramref name="folder"/> is in, or null when it
    /// isn't in one, doesn't exist, or git can't run.
    /// </summary>
    public static async Task<string?> GetTopLevelAsync(string folder)
    {
        if (!Directory.Exists(folder))
        {
            return null;
        }

        ProcessStartInfo startInfo = new("git")
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        startInfo.ArgumentList.Add("-C");
        startInfo.ArgumentList.Add(folder);
        startInfo.ArgumentList.Add("rev-parse");
        startInfo.ArgumentList.Add("--show-toplevel");

        try
        {
            using Process process = Process.Start(startInfo)!;
            Task<string> output = process.StandardOutput.ReadToEndAsync();
            Task<string> errors = process.StandardError.ReadToEndAsync();
            await process.WaitForExitAsync();
            await errors;
            string topLevel = (await output).Trim();

            // Git prints forward slashes, as in D:/source/repo.
            return process.ExitCode == 0 && topLevel.Length > 0 ? Path.GetFullPath(topLevel) : null;
        }
        catch (Win32Exception)
        {
            return null;
        }
    }

    /// <summary>Whether two folders are the same, ignoring case and a trailing separator, as Windows does.</summary>
    public static bool AreSame(string? first, string? second)
    {
        return first is not null
            && second is not null
            && string.Equals(
                Path.TrimEndingDirectorySeparator(first),
                Path.TrimEndingDirectorySeparator(second),
                StringComparison.OrdinalIgnoreCase);
    }
}
