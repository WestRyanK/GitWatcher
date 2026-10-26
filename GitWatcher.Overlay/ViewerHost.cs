using System.Diagnostics;
using System.IO;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace GitWatcher.Overlay;

/// <summary>
/// What the docked overlay and the standalone window share in hosting the viewer page in WebView2.
/// </summary>
internal static class ViewerHost
{
    public static void Navigate(WebView2 viewer, Uri address)
    {
        viewer.CreationProperties = new CoreWebView2CreationProperties
        {
            UserDataFolder = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "GitWatcher.Overlay",
                "WebView2"),
        };
        viewer.Source = address;
    }

    // Messages from any page other than the viewer are ignored.
    public static bool IsFromViewer(CoreWebView2WebMessageReceivedEventArgs e, Uri? address)
    {
        return address is not null
            && Uri.TryCreate(e.Source, UriKind.Absolute, out Uri? source)
            && Uri.Compare(source, address, UriComponents.SchemeAndServer, UriFormat.Unescaped, StringComparison.OrdinalIgnoreCase) == 0;
    }

    // The page opens web pages, such as a commit in Azure DevOps, in a new window. Open them in the default browser
    // instead of a bare WebView2 window. Only web addresses are opened.
    public static void OpenInBrowser(object? sender, CoreWebView2NewWindowRequestedEventArgs e)
    {
        e.Handled = true;
        if (Uri.TryCreate(e.Uri, UriKind.Absolute, out Uri? uri) && (uri.Scheme == Uri.UriSchemeHttps || uri.Scheme == Uri.UriSchemeHttp))
        {
            Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
        }
    }
}
