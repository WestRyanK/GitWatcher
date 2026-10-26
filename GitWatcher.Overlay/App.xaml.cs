using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Windows;
using System.Windows.Media;
using Microsoft.Win32;

namespace GitWatcher.Overlay;

/// <summary>
/// Docks Git Watcher to the right side of the terminal window that started it, or with <c>--window</c>, opens it in a
/// window of its own.
/// </summary>
public partial class App : Application
{
    private GitWatcherServer? _server;
    private string? _followFile;
    private EventWaitHandle? _startedAgain;

    protected override async void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        ApplyTheme();

        OverlayOptions options;
        try
        {
            options = OverlayOptions.Parse(e.Args);
        }
        catch (Exception exception) when (exception is ArgumentException or FormatException or OverflowException)
        {
            ShowStartupError(exception.Message);
            return;
        }

        // The repository's path is resolved now, so leave it: Windows won't delete or rename a folder that a running
        // process has as its current directory.
        Environment.CurrentDirectory = AppContext.BaseDirectory;

        _followFile = options.FollowFile;

        if (options.Standalone)
        {
            if (ShowExistingWindow(options.RepositoryPath))
            {
                Shutdown();
                return;
            }

            StandaloneWindow standalone = new(WindowSettings.Load());
            MainWindow = standalone;
            standalone.Show();
            BringToFrontWhenStartedAgain(standalone);
            await StartServerAsync(options, standalone.ShowViewer, standalone.ShowMessage);
            return;
        }

        TerminalWindow? terminal = TerminalWindow.Find(options.TerminalWindow);
        if (terminal is null)
        {
            ShowStartupError("Couldn't find the terminal window to dock to.");
            return;
        }

        MainWindow window = new(terminal, OverlaySettings.Load());
        MainWindow = window;
        window.Show();
        CloseWhenShellExits(options.ShellProcessId, window);
        await StartServerAsync(options, window.ShowViewer, window.ShowMessage);
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _server?.Dispose();
        _startedAgain?.Dispose();
        DeleteFollowFile();
        base.OnExit(e);
    }

    /// <summary>Whether Windows uses the light app mode, which the app's colors follow.</summary>
    internal static bool UsesLightTheme { get; private set; }

    private async Task StartServerAsync(OverlayOptions options, Action<Uri> showViewer, Action<string> showMessage)
    {
        try
        {
            _server = await GitWatcherServer.StartAsync(options.ServerScript, options.RepositoryPath, options.FollowFile);
            showViewer(_server.Address);
        }
        catch (Exception exception)
        {
            // Startup failures (no Node.js, no WebView2 runtime, a server error) are shown in the window itself.
            showMessage(exception.Message);
        }
    }

    // A window for a folder that already has one shows that window instead of opening another. Each folder has a
    // named event, which this process creates, or signals if another process already did. Signaling also lets that
    // process take the foreground, which only the process the user just started may give it. A window that follows a
    // shell can move to another repository, so it neither reuses another window nor is reused.
    private bool ShowExistingWindow(string repositoryPath)
    {
        if (_followFile is not null)
        {
            return false;
        }

        string folder = Path.TrimEndingDirectorySeparator(repositoryPath).ToUpperInvariant();
        string key = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(folder)));
        _startedAgain = new EventWaitHandle(false, EventResetMode.AutoReset, $@"Local\GitWatcher.Window.{key}", out bool createdNew);
        if (createdNew)
        {
            return false;
        }

        NativeMethods.AllowSetForegroundWindow(NativeMethods.AllowSetForegroundAnyProcess);
        _startedAgain.Set();
        return true;
    }

    private void BringToFrontWhenStartedAgain(StandaloneWindow window)
    {
        if (_startedAgain is not null)
        {
            ThreadPool.RegisterWaitForSingleObject(
                _startedAgain,
                (_, _) => window.Dispatcher.BeginInvoke(window.BringToFront),
                null,
                Timeout.Infinite,
                executeOnlyOnce: false);
        }
    }

    // The shell only writes its folder while the file exists, so deleting it stops a closed overlay's shell from
    // writing it on every change of folder.
    private void DeleteFollowFile()
    {
        if (_followFile is null)
        {
            return;
        }

        try
        {
            File.Delete(_followFile);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            // The shell is writing it, or it's gone; it's only a temporary file.
        }
    }

    private static void CloseWhenShellExits(int? shellProcessId, Window window)
    {
        if (shellProcessId is null)
        {
            return;
        }

        try
        {
            Process shell = Process.GetProcessById(shellProcessId.Value);
            shell.EnableRaisingEvents = true;
            shell.Exited += (_, _) => window.Dispatcher.BeginInvoke(window.Close);
            if (shell.HasExited)
            {
                window.Close();
            }
        }
        catch (ArgumentException)
        {
            // The shell already exited.
            window.Close();
        }
    }

    // Matches the viewer page's colors, which follow the Windows light or dark app mode.
    private void ApplyTheme()
    {
        bool useLightTheme = UsesLightTheme = Registry.GetValue(
            @"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize",
            "AppsUseLightTheme",
            1) is not int value || value != 0;

        Dictionary<string, string> colors = useLightTheme
            ? new()
            {
                ["OverlayBackground"] = "#FFFFFF",
                ["OverlayHeaderBackground"] = "#F6F7F9",
                ["OverlayHoverBackground"] = "#EEF2F7",
                ["OverlayBorder"] = "#D8DEE4",
                ["OverlayForeground"] = "#1F2328",
                ["OverlayMutedForeground"] = "#656D76",
            }
            : new()
            {
                ["OverlayBackground"] = "#0D1117",
                ["OverlayHeaderBackground"] = "#161B22",
                ["OverlayHoverBackground"] = "#1C2330",
                ["OverlayBorder"] = "#30363D",
                ["OverlayForeground"] = "#E6EDF3",
                ["OverlayMutedForeground"] = "#8D96A0",
            };

        foreach (KeyValuePair<string, string> color in colors)
        {
            SolidColorBrush brush = new((Color)ColorConverter.ConvertFromString(color.Value));
            brush.Freeze();
            Resources[color.Key] = brush;
        }
    }

    private void ShowStartupError(string message)
    {
        MessageBox.Show(message, "Git Watcher", MessageBoxButton.OK, MessageBoxImage.Error);
        Shutdown(1);
    }
}
