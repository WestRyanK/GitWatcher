using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace GitWatcher.Overlay;

/// <summary>
/// A borderless window, owned by the terminal window, that stays docked to the terminal's right side.
/// </summary>
/// <remarks>
/// In Windows Terminal, the overlay splits off a <see cref="PlaceholderPane"/> and covers it exactly, so the shell's
/// pane gets narrower and no text goes under the overlay. A classic console window has no panes, and Windows Terminal
/// might not split, so in those cases the overlay covers the right side of the window instead.
/// </remarks>
public partial class MainWindow : Window
{
    // Sizes in device-independent pixels; they're scaled by the terminal's DPI.
    private const double MinimumOverlayWidth = 280;
    private const double MinimumTerminalWidth = 160;
    private const double CollapsedButtonSize = 32;

    // Keeps the minimized button clear of Windows Terminal's scroll bar on the right edge.
    private const double CollapsedButtonRightMargin = 24;
    private const double CollapsedButtonTopMargin = 8;

    // How often to measure the terminal's panes through UI Automation. That catches what moving the window doesn't
    // report: the tab row being shown or hidden, the placeholder pane being resized, and tab switches.
    private static readonly TimeSpan LayoutRefreshInterval = TimeSpan.FromSeconds(0.5);

    // How long to wait for a new placeholder pane to appear before covering the window instead.
    private static readonly TimeSpan PlaceholderTimeout = TimeSpan.FromSeconds(10);

    private readonly TerminalWindow _terminal;
    private readonly OverlaySettings _settings;
    private readonly DispatcherTimer _layoutTimer;
    private TerminalWindowTracker? _tracker;
    private int? _measuredTopInset;
    private bool _measuringLayout;
    private nint _handle;
    private PixelRect? _lastPosition;
    private NativeMethods.Point _dragStart;
    private int _dragStartWidth;

    private PlaceholderPane? _placeholder;
    private PaneOffsets? _placeholderOffsets;
    private bool _placeholderSeen;
    private bool _placeholderUnavailable;

    // Hidden while the placeholder pane's tab isn't the active tab.
    private bool _hiddenWithTab;

    private Uri? _viewerAddress;

    internal MainWindow(TerminalWindow terminal, OverlaySettings settings)
    {
        _terminal = terminal;
        _settings = settings;
        _placeholderUnavailable = !terminal.IsWindowsTerminal;
        InitializeComponent();
        _layoutTimer = new DispatcherTimer { Interval = LayoutRefreshInterval };
        _layoutTimer.Tick += OnLayoutTimerTick;
        SourceInitialized += OnSourceInitialized;
        DpiChanged += OnDpiChanged;
        Closed += OnClosed;
    }

