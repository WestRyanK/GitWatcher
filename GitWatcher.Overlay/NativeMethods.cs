using System.Runtime.InteropServices;

namespace GitWatcher.Overlay;

/// <summary>
/// The Win32 functions the overlay uses to find, follow, and dock to the terminal window.
/// </summary>
internal static class NativeMethods
{
    public const uint AttachParentProcess = unchecked((uint)-1);
    public const uint GetAncestorRootOwner = 3;
    public const int DwmExtendedFrameBounds = 9;
    public const int DwmWindowCornerPreference = 33;
    public const int DwmCornerDoNotRound = 1;
    public const int DwmCornerRoundSmall = 3;

    public const uint EventSystemMinimizeEnd = 0x0017;
    public const uint EventObjectDestroy = 0x8001;
    public const uint EventObjectLocationChange = 0x800B;
    public const uint WinEventOutOfContext = 0;
    public const int ObjectIdWindow = 0;
    public const int ChildIdSelf = 0;

    public const uint MonitorDefaultToNearest = 2;

    public const uint SetWindowPosNoZOrder = 0x0004;
    public const uint SetWindowPosNoActivate = 0x0010;

    public const uint InputKeyboard = 1;
    public const uint KeyEventExtendedKey = 0x0001;
    public const uint KeyEventKeyUp = 0x0002;

    public delegate void WinEventProc(
        nint hook,
        uint eventType,
        nint window,
        int objectId,
        int childId,
        uint eventThread,
        uint eventTime);

    [StructLayout(LayoutKind.Sequential)]
    public struct Rect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MonitorInfo
    {
        public int Size;
        public Rect Monitor;
        public Rect WorkArea;
        public uint Flags;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct Point
    {
        public int X;
        public int Y;
    }

    // INPUT holds a union of mouse, keyboard, and hardware input. The mouse input is the largest, so it sets the
    // size, even though only keyboard input is sent.
    [StructLayout(LayoutKind.Sequential)]
    public struct Input
    {
        public uint Type;
        public InputUnion Union;
    }

    [StructLayout(LayoutKind.Explicit)]
    public struct InputUnion
    {
        [FieldOffset(0)]
        public MouseInput Mouse;

        [FieldOffset(0)]
        public KeyboardInput Keyboard;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MouseInput
    {
        public int X;
        public int Y;
        public uint MouseData;
        public uint Flags;
        public uint Time;
        public nint ExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct KeyboardInput
    {
        public ushort VirtualKey;
        public ushort ScanCode;
        public uint Flags;
        public uint Time;
        public nint ExtraInfo;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool AttachConsole(uint processId);

    [DllImport("kernel32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool FreeConsole();

    [DllImport("kernel32.dll")]
    public static extern nint GetConsoleWindow();

    [DllImport("user32.dll")]
    public static extern nint GetAncestor(nint window, uint flags);

    [DllImport("user32.dll")]
    public static extern nint GetForegroundWindow();

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool SetForegroundWindow(nint window);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsWindow(nint window);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsWindowVisible(nint window);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsIconic(nint window);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetClassName(nint window, char[] className, int maxCount);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(nint window, out uint processId);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool AttachThreadInput(uint attachThread, uint attachToThread, [MarshalAs(UnmanagedType.Bool)] bool attach);

    [DllImport("kernel32.dll")]
    public static extern uint GetCurrentThreadId();

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetClientRect(nint window, out Rect rect);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetWindowRect(nint window, out Rect rect);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool ClientToScreen(nint window, ref Point point);

    [DllImport("user32.dll")]
    public static extern uint GetDpiForWindow(nint window);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetCursorPos(out Point point);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint SendInput(uint count, Input[] inputs, int size);

    [DllImport("user32.dll")]
    public static extern short GetAsyncKeyState(int virtualKey);

    [DllImport("user32.dll")]
    public static extern nint MonitorFromWindow(nint window, uint flags);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetMonitorInfo(nint monitor, ref MonitorInfo info);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool SetWindowPos(nint window, nint insertAfter, int x, int y, int width, int height, uint flags);

    [DllImport("user32.dll")]
    public static extern nint SetWinEventHook(
        uint eventMin,
        uint eventMax,
        nint module,
        WinEventProc callback,
        uint processId,
        uint threadId,
        uint flags);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool UnhookWinEvent(nint hook);

    [DllImport("dwmapi.dll")]
    public static extern int DwmGetWindowAttribute(nint window, int attribute, out Rect value, int size);

    [DllImport("dwmapi.dll")]
    public static extern int DwmSetWindowAttribute(nint window, int attribute, ref int value, int size);
}
