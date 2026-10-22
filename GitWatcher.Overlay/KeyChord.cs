namespace GitWatcher.Overlay;

/// <summary>
/// A key with modifiers, such as Alt+Shift+H, identified by its Windows virtual-key code.
/// </summary>
internal readonly record struct KeyChord(KeyModifiers Modifiers, ushort VirtualKey)
{
    // Windows Terminal's names for keys other than letters, digits, and function keys.
    private static readonly Dictionary<string, ushort> s_namedKeys = new(StringComparer.OrdinalIgnoreCase)
    {
        ["backspace"] = 0x08,
        ["tab"] = 0x09,
        ["enter"] = 0x0D,
        ["esc"] = 0x1B,
        ["escape"] = 0x1B,
        ["space"] = 0x20,
        ["pgup"] = 0x21,
        ["pageup"] = 0x21,
        ["pgdn"] = 0x22,
        ["pagedown"] = 0x22,
        ["end"] = 0x23,
        ["home"] = 0x24,
        ["left"] = 0x25,
        ["up"] = 0x26,
        ["right"] = 0x27,
        ["down"] = 0x28,
        ["insert"] = 0x2D,
        ["delete"] = 0x2E,
        ["app"] = 0x5D,
        ["menu"] = 0x5D,
        ["numpad_multiply"] = 0x6A,
        ["numpad_plus"] = 0x6B,
        ["numpad_add"] = 0x6B,
        ["numpad_minus"] = 0x6D,
        ["numpad_subtract"] = 0x6D,
        ["numpad_period"] = 0x6E,
        ["numpad_decimal"] = 0x6E,
        ["numpad_divide"] = 0x6F,
        [";"] = 0xBA,
        ["plus"] = 0xBB,
        ["="] = 0xBB,
        [","] = 0xBC,
        ["comma"] = 0xBC,
        ["-"] = 0xBD,
        ["minus"] = 0xBD,
        ["."] = 0xBE,
        ["period"] = 0xBE,
        ["/"] = 0xBF,
        ["`"] = 0xC0,
        ["["] = 0xDB,
        ["\\"] = 0xDC,
        ["]"] = 0xDD,
        ["'"] = 0xDE,
    };

    /// <summary>
    /// Parses a chord written the way Windows Terminal's settings write them, such as "alt+shift+h", or returns null
    /// if it isn't one this can name. Keys given by scan code, such as "sc(41)", aren't supported.
    /// </summary>
    public static KeyChord? Parse(string text)
    {
        string[] parts = text.Trim().Split('+', StringSplitOptions.TrimEntries);
        KeyModifiers modifiers = KeyModifiers.None;
        foreach (string modifier in parts[..^1])
        {
            switch (modifier.ToLowerInvariant())
            {
                case "ctrl":
                    modifiers |= KeyModifiers.Control;
                    break;
                case "alt":
                    modifiers |= KeyModifiers.Alt;
                    break;
                case "shift":
                    modifiers |= KeyModifiers.Shift;
                    break;
                case "win":
                    modifiers |= KeyModifiers.Windows;
                    break;
                default:
                    return null;
            }
        }

        ushort? key = ParseKey(parts[^1]);
        return key is null ? null : new KeyChord(modifiers, key.Value);
    }

    /// <summary>
    /// The name the page uses for the chord: the modifiers, then the virtual-key code, which is what the page's
    /// KeyboardEvent.keyCode reports in WebView2. For example, Alt+Shift+H is "alt+shift+72".
    /// </summary>
    public override string ToString()
    {
        List<string> parts = [];
        if (Modifiers.HasFlag(KeyModifiers.Control))
        {
            parts.Add("ctrl");
        }

        if (Modifiers.HasFlag(KeyModifiers.Alt))
        {
            parts.Add("alt");
        }

        if (Modifiers.HasFlag(KeyModifiers.Shift))
        {
            parts.Add("shift");
        }

        if (Modifiers.HasFlag(KeyModifiers.Windows))
        {
            parts.Add("win");
        }

        parts.Add(VirtualKey.ToString());
        return string.Join('+', parts);
    }

    private static ushort? ParseKey(string key)
    {
        if (key.Length == 1 && char.IsAsciiLetterOrDigit(key[0]))
        {
            return char.ToUpperInvariant(key[0]);
        }

        if (s_namedKeys.TryGetValue(key, out ushort named))
        {
            return named;
        }

        // Function keys F1 to F24, numeric keypad digits, and keys given by virtual-key code, such as "vk(65)".
        if (key.Length > 1 && (key[0] == 'f' || key[0] == 'F') && int.TryParse(key[1..], out int function) && function is >= 1 and <= 24)
        {
            return (ushort)(0x70 + function - 1);
        }

        string lower = key.ToLowerInvariant();
        foreach (string prefix in (string[])["numpad_", "numpad"])
        {
            if (lower.StartsWith(prefix, StringComparison.Ordinal) && lower.Length == prefix.Length + 1 && char.IsAsciiDigit(lower[^1]))
            {
                return (ushort)(0x60 + lower[^1] - '0');
            }
        }

        if (lower.StartsWith("vk(", StringComparison.Ordinal) && lower.EndsWith(')') && ushort.TryParse(lower[3..^1], out ushort virtualKey))
        {
            return virtualKey;
        }

        return null;
    }
}
