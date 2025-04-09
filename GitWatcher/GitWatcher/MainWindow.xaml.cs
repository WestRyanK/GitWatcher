using System.Diagnostics;
using System.Reflection.Metadata.Ecma335;
using System.Text;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Documents;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Navigation;
using System.Windows.Shapes;

namespace GitWatcher
{
    /// <summary>
    /// Interaction logic for MainWindow.xaml
    /// </summary>
    public partial class MainWindow : Window
    {
        public MainWindow()
        {
            InitializeComponent();


            UpdateLoop();
        }

        private async Task UpdateLoop()
        {
            while (true)
            {
                WindowStatus status = GetWindowState("CASCADIA_HOSTING_WINDOW_CLASS", null);
                UpdateTerminalWindowState(status);
                UpdateGitWatcherWindowState(status);
                await Task.Delay(250);
            }
        }

        private void UpdateTerminalWindowState(WindowStatus status)
        {
            int height = (int)(status.WindowMax.Y - status.WindowMin.Y);
            WindowsAPI.MoveWindow(status.Handle, (int)status.WindowMin.X, (int)status.WindowMin.Y, 600, height, true);
        }

        private void UpdateGitWatcherWindowState(WindowStatus status)
        {
            this.Dispatcher.Invoke(() =>
            {
                if (status.IsMinimized)
                {
                    this.WindowState = WindowState.Minimized;
                    return;
                }
                else
                {



                    this.WindowState = WindowState.Normal;
                    this.Width = (status.WindowMax.X - status.WindowMin.X) * .5f;
                    this.Height = status.WindowMax.Y - status.WindowMin.Y;
                    this.Left = status.WindowMin.X + this.Width;
                    this.Top = status.WindowMin.Y;
                }
            });
        }

        private WindowStatus GetWindowState(string? windowClass, string? windowTitle)
        {
            nint windowHandle = WindowsAPI.FindWindow(windowClass, windowTitle);
            WindowsAPI.GetWindowRect(windowHandle, out WindowsAPI.RECT rect);
            WindowsAPI.WINDOWPLACEMENT placement = new();
            WindowsAPI.GetWindowPlacement(windowHandle, ref placement);

            Debug.WriteLine($"Window: ({rect.Left}, {rect.Top}) ({rect.Right}, {rect.Bottom})");
            Debug.WriteLine($"Placement: {placement.ptMinPosition} {placement.ptMaxPosition} {placement.rcNormalPosition} {placement.showCmd} {placement.flags} {placement.length}");

            return new WindowStatus(windowHandle, new Point(rect.Left, rect.Top), new Point(rect.Right, rect.Bottom), placement.showCmd == WindowsAPI.ShowWindowCommands.Minimized);
        }
    }

    struct WindowStatus
    {
        public WindowStatus(nint handle, Point windowMin, Point windowMax, bool isMinimized)
        {
            Handle = handle;
            WindowMin = windowMin;
            WindowMax = windowMax;
            IsMinimized = isMinimized;
        }

        public IntPtr Handle { get; }
        public Point WindowMin { get; }
        public Point WindowMax { get; }
        public bool IsMinimized { get; }
    }
}