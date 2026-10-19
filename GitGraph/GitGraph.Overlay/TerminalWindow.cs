using System.Runtime.InteropServices;

namespace GitGraph.Overlay;

/// <summary>
/// The terminal window the overlay docks to, and how to find it.
/// </summary>
internal sealed class TerminalWindow
{
    private const string WindowsTerminalClassName = "CASCADIA_HOSTING_WINDOW_CLASS";

    // Windows Terminal draws its tab row inside the client area. The overlay starts below it, so the tabs and the
    // minimize, maximize, and close buttons stay usable.
    private const double WindowsTerminalTabRowHeight = 40;

    private TerminalWindow(nint handle)
    {
        Handle = handle;
        IsWindowsTerminal = GetClassName(handle) == WindowsTerminalClassName;
    }

    public nint Handle { get; }

    public bool IsWindowsTerminal { get; }

    /// <summary>The height, in device-independent pixels, to leave uncovered at the top of the window.</summary>
    public double TopInset => IsWindowsTerminal ? WindowsTerminalTabRowHeight : 0;

    public bool IsMinimized => NativeMethods.IsIconic(Handle);

    public double DpiScale => NativeMethods.GetDpiForWindow(Handle) / 96.0;

    /// <summary>
    /// Finds the window to dock to: the requested window if it's valid, otherwise the window that hosts the
    /// console of the shell that started this process, otherwise the foreground window.
    /// </summary>
    public static TerminalWindow? Find(nint requestedWindow)
    {
        if (requestedWindow != 0 && NativeMethods.IsWindow(requestedWindow))
        {
            return new TerminalWindow(requestedWindow);
        }

        nint consoleHost = FindParentConsoleHost();
        if (consoleHost != 0)
        {
            return new TerminalWindow(consoleHost);
        }

        nint foreground = NativeMethods.GetForegroundWindow();
        return foreground != 0 ? new TerminalWindow(foreground) : null;
    }

    /// <summary>
    /// Gets the window's visible client area in screen coordinates.
    /// </summary>
    public bool TryGetBounds(out PixelRect bounds)
    {
        bounds = default;
        if (!NativeMethods.GetClientRect(Handle, out NativeMethods.Rect client))
        {
            return false;
        }

        NativeMethods.Point origin = new() { X = client.Left, Y = client.Top };
        if (!NativeMethods.ClientToScreen(Handle, ref origin))
        {
            return false;
        }

        PixelRect clientBounds = new(origin.X, origin.Y, origin.X + client.Right, origin.Y + client.Bottom);

        // The client area can include invisible resize borders. The extended frame bounds are what's drawn.
        int size = Marshal.SizeOf<NativeMethods.Rect>();
        if (NativeMethods.DwmGetWindowAttribute(Handle, NativeMethods.DwmExtendedFrameBounds, out NativeMethods.Rect frame, size) == 0)
        {
            clientBounds = clientBounds.Intersect(new PixelRect(frame.Left, frame.Top, frame.Right, frame.Bottom));
        }

        bounds = clientBounds;
        return true;
    }

    // A GUI process has no console, but it can attach to its parent's. In Windows Terminal that console's window is
    // a hidden pseudo-window owned by the terminal window, so its root owner is the window to dock to. In a classic
    // console, the console window is the window itself.
    private static nint FindParentConsoleHost()
    {
        if (!NativeMethods.AttachConsole(NativeMethods.AttachParentProcess))
        {
            return 0;
        }

        try
        {
            nint console = NativeMethods.GetConsoleWindow();
            if (console == 0)
            {
                return 0;
            }

            nint root = NativeMethods.GetAncestor(console, NativeMethods.GetAncestorRootOwner);
            return root != 0 && NativeMethods.IsWindowVisible(root) ? root : 0;
        }
        finally
        {
            NativeMethods.FreeConsole();
        }
    }

    private static string GetClassName(nint window)
    {
        char[] buffer = new char[256];
        int length = NativeMethods.GetClassName(window, buffer, buffer.Length);
        return new string(buffer, 0, length);
    }
}
