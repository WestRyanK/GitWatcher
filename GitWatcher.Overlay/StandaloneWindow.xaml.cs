using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;

namespace GitWatcher.Overlay;

/// <summary>
/// Git Watcher in an ordinary window of its own, with a title bar and a taskbar button, not tied to any terminal.
/// </summary>
public partial class StandaloneWindow : Window
{
    // The settings when the window opened. Changes are saved with WindowSettings.Update, so they don't overwrite other
    // windows' changes.
    private readonly WindowSettings _settings;
    private readonly WindowFolder _folder;
    private Uri? _viewerAddress;

    // Covering the whole monitor, after the page's F11. The window's state before it, to go back to.
    private bool _fullScreen;
    private WindowState _stateBeforeFullScreen;

    internal StandaloneWindow(WindowSettings settings, WindowFolder folder)
    {
        _settings = settings;
        _folder = folder;
        InitializeComponent();
        Icon = CreateIcon();
        ApplySavedBounds(settings);
        SourceInitialized += OnSourceInitialized;

        // Starting Git Watcher again for this window's repository, or switching another window to it, shows this
        // window instead.
        folder.Requested += (_, _) => Dispatcher.BeginInvoke(BringToFront);

        // The page is the window's only content, so it gets the keyboard whenever the window does.
        Activated += (_, _) => FocusViewer();
        Closing += (_, _) => SaveBounds();
        Closed += (_, _) => Viewer.Dispose();
    }

    internal void ShowViewer(Uri address)
    {
        // The page hides the docked overlay's minimize and close buttons in this window, which has its own.
        _viewerAddress = new Uri(address, "?host=window");
        MessageText.Visibility = Visibility.Collapsed;
        Viewer.Visibility = Visibility.Visible;
        Viewer.CoreWebView2InitializationCompleted += OnViewerInitializationCompleted;
        Viewer.WebMessageReceived += OnViewerWebMessageReceived;
        ViewerHost.Navigate(Viewer, _viewerAddress);
    }

    internal void ShowMessage(string message)
    {
        Viewer.Visibility = Visibility.Collapsed;
        MessageText.Text = message;
        MessageText.Visibility = Visibility.Visible;
    }

    private void BringToFront()
    {
        if (WindowState == WindowState.Minimized)
        {
            WindowState = _settings.Maximized ? WindowState.Maximized : WindowState.Normal;
        }

        Activate();
    }

    private void FocusViewer()
    {
        if (IsActive && Viewer.CoreWebView2 is not null)
        {
            Viewer.Focus();
        }
    }

    private void OnSourceInitialized(object? sender, EventArgs e)
    {
        // Windows draws the title bar, so tell it to match the page's colors, which follow the Windows app mode.
        int darkMode = App.UsesLightTheme ? 0 : 1;
        NativeMethods.DwmSetWindowAttribute(new WindowInteropHelper(this).Handle, NativeMethods.DwmUseImmersiveDarkMode, ref darkMode, sizeof(int));

        // Maximizing before the window exists would maximize it on the main monitor, not the one it was on.
        if (_settings.Maximized)
        {
            WindowState = WindowState.Maximized;
        }
    }

    private void OnViewerInitializationCompleted(object? sender, CoreWebView2InitializationCompletedEventArgs e)
    {
        if (!e.IsSuccess)
        {
            ShowMessage($"Couldn't start WebView2: {e.InitializationException.Message}");
            return;
        }

        Viewer.CoreWebView2.NewWindowRequested += ViewerHost.OpenInBrowser;
        FocusViewer();

        // The page's title names the repository, which changes when the window follows a shell or switches.
        Viewer.CoreWebView2.DocumentTitleChanged += (_, _) => Title = Viewer.CoreWebView2.DocumentTitle;

        // The page forgets the recent folders when it reloads, so send them with every load.
        Viewer.CoreWebView2.NavigationCompleted += (_, _) => SendFolders();
    }

    // The page sends "fullscreen" for F11, "chooseFolder" for its Open folder item and Ctrl+O, and { openFolder } for
    // a recent folder or a worktree. It has no minimize or close buttons here.
    private void OnViewerWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (!ViewerHost.IsFromViewer(e, _viewerAddress))
        {
            return;
        }