    internal void ShowViewer(Uri address)
    {
        // WebView2 is a hosted native window, so nothing can draw over it. It initializes once it's on screen, which
        // is later if the overlay starts minimized.
        _viewerAddress = address;
        MessageText.Visibility = Visibility.Collapsed;
        Header.Visibility = Visibility.Collapsed;
        Viewer.Visibility = Visibility.Visible;
        Viewer.CreationProperties = new CoreWebView2CreationProperties
        {
            UserDataFolder = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "GitWatcher.Overlay",
                "WebView2"),
        };
        Viewer.CoreWebView2InitializationCompleted += OnViewerInitializationCompleted;
        Viewer.WebMessageReceived += OnViewerWebMessageReceived;
        Viewer.Source = address;
    }

    internal void ShowMessage(string message)
    {
        // Without the page, the overlay's own header provides the minimize and close buttons.
        Header.Visibility = Visibility.Visible;
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
        _measuredTopInset = _terminal.MeasureLayout(null).TopInset;
        _layoutTimer.Start();
        SetCollapsed(_settings.Collapsed);
    }

    private async void OnLayoutTimerTick(object? sender, EventArgs e)
    {
        if (_measuringLayout || _terminal.IsMinimized)
        {
            return;
        }

        _measuringLayout = true;
        try
        {
            string? placeholderTitle = _placeholder?.Title;
            TerminalLayout layout = await Task.Run(() => _terminal.MeasureLayout(placeholderTitle));
            ApplyLayout(layout);
        }
        finally
        {
            _measuringLayout = false;
        }
    }

    private void ApplyLayout(TerminalLayout layout)
    {
        if (layout.TopInset is not null)
        {
            _measuredTopInset = layout.TopInset;
        }

        if (_placeholder is not null && !_settings.Collapsed)
        {
            if (layout.Pane is PixelRect pane && _terminal.TryGetBounds(out PixelRect terminalBounds))
            {
                _placeholderSeen = true;
                _placeholderOffsets = PaneOffsets.Measure(terminalBounds, pane);
                RememberWidth(terminalBounds, pane);
                ShowOverlay();
            }
            else if (_placeholderSeen && !_placeholder.IsOpen)
            {
                // The user closed the placeholder pane. Treat it like minimizing, so the shell keeps its width.
                Collapse();
                return;
            }
            else if (!_placeholderSeen && DateTime.UtcNow - _placeholder.SplitAt > PlaceholderTimeout)
            {
                // The pane never showed up in this window, for example because the split went to another Windows
                // Terminal window. Close it and cover this window instead.
                ClosePlaceholder();
                _placeholderUnavailable = true;
                ResizeGrip.Visibility = Visibility.Visible;
                ShowOverlay();
            }
            else if (_placeholderSeen)
            {
                // The pane's tab isn't the active tab. Only the active tab's panes are reported.
                HideOverlay();
            }
        }

        Reposition();
    }

    // The page's toolbar has the overlay's minimize and close buttons, so the overlay needs no header row of its own.
    // It sends "minimize" or "close" with window.chrome.webview.postMessage. Messages from any other page are ignored.
    private void OnViewerWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (_viewerAddress is null
            || !Uri.TryCreate(e.Source, UriKind.Absolute, out Uri? source)
            || Uri.Compare(source, _viewerAddress, UriComponents.SchemeAndServer, UriFormat.Unescaped, StringComparison.OrdinalIgnoreCase) != 0)
        {
            return;
        }

        string? command = e.TryGetWebMessageAsString();
        if (command == "minimize")
        {
            Collapse();
        }
        else if (command == "close")
        {
            Close();
        }
    }

    private void OnViewerInitializationCompleted(object? sender, CoreWebView2InitializationCompletedEventArgs e)
    {
        if (!e.IsSuccess)
        {
            ShowMessage($"Couldn't start WebView2: {e.InitializationException.Message}");
            return;
        }

        Viewer.CoreWebView2.NewWindowRequested += OnViewerNewWindowRequested;
    }

    // The page opens web pages, such as a commit in Azure DevOps, in a new window. Open them in the default browser
    // instead of a bare WebView2 window. Only web addresses are opened.
    private void OnViewerNewWindowRequested(object? sender, CoreWebView2NewWindowRequestedEventArgs e)
    {
        e.Handled = true;
        if (Uri.TryCreate(e.Uri, UriKind.Absolute, out Uri? uri) && (uri.Scheme == Uri.UriSchemeHttps || uri.Scheme == Uri.UriSchemeHttp))
        {
            Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
        }
    }

    // Minimized, the overlay shrinks to a small button in the terminal's top-right corner, and the placeholder pane
    // closes so the shell gets its full width back. The server and page keep running, so restoring is instant.
    private void SetCollapsed(bool collapsed)
    {
        ExpandedPanel.Visibility = collapsed ? Visibility.Collapsed : Visibility.Visible;
        CollapsedButton.Visibility = collapsed ? Visibility.Visible : Visibility.Collapsed;

        // Windows 11 rounds the button's corners. The docked panel stays square so it sits flush with the terminal.
        int corners = collapsed ? NativeMethods.DwmCornerRoundSmall : NativeMethods.DwmCornerDoNotRound;
        NativeMethods.DwmSetWindowAttribute(_handle, NativeMethods.DwmWindowCornerPreference, ref corners, sizeof(int));

        if (collapsed)
        {
            ClosePlaceholder();
        }
        else
        {
            OpenPlaceholder();
        }

        ShowOverlay();
        Reposition();
    }

    private void Collapse()
    {
        _settings.Collapsed = true;
        _settings.Save();
        SetCollapsed(true);
    }

    private void OpenPlaceholder()
    {
        if (_placeholder is null && !_placeholderUnavailable)
        {
            // "wt --window 0" splits the most recently used Windows Terminal window, so make sure it's this one.
            NativeMethods.SetForegroundWindow(_terminal.Handle);
            _placeholder = PlaceholderPane.Split(_settings.WidthFraction);
            _placeholderSeen = false;
            _placeholderOffsets = null;
            _placeholderUnavailable = _placeholder is null;
        }

        // Windows Terminal resizes the pane; the grip is only for covering the window.
        ResizeGrip.Visibility = _placeholderUnavailable ? Visibility.Visible : Visibility.Collapsed;
    }

    private void ClosePlaceholder()
    {
        _placeholder?.Dispose();
        _placeholder = null;
        _placeholderOffsets = null;
        _placeholderSeen = false;
    }

    // Keeps the width the user gave the placeholder pane (with Windows Terminal's pane resizing) for next time.
    private void RememberWidth(PixelRect terminalBounds, PixelRect pane)
    {
        if (terminalBounds.Width <= 0)
        {
            return;
        }

        double widthFraction = pane.Width / (double)terminalBounds.Width;
        if (Math.Abs(widthFraction - _settings.WidthFraction) > 0.01)
        {
            _settings.WidthFraction = widthFraction;
            _settings.Save();
        }
    }

    private void ShowOverlay()
    {
        if (_hiddenWithTab)
        {
            _hiddenWithTab = false;
            _lastPosition = null;
            Show();
        }
    }

    private void HideOverlay()
    {
        if (!_hiddenWithTab)
        {
            _hiddenWithTab = true;
            Hide();
        }
    }

    private void OnDpiChanged(object? sender, DpiChangedEventArgs e)
    {
        // WPF resizes the window for the new DPI after this event. Dock it again once that's done.
        _lastPosition = null;
        Dispatcher.BeginInvoke(Reposition);
    }

    private void OnClosed(object? sender, EventArgs e)
    {
        _layoutTimer.Stop();
        _tracker?.Dispose();
        ClosePlaceholder();
        Viewer.Dispose();
    }

    // Works in physical pixels with SetWindowPos, so the overlay lines up exactly with the terminal on any monitor.
    private void Reposition()
    {
        if (_handle == 0 || _hiddenWithTab || _terminal.IsMinimized || !_terminal.TryGetBounds(out PixelRect terminalBounds))
        {
            return;
        }

        double scale = _terminal.DpiScale;
        int topInset = _measuredTopInset ?? (int)Math.Round(_terminal.DefaultTopInset * scale);
        PixelRect position;
        if (_settings.Collapsed)
        {
            position = DockLayout.CalculateButton(
                terminalBounds,
                (int)Math.Round(CollapsedButtonSize * scale),
                topInset,
                (int)Math.Round(CollapsedButtonRightMargin * scale),
                (int)Math.Round(CollapsedButtonTopMargin * scale));
        }
        else if (_placeholderOffsets is PaneOffsets offsets)
        {
            position = offsets.Apply(terminalBounds);
        }
        else
        {
            // Covering the window, or waiting for a new placeholder pane, which appears about here.
            position = DockLayout.Calculate(
                terminalBounds,
                _settings.WidthFraction,
                topInset,
                (int)Math.Round(MinimumOverlayWidth * scale),
                (int)Math.Round(MinimumTerminalWidth * scale));
        }

        if (position == _lastPosition)
        {
            return;
        }

        _lastPosition = position;
        NativeMethods.SetWindowPos(
            _handle,
            0,
            position.Left,
            position.Top,
            position.Width,
            position.Height,
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
        Collapse();
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
