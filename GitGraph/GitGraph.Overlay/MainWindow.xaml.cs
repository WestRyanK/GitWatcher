using System.IO;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace GitGraph.Overlay;

/// <summary>
/// A borderless window, owned by the terminal window, that stays docked to the terminal's right side.
/// </summary>
public partial class MainWindow : Window
{
    // Sizes in device-independent pixels; they're scaled by the terminal's DPI.
    private const double MinimumOverlayWidth = 280;
    private const double MinimumTerminalWidth = 160;
    private const double CollapsedButtonSize = 32;

    // Keeps the minimized button clear of Windows Terminal's scroll bar on the right edge.
    private const double CollapsedButtonRightMargin = 24;
    private const double CollapsedButtonTopMargin = 8;

    // How often to check whether the terminal's tab row appeared or disappeared, for example when focus mode is
    // turned on or off. Moving or resizing the window doesn't change it, so this doesn't need to be frequent.
    private static readonly TimeSpan TopInsetRefreshInterval = TimeSpan.FromSeconds(0.5);

    private readonly TerminalWindow _terminal;
    private readonly OverlaySettings _settings;
    private TerminalWindowTracker? _tracker;
    private readonly DispatcherTimer _topInsetTimer;
    private int? _measuredTopInset;
    private bool _measuringTopInset;
    private nint _handle;
    private NativeMethods.Point _dragStart;
    private int _dragStartWidth;

    internal MainWindow(TerminalWindow terminal, OverlaySettings settings)
    {
        _terminal = terminal;
        _settings = settings;
        InitializeComponent();
        _topInsetTimer = new DispatcherTimer { Interval = TopInsetRefreshInterval };
        _topInsetTimer.Tick += OnTopInsetTimerTick;
        SourceInitialized += OnSourceInitialized;
        DpiChanged += OnDpiChanged;
        Closed += OnClosed;
    }

    internal void ShowViewer(Uri address)
    {
        // WebView2 is a hosted native window, so nothing can draw over it. It initializes once it's on screen, which
        // is later if the overlay starts minimized.
        MessageText.Visibility = Visibility.Collapsed;
        Viewer.Visibility = Visibility.Visible;
        Viewer.CreationProperties = new CoreWebView2CreationProperties
        {
            UserDataFolder = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "GitGraph.Overlay",
                "WebView2"),
        };
        Viewer.CoreWebView2InitializationCompleted += OnViewerInitializationCompleted;
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

        // Measure once before the first layout, so the overlay doesn't start in the wrong place and jump.
        _measuredTopInset = _terminal.MeasureTopInset();
        _topInsetTimer.Start();
        SetCollapsed(_settings.Collapsed);
    }

    private async void OnTopInsetTimerTick(object? sender, EventArgs e)
    {
        if (_measuringTopInset || _terminal.IsMinimized)
        {
            return;
        }

        _measuringTopInset = true;
        try
        {
            int? topInset = await Task.Run(_terminal.MeasureTopInset);
            if (topInset is not null && topInset != _measuredTopInset)
            {
                _measuredTopInset = topInset;
                Reposition();
            }
        }
        finally
        {
            _measuringTopInset = false;
        }
    }

    private void OnViewerInitializationCompleted(object? sender, CoreWebView2InitializationCompletedEventArgs e)
    {
        if (!e.IsSuccess)
        {
            ShowMessage($"Couldn't start WebView2: {e.InitializationException.Message}");
        }
    }

    // Minimized, the overlay shrinks to a small button in the terminal's top-right corner. The server and page keep
    // running, so restoring is instant.
    private void SetCollapsed(bool collapsed)
    {
        ExpandedPanel.Visibility = collapsed ? Visibility.Collapsed : Visibility.Visible;
        CollapsedButton.Visibility = collapsed ? Visibility.Visible : Visibility.Collapsed;

        // Windows 11 rounds the button's corners. The docked panel stays square so it sits flush with the terminal.
        int corners = collapsed ? NativeMethods.DwmCornerRoundSmall : NativeMethods.DwmCornerDoNotRound;
        NativeMethods.DwmSetWindowAttribute(_handle, NativeMethods.DwmWindowCornerPreference, ref corners, sizeof(int));
        Reposition();
    }

    private void OnDpiChanged(object? sender, DpiChangedEventArgs e)
    {
        // WPF resizes the window for the new DPI after this event. Dock it again once that's done.
        Dispatcher.BeginInvoke(Reposition);
    }

    private void OnClosed(object? sender, EventArgs e)
    {
        _topInsetTimer.Stop();
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
        int topInset = _measuredTopInset ?? (int)Math.Round(_terminal.DefaultTopInset * scale);
        PixelRect dock = _settings.Collapsed
            ? DockLayout.CalculateButton(
                terminalBounds,
                (int)Math.Round(CollapsedButtonSize * scale),
                topInset,
                (int)Math.Round(CollapsedButtonRightMargin * scale),
                (int)Math.Round(CollapsedButtonTopMargin * scale))
            : DockLayout.Calculate(
                terminalBounds,
                _settings.WidthFraction,
                topInset,
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

    private void OnMinimizeClick(object sender, RoutedEventArgs e)
    {
        _settings.Collapsed = true;
        _settings.Save();
        SetCollapsed(true);
    }

    private void OnRestoreClick(object sender, RoutedEventArgs e)
    {
        _settings.Collapsed = false;
        _settings.Save();
        SetCollapsed(false);
    }

    private void OnCloseClick(object sender, RoutedEventArgs e)
    {
        Close();
    }
}