        using JsonDocument message = JsonDocument.Parse(e.WebMessageAsJson);
        JsonElement root = message.RootElement;
        if (root.ValueKind == JsonValueKind.String)
        {
            string? command = root.GetString();
            if (command == "fullscreen")
            {
                ToggleFullScreen();
            }
            else if (command == "chooseFolder")
            {
                ChooseFolder();
            }
        }
        else if (root.ValueKind == JsonValueKind.Object
            && root.TryGetProperty("openFolder", out JsonElement folder)
            && folder.ValueKind == JsonValueKind.String)
        {
            OpenFolder(folder.GetString()!, fromList: true);
        }
    }

    // Tells the page the recent folders for its folder menu, and whether the window follows its shell.
    private void SendFolders()
    {
        if (Viewer.CoreWebView2 is null)
        {
            return;
        }

        var folders = new { recent = WindowSettings.Load().RecentFolders, following = _folder.Following };
        Viewer.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { folders }));
    }

    private void ChooseFolder()
    {
        OpenFolderDialog dialog = new()
        {
            Title = "Open a repository in this window",
            InitialDirectory = _folder.Current is string current ? Path.GetDirectoryName(current) : null,
        };
        if (dialog.ShowDialog(this) == true)
        {
            OpenFolder(dialog.FolderName, fromList: false);
        }
    }

    // A folder from the menu's lists may have been moved or deleted since; it's taken off the recent folders then.
    private async void OpenFolder(string folder, bool fromList)
    {
        FolderSwitch result = await _folder.SwitchToAsync(folder);
        if (result == FolderSwitch.Switched)
        {
            // Have the page load the new repository now, instead of on its next refresh.
            Viewer.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(new { folderChanged = true }));
        }
        else if (result == FolderSwitch.NotRepository)
        {
            if (fromList)
            {
                WindowSettings.Update(settings => settings.RecentFolders.RemoveAll(recent => GitFolder.AreSame(recent, folder)));
            }

            string reason = Directory.Exists(folder) ? "isn't in a git repository" : "doesn't exist anymore";
            MessageBox.Show(this, $"{folder} {reason}.", "Git Watcher", MessageBoxButton.OK, MessageBoxImage.Information);
        }

        SendFolders();
    }

    // A maximized window without a frame covers the taskbar too. It has to be restored first, or Windows keeps the
    // maximized size it had with the frame.
    private void ToggleFullScreen()
    {
        _fullScreen = !_fullScreen;
        if (_fullScreen)
        {
            _stateBeforeFullScreen = WindowState;
            WindowState = WindowState.Normal;
            WindowStyle = WindowStyle.None;
            ResizeMode = ResizeMode.NoResize;
            WindowState = WindowState.Maximized;
        }
        else
        {
            WindowStyle = WindowStyle.SingleBorderWindow;
            ResizeMode = ResizeMode.CanResize;
            WindowState = _stateBeforeFullScreen;
        }
    }

    // Saved bounds that are no longer on any screen, for example after unplugging a monitor, are left out, so the
    // window starts centered instead.
    private void ApplySavedBounds(WindowSettings settings)
    {
        if (settings is { Left: double left, Top: double top, Width: double width, Height: double height }
            && width >= MinWidth
            && height >= MinHeight)
        {
            Rect bounds = new(left, top, width, height);
            Rect screen = new(
                SystemParameters.VirtualScreenLeft,
                SystemParameters.VirtualScreenTop,
                SystemParameters.VirtualScreenWidth,
                SystemParameters.VirtualScreenHeight);
            if (bounds.IntersectsWith(screen))
            {
                WindowStartupLocation = WindowStartupLocation.Manual;
                Left = left;
                Top = top;
                Width = width;
                Height = height;
            }
        }
    }

    private void SaveBounds()
    {
        Rect bounds = RestoreBounds;
        bool maximized = (_fullScreen ? _stateBeforeFullScreen : WindowState) == WindowState.Maximized;
        WindowSettings.Update(settings =>
        {
            if (!bounds.IsEmpty)
            {
                settings.Left = bounds.Left;
                settings.Top = bounds.Top;
                settings.Width = bounds.Width;
                settings.Height = bounds.Height;
            }

            settings.Maximized = maximized;
        });
    }

    // Draws the commit graph glyph for the title bar and the taskbar, in blue.
    private static BitmapSource CreateIcon()
    {
        const int size = 64;
        Geometry glyph = (Geometry)Application.Current.FindResource("CommitGraphGlyph");
        DrawingVisual visual = new();
        using (DrawingContext context = visual.RenderOpen())
        {
            context.PushTransform(new ScaleTransform(size / 16.0, size / 16.0));
            context.DrawGeometry(null, new Pen(new SolidColorBrush(Color.FromRgb(0x2F, 0x81, 0xF7)), 1.75), glyph);
        }

        RenderTargetBitmap bitmap = new(size, size, 96, 96, PixelFormats.Pbgra32);
        bitmap.Render(visual);
        bitmap.Freeze();
        return bitmap;
    }
}
