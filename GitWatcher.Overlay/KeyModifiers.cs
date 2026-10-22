namespace GitWatcher.Overlay;

/// <summary>The modifier keys of a <see cref="KeyChord"/>.</summary>
[Flags]
internal enum KeyModifiers
{
    None = 0,
    Control = 1,
    Alt = 2,
    Shift = 4,
    Windows = 8,
}
