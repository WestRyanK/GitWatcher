using System.Globalization;
using System.IO;

namespace GitWatcher.Overlay;

/// <summary>
/// Command-line options:
/// <c>--repo &lt;path&gt;</c> (default: the current directory),
/// <c>--server &lt;path to server.js&gt;</c> (default: found above this program's folder),
/// <c>--terminal-window &lt;hwnd&gt;</c> (default: the window of the console that started this program), and
/// <c>--shell-process &lt;pid&gt;</c> (close the overlay when that process exits).
/// </summary>
internal sealed record OverlayOptions(string RepositoryPath, string ServerScript, nint TerminalWindow, int? ShellProcessId)
{
    public static OverlayOptions Parse(string[] args)
    {
        string repositoryPath = Environment.CurrentDirectory;
        string? serverScript = null;
        nint terminalWindow = 0;
        int? shellProcessId = null;

        for (int index = 0; index < args.Length; index++)
        {
            string name = args[index];
            if (index + 1 >= args.Length)
            {
                throw new ArgumentException($"Missing a value after {name}.");
            }

            string value = args[++index];
            switch (name)
            {
                case "--repo":
                    repositoryPath = Path.GetFullPath(value);
                    break;
                case "--server":
                    serverScript = Path.GetFullPath(value);
                    break;
                case "--terminal-window":
                    terminalWindow = ParseHandle(value);
                    break;
                case "--shell-process":
                    shellProcessId = int.Parse(value, CultureInfo.InvariantCulture);
                    break;
                default:
                    throw new ArgumentException($"Unknown option {name}.");
            }
        }

        serverScript ??= FindServerScript()
            ?? throw new ArgumentException("Couldn't find GitWatcher.Server/server.js. Pass its path with --server.");
        if (!File.Exists(serverScript))
        {
            throw new ArgumentException($"The server script {serverScript} doesn't exist.");
        }

        if (!Directory.Exists(repositoryPath))
        {
            throw new ArgumentException($"The folder {repositoryPath} doesn't exist.");
        }

        return new OverlayOptions(repositoryPath, serverScript, terminalWindow, shellProcessId);
    }

    private static nint ParseHandle(string value)
    {
        long handle = value.StartsWith("0x", StringComparison.OrdinalIgnoreCase)
            ? long.Parse(value[2..], NumberStyles.HexNumber, CultureInfo.InvariantCulture)
            : long.Parse(value, CultureInfo.InvariantCulture);
        return (nint)handle;
    }

    // The program is built under GitWatcher.Overlay/bin, so server.js is in the GitWatcher.Server folder next to a
    // parent folder.
    private static string? FindServerScript()
    {
        DirectoryInfo? directory = new(AppContext.BaseDirectory);
        while (directory is not null)
        {
            string serverDirectory = Path.Combine(directory.FullName, "GitWatcher.Server");
            string candidate = Path.Combine(serverDirectory, "server.js");
            if (File.Exists(candidate) && Directory.Exists(Path.Combine(serverDirectory, "public")))
            {
                return candidate;
            }

            directory = directory.Parent;
        }

        return null;
    }
}
