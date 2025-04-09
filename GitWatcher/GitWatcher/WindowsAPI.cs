using System.Runtime.InteropServices;

namespace GitWatcher;
internal class WindowsAPI
{

    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr FindWindow(string? lpClassName, string? lpWindowName);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT
    {
        public int Left;    // x position of upper-left corner
        public int Top;     // y position of upper-left corner
        public int Right;   // x position of lower-right corner
        public int Bottom;  // y position of lower-right corner
    }

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);

    [DllImport("user32.dll")]
    public static extern bool GetWindowPlacement(IntPtr hWnd, ref WINDOWPLACEMENT lpwndpl);

    [StructLayout(LayoutKind.Sequential)]
    public struct WINDOWPLACEMENT
    {
        public int length;
        public int flags;
        public ShowWindowCommands showCmd;
        public System.Drawing.Point ptMinPosition;
        public System.Drawing.Point ptMaxPosition;
        public System.Drawing.Rectangle rcNormalPosition;
    }

    public enum ShowWindowCommands
    {
        Hide = 0,
        Normal = 1,
        Minimized = 2,
        Maximized = 3
    }
}
