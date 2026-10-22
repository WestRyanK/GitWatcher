using System.Runtime.InteropServices;

namespace GitWatcher.Overlay;

/// <summary>
/// Types key chords into the foreground window, as if they were pressed on the keyboard.
/// </summary>
internal static class KeySender
{
    private const ushort VirtualKeyShift = 0x10;
    private const ushort VirtualKeyControl = 0x11;
    private const ushort VirtualKeyAlt = 0x12;
    private const ushort VirtualKeyLeftWindows = 0x5B;
    private const ushort VirtualKeyRightWindows = 0x5C;
    private const ushort VirtualKeyLeftShift = 0xA0;
    private const ushort VirtualKeyLeftControl = 0xA2;
    private const ushort VirtualKeyLeftAlt = 0xA4;

    private static readonly (KeyModifiers Modifier, ushort VirtualKey)[] s_modifierKeys =
    [
        (KeyModifiers.Control, VirtualKeyLeftControl),
        (KeyModifiers.Alt, VirtualKeyLeftAlt),
        (KeyModifiers.Shift, VirtualKeyLeftShift),
        (KeyModifiers.Windows, VirtualKeyLeftWindows),
    ];

    /// <summary>The modifier keys that are held down on the keyboard right now.</summary>
    public static KeyModifiers HeldModifiers
    {
        get
        {
            KeyModifiers held = KeyModifiers.None;
            if (IsDown(VirtualKeyControl))
            {
                held |= KeyModifiers.Control;
            }

            if (IsDown(VirtualKeyAlt))
            {
                held |= KeyModifiers.Alt;
            }

            if (IsDown(VirtualKeyShift))
            {
                held |= KeyModifiers.Shift;
            }

            if (IsDown(VirtualKeyLeftWindows) || IsDown(VirtualKeyRightWindows))
            {
                held |= KeyModifiers.Windows;
            }

            return held;
        }
    }

    /// <summary>Presses and releases the chord's key while its modifiers are down.</summary>
    /// <remarks>
    /// The user is usually still holding the modifiers, but the window that receives the chord didn't see them go
    /// down, so they're pressed again. Modifiers the user is holding are left down, so that holding the chord keeps
    /// repeating it in the window. The rest are released.
    /// </remarks>
    public static void SendChord(KeyChord chord)
    {
        KeyModifiers held = HeldModifiers;
        List<NativeMethods.Input> inputs = [];
        foreach ((KeyModifiers modifier, ushort virtualKey) in s_modifierKeys)
        {
            if (chord.Modifiers.HasFlag(modifier))
            {
                inputs.Add(CreateKeyInput(virtualKey, keyUp: false));
            }
        }

        inputs.Add(CreateKeyInput(chord.VirtualKey, keyUp: false));
        inputs.Add(CreateKeyInput(chord.VirtualKey, keyUp: true));
        foreach ((KeyModifiers modifier, ushort virtualKey) in Enumerable.Reverse(s_modifierKeys))
        {
            if (chord.Modifiers.HasFlag(modifier) && !held.HasFlag(modifier))
            {
                inputs.Add(CreateKeyInput(virtualKey, keyUp: true));
            }
        }

        NativeMethods.SendInput((uint)inputs.Count, [.. inputs], Marshal.SizeOf<NativeMethods.Input>());
    }

    private static bool IsDown(int virtualKey)
    {
        return (NativeMethods.GetAsyncKeyState(virtualKey) & 0x8000) != 0;
    }

    private static NativeMethods.Input CreateKeyInput(ushort virtualKey, bool keyUp)
    {
        uint flags = keyUp ? NativeMethods.KeyEventKeyUp : 0;
        if (IsExtendedKey(virtualKey))
        {
            flags |= NativeMethods.KeyEventExtendedKey;
        }

        return new NativeMethods.Input
        {
            Type = NativeMethods.InputKeyboard,
            Union = new NativeMethods.InputUnion
            {
                Keyboard = new NativeMethods.KeyboardInput { VirtualKey = virtualKey, Flags = flags },
            },
        };
    }

    // The navigation keys between the main keys and the numeric keypad, the arrow keys, and a few others are extended
    // keys. Without the flag, Windows takes them for the numeric keypad's keys of the same name.
    private static bool IsExtendedKey(ushort virtualKey)
    {
        return virtualKey is >= 0x21 and <= 0x28 // Page Up, Page Down, End, Home, and the arrow keys.
            or 0x2D or 0x2E // Insert and Delete.
            or 0x5B or 0x5C or 0x5D // The Windows keys and the Menu key.
            or 0x6F; // The numeric keypad's divide key.
    }
}
