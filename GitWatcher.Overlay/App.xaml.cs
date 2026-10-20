using System.Diagnostics;
using System.Windows;
using System.Windows.Media;
using Microsoft.Win32;

namespace GitWatcher.Overlay;

/// <summary>
/// Docks Git Watcher to the right side of the terminal window that started it.
/// </summary>
public partial class App : Application
{
    private GitWatcherServer? _server;

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

        try
        {
            _server = await GitWatcherServer.StartAsync(options.ServerScript, options.RepositoryPath);
            window.ShowViewer(_server.Address);
        }
        catch (Exception exception)
        {
            // Startup failures (no Node.js, no WebView2 runtime, a server error) are shown in the overlay itself.
            window.ShowMessage(exception.Message);
        }
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _server?.Dispose();
        base.OnExit(e);
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
        bool useLightTheme = Registry.GetValue(
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
