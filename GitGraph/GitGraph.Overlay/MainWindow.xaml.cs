using System.IO;
using System.Windows;
using System.Windows.Input;
using System.Windows.Interop;
using Microsoft.Web.WebView2.Core;

namespace GitGraph.Overlay;

/// <summary>
/// A borderless window, owned by the terminal window, that stays docked to the terminal's right side.
/// </summary>
public partial class MainWindow : Window
{
    // Sizes in device-independent pixels; they're scaled by the terminal's DPI.
    private const double MinimumOverlayWidth = 280;
    private const double MinimumTerminalWidth = 160;

    private readonly TerminalWindow _terminal;
    private readonly OverlaySettings _settings;
    private TerminalWindowTracker? _tracker;
    private nint _handle;
    private NativeMethods.Point _dragStart;
    private int _dragStartWidth;

    internal MainWindow(TerminalWindow terminal, OverlaySettings settings)
    {
        _terminal = terminal;
        _settings = settings;
        InitializeComponent();
        SourceInitialized += OnSourceInitialized;
        DpiChanged += OnDpiChanged;
        Closed += OnClosed;
    }

    internal async Task ShowViewerAsync(Uri address)
    {
        // WebView2 is a hosted native window, so it must be visible to initialize, and nothing can draw over it.
        MessageText.Visibility = Visibility.Collapsed;
        Viewer.Visibility = Visibility.Visible;

        string userDataFolder = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "GitGraph.Overlay",
            "WebView2");
        CoreWebView2Environment environment = await CoreWebView2Environment.CreateAsync(userDataFolder: userDataFolder);
        await Viewer.EnsureCoreWebView2Async(environment);
        Viewer.Source = address;
    }

    internal void ShowMessage(string message)
    {
        Viewer.Visibility = Visibility.Collapsed;
        MessageText.Text = message;
        MessageText.Visibility = Visibility.Visible;
    }

    private void OnSourceInitialized(object? sender, EventArgs e)
    {
        WindowInteropHelper helper = new(this);
        _handle = helper.Handle;

        // An owned window always stays just above its owner and is hidden while the owner is minimized, so the
        // overlay moves through the z-order with the terminal instead of floating over every window.
        helper.Owner = _terminal.Handle;

        _tracker = new TerminalWindowTracker(_terminal.Handle);
        _tracker.Moved += (_, _) => Reposition();
        _tracker.Closed += (_, _) => Close();
        Reposition();
    }

    private void OnDpiChanged(object? sender, DpiChangedEventArgs e)
    {
        // WPF resizes the window for the new DPI after this event. Dock it again once that's done.
        Dispatcher.BeginInvoke(Reposition);
    }

    private void OnClosed(object? sender, EventArgs e)
    {
        _tracker?.Dispose();
        Viewer.Dispose();
    }

    // Works in physical pixels with SetWindowPos, so the overlay lines up exactly with the terminal on any monitor.
    private void Reposition()
    {
        if (_handle == 0 || _terminal.IsMinimized || !_terminal.TryGetBounds(out PixelRect terminalBounds))
        {
            return;
        }

        double scale = _terminal.DpiScale;
        PixelRect dock = DockLayout.Calculate(
            terminalBounds,
            _settings.WidthFraction,
            (int)Math.Round(_terminal.TopInset * scale),
            (int)Math.Round(MinimumOverlayWidth * scale),
            (int)Math.Round(MinimumTerminalWidth * scale));

        NativeMethods.SetWindowPos(
            _handle,
            0,
            dock.Left,
            dock.Top,
            dock.Width,
            dock.Height,
            NativeMethods.SetWindowPosNoZOrder | NativeMethods.SetWindowPosNoActivate);
    }

    private void OnResizeGripMouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        e.Handled = true;
        if (e.ClickCount == 2)
        {
            _settings.WidthFraction = OverlaySettings.DefaultWidthFraction;
            _settings.Save();
            Reposition();
            return;
        }

        NativeMethods.GetCursorPos(out _dragStart);
        NativeMethods.GetWindowRect(_handle, out NativeMethods.Rect rect);
        _dragStartWidth = rect.Right - rect.Left;
        ResizeGrip.CaptureMouse();
    }

    private void OnResizeGripMouseMove(object sender, MouseEventArgs e)
    {
        if (!ResizeGrip.IsMouseCaptured || !_terminal.TryGetBounds(out PixelRect terminalBounds) || terminalBounds.Width <= 0)
        {
            return;
        }

        // The grip is on the left edge, so moving the mouse left makes the overlay wider.
        NativeMethods.GetCursorPos(out NativeMethods.Point cursor);
        int width = _dragStartWidth - (cursor.X - _dragStart.X);
        _settings.WidthFraction = Math.Clamp(width / (double)terminalBounds.Width, 0.05, 0.95);
        Reposition();
    }

    private void OnResizeGripMouseLeftButtonUp(object sender, MouseButtonEventArgs e)
    {
        if (ResizeGrip.IsMouseCaptured)
        {
            ResizeGrip.ReleaseMouseCapture();
            _settings.Save();
        }
    }

    private void OnCloseClick(object sender, RoutedEventArgs e)
    {
        Close();
    }
}
