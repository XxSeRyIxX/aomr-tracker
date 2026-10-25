// AoM Retold Tracker, Copyright (C) 2026 XxSeRyIxX. SPDX-License-Identifier: AGPL-3.0-or-later
// Additional terms under AGPL section 7 apply: see NOTICE.

using System.Text.Json;
using System.Text.Json.Serialization.Metadata;

namespace AoMRTracker;

/// <summary>The tracker's own files in the user's local app data (AoMRTracker): the last online data, and settings.</summary>
internal sealed class Store(string folder)
{
    public string Folder { get; } = folder;

    public OnlineData? ReadOnline() => Read(Path.Combine(Folder, "online.json"), ShellJson.Default.OnlineData);

    public void WriteOnline(OnlineData data) => Write(Path.Combine(Folder, "online.json"), JsonSerializer.SerializeToUtf8Bytes(data, ShellJson.Default.OnlineData));

    public Settings ReadSettings() => Read(Path.Combine(Folder, "settings.json"), ShellJson.Default.Settings) ?? new Settings();

    public void WriteSettings(Settings settings) => Write(Path.Combine(Folder, "settings.json"), JsonSerializer.SerializeToUtf8Bytes(settings, ShellJson.Default.Settings));

    private static T? Read<T>(string path, JsonTypeInfo<T> info) where T : class
    {
        try
        {
            return File.Exists(path) ? JsonSerializer.Deserialize(File.ReadAllBytes(path), info) : null;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or JsonException)
        {
            return null;
        }
    }

    /// <summary>Writes beside the file, then swaps it in, so a crash never leaves half a file.</summary>
    private void Write(string path, byte[] bytes)
    {
        Directory.CreateDirectory(Folder);
        string temp = path + ".tmp";
        File.WriteAllBytes(temp, bytes);
        File.Move(temp, path, overwrite: true);
    }
}
