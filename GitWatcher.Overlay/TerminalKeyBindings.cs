using System.IO;
using System.Text.Json;

namespace GitWatcher.Overlay;

/// <summary>
/// The Windows Terminal key bindings that change the terminal's layout: its panes, tabs, and window. The overlay
/// forwards these to its placeholder pane, so they work while Git Watcher has the keyboard.
/// </summary>
/// <remarks>
/// Windows Terminal's built-in bindings are in defaults.json, next to WindowsTerminal.exe. The user's settings.json
/// adds to them and overrides them. Both formats are read: actions with their own "keys", and the newer format, where
/// "actions" gives each action an id and "keybindings" maps keys to ids. A null id or an "unbound" command removes a
/// binding.
/// </remarks>
internal static class TerminalKeyBindings
{
    // Actions that only make sense for the window as a whole, such as opening the settings or closing the window,
    // aren't forwarded. Neither is duplicateTab, which would duplicate the placeholder pane's tab.
    private static readonly HashSet<string> s_forwardedActions = new(StringComparer.OrdinalIgnoreCase)
    {
        "closeOtherPanes",
        "closePane",
        "focusPane",
        "moveFocus",
        "movePane",
        "resizePane",
        "splitPane",
        "swapPane",
        "togglePaneZoom",
        "toggleSplitOrientation",
        "closeOtherTabs",
        "closeTab",
        "closeTabsAfter",
        "moveTab",
        "newTab",
        "nextTab",
        "prevTab",
        "switchToTab",
        "toggleAlwaysOnTop",
        "toggleFocusMode",
        "toggleFullscreen",
    };

    private static readonly JsonDocumentOptions s_jsonOptions = new()
    {
        AllowTrailingCommas = true,
        CommentHandling = JsonCommentHandling.Skip,
    };

    /// <summary>
    /// Finds the settings.json of the Windows Terminal installed at the given path: in the package's local state
    /// folder when it's installed from the Store, next to it in portable mode, and otherwise in local app data.
    /// </summary>
    public static string GetSettingsPath(string executablePath)
    {
        string installDirectory = Path.GetDirectoryName(executablePath)!;
        if (File.Exists(Path.Combine(installDirectory, ".portable")))
        {
            return Path.Combine(installDirectory, "settings", "settings.json");
        }

        string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);

        // A package's folder is named "<name>_<version>_<architecture>_<resource id>_<publisher id>", and its
        // family name, which names its local state folder, is "<name>_<publisher id>".
        string[] packageParts = Path.GetFileName(installDirectory).Split('_');
        if (packageParts.Length == 5)
        {
            string familyName = $"{packageParts[0]}_{packageParts[4]}";
            return Path.Combine(localAppData, "Packages", familyName, "LocalState", "settings.json");
        }

        return Path.Combine(localAppData, "Microsoft", "Windows Terminal", "settings.json");
    }

    /// <summary>
    /// Reads the layout bindings of the Windows Terminal installed at the given path, or returns null if its
    /// settings couldn't be read, for example because Windows Terminal is in the middle of saving them.
    /// </summary>
    public static IReadOnlySet<KeyChord>? Load(string executablePath)
    {
        Dictionary<string, string?> actionsById = new(StringComparer.Ordinal);
        Dictionary<KeyChord, Binding> bindings = [];
        try
        {
            string defaultsPath = Path.Combine(Path.GetDirectoryName(executablePath)!, "defaults.json");
            if (File.Exists(defaultsPath))
            {
                Read(defaultsPath, actionsById, bindings);
            }

            string settingsPath = GetSettingsPath(executablePath);
            if (File.Exists(settingsPath))
            {
                Read(settingsPath, actionsById, bindings);
            }
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or JsonException)
        {
            return null;
        }

        HashSet<KeyChord> forwarded = [];
        foreach ((KeyChord chord, Binding binding) in bindings)
        {
            string? action = binding.Id is null ? binding.Action : actionsById.GetValueOrDefault(binding.Id);
            if (action is not null && s_forwardedActions.Contains(action))
            {
                forwarded.Add(chord);
            }
        }

        return forwarded;
    }

    private static void Read(string path, Dictionary<string, string?> actionsById, Dictionary<KeyChord, Binding> bindings)
    {
        using JsonDocument document = JsonDocument.Parse(File.ReadAllText(path), s_jsonOptions);
        JsonElement root = document.RootElement;
        if (root.ValueKind != JsonValueKind.Object)
        {
            return;
        }

        if (root.TryGetProperty("actions", out JsonElement actions) && actions.ValueKind == JsonValueKind.Array)
        {
            foreach (JsonElement entry in actions.EnumerateArray())
            {
                if (entry.ValueKind != JsonValueKind.Object)
                {
                    continue;
                }

                string? action = entry.TryGetProperty("command", out JsonElement command) ? GetActionName(command) : null;
                if (entry.TryGetProperty("id", out JsonElement id) && id.ValueKind == JsonValueKind.String)
                {
                    actionsById[id.GetString()!] = action;
                }

                foreach (KeyChord chord in GetChords(entry))
                {
                    bindings[chord] = new Binding(null, action);
                }
            }
        }

        if (root.TryGetProperty("keybindings", out JsonElement keybindings) && keybindings.ValueKind == JsonValueKind.Array)
        {
            foreach (JsonElement entry in keybindings.EnumerateArray())
            {
                if (entry.ValueKind != JsonValueKind.Object)
                {
                    continue;
                }

                string? id = entry.TryGetProperty("id", out JsonElement idElement) && idElement.ValueKind == JsonValueKind.String
                    ? idElement.GetString()
                    : null;
                foreach (KeyChord chord in GetChords(entry))
                {
                    bindings[chord] = new Binding(id, null);
                }
            }
        }
    }

    // A command is an action's name, or an object with the name in "action" and the action's arguments.
    private static string? GetActionName(JsonElement command)
    {
        string? name = command.ValueKind switch
        {
            JsonValueKind.String => command.GetString(),
            JsonValueKind.Object when command.TryGetProperty("action", out JsonElement action) && action.ValueKind == JsonValueKind.String
                => action.GetString(),
            _ => null,
        };
        return name == "unbound" ? null : name;
    }

    // "keys" is one chord or an array of them.
    private static IEnumerable<KeyChord> GetChords(JsonElement entry)
    {
        if (!entry.TryGetProperty("keys", out JsonElement keys))
        {
            yield break;
        }

        IEnumerable<JsonElement> values = keys.ValueKind == JsonValueKind.Array ? keys.EnumerateArray() : [keys];
        foreach (JsonElement value in values)
        {
            if (value.ValueKind == JsonValueKind.String && KeyChord.Parse(value.GetString()!) is KeyChord chord)
            {
                yield return chord;
            }
        }
    }

    // What a chord is bound to: an action id to look up once every file is read, or the action itself.
    private readonly record struct Binding(string? Id, string? Action);
}
