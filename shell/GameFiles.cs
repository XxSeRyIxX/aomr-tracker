// AoM Retold Tracker, Copyright (C) 2026 XxSeRyIxX. SPDX-License-Identifier: AGPL-3.0-or-later
// Additional terms under AGPL section 7 apply: see NOTICE.

using System.Text;
using System.Text.RegularExpressions;

namespace AoMRTracker;

internal static class Files
{
    /// <summary>Reads a file the game or Steam may be writing, retrying briefly while it is locked.</summary>
    public static byte[] ReadShared(string path)
    {
        for (int attempt = 1; ; attempt++)
        {
            try
            {
                using FileStream stream = new(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
                using MemoryStream copy = new();
                stream.CopyTo(copy);
                return copy.ToArray();
            }
            catch (IOException) when (attempt < 4 && File.Exists(path))
            {
                Thread.Sleep(250);
            }
        }
    }

    public static long UnixMs(string? path) => path is not null && File.Exists(path) ? new DateTimeOffset(File.GetLastWriteTimeUtc(path)).ToUnixTimeMilliseconds() : 0;
}

/// <summary>
/// The game's BAR archives ("ESPN" version 6): the u64 at 0x120 points to a table of entries, each a u64 offset,
/// u32 size, u32 stored size, u32 stored size again, u32 name length, UTF-16 name and u32 flags. The tracker only
/// reads entries stored as-is: string tables and the badge images.
/// </summary>
internal sealed class BarArchive
{
    private readonly string _path;
    private readonly Dictionary<string, (long Offset, int Size)> _entries = new(StringComparer.OrdinalIgnoreCase);

    private BarArchive(string path)
    {
        _path = path;
        using FileStream file = new(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
        using BinaryReader reader = new(file);
        if (reader.ReadUInt32() != 0x4E505345) throw new InvalidDataException($"{Path.GetFileName(path)} is not a BAR archive.");
        file.Position = 0x120;
        file.Position = reader.ReadInt64();
        reader.ReadBytes(reader.ReadInt32() * 2);
        int count = reader.ReadInt32();
        for (int i = 0; i < count; i++)
        {
            long offset = reader.ReadInt64();
            int size = reader.ReadInt32();
            int stored = reader.ReadInt32();
            reader.ReadInt32();
            string name = Encoding.Unicode.GetString(reader.ReadBytes(reader.ReadInt32() * 2));
            int flags = reader.ReadInt32();
            if (flags == 0 && size == stored) _entries[name] = (offset, size);
        }
    }

    private static readonly Dictionary<string, (DateTime Written, BarArchive Archive)> Opened = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>The archive's table, read once per version of the file.</summary>
    public static BarArchive Open(string path)
    {
        DateTime written = File.GetLastWriteTimeUtc(path);
        lock (Opened)
        {
            if (Opened.TryGetValue(path, out var known) && known.Written == written) return known.Archive;
            BarArchive archive = new(path);
            Opened[path] = (written, archive);
            return archive;
        }
    }

    public IEnumerable<string> Names => _entries.Keys;

    public byte[]? Read(string name)
    {
        if (!_entries.TryGetValue(name, out var entry)) return null;
        using FileStream file = new(_path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
        file.Position = entry.Offset;
        byte[] data = new byte[entry.Size];
        file.ReadExactly(data);
        return data;
    }
}

/// <summary>The game's texts (strings\Language\string_table.txt in Data.bar): lines like ID = "X" ; Str = "text".</summary>
internal static partial class StringTables
{
    // Only what the page uses: badge names and goals, gods, cultures, difficulties, legends and resources.
    private static readonly string[] Prefixes = ["STR_BDGTTL_", "STR_CIV_", "STR_CULTURE_", "STR_SW_", "STR_GAUNTLET_DIFFICULTY_", "STR_INGAME_HELP_HISTORY_TITLE_", "STR_AOTG_BLESSINGS_NAME_"];
    private static readonly HashSet<string> Ids =
    [
        "STR_CHARACTER_KASTOR", "STR_CHARACTER_GARG", "STR_CHARACTER_CIRCE", "STR_CHARACTER_KAMO", "STR_CHARACTER_AMAN",
        "STR_TUT_M0_PLAYER_02", "STR_CHARACTER_SETN", "STR_CHARACTER_REGI", "STR_CHARACTER_FOLS", "STR_CHARACTER_HALO",
        "STR_MAS_02_CHARACTER_YFF", "STR_TECH_CHIYOU_NAME", "STR_MAS_03_CHARACTER_SHIJI",
        "STR_RESOURCE_FOOD_NAME", "STR_RESOURCE_WOOD_NAME",
    ];

    private static readonly Dictionary<string, (DateTime Written, Dictionary<string, string> Table)> Loaded = [];

    public static Dictionary<string, string> Load(string gameDir, string folder)
    {
        string bar = Path.Combine(gameDir, "game", "data", "Data.bar");
        string key = $"{bar}|{folder}";
        DateTime written = File.GetLastWriteTimeUtc(bar);
        lock (Loaded)
        {
            if (Loaded.TryGetValue(key, out var known) && known.Written == written) return known.Table;
        }
        BarArchive archive = BarArchive.Open(bar);
        byte[]? text = archive.Read($@"strings\{folder}\string_table.txt") ?? archive.Read(@"strings\English\string_table.txt");
        Dictionary<string, string> table = text is null ? [] : Parse(Encoding.UTF8.GetString(text));
        lock (Loaded) Loaded[key] = (written, table);
        return table;
    }

    internal static Dictionary<string, string> Parse(string text)
    {
        Dictionary<string, string> table = [];
        foreach (string line in text.Split('\n'))
        {
            Match m = Entry().Match(line);
            if (!m.Success) continue;
            string id = m.Groups[1].Value;
            if (Ids.Contains(id) || Prefixes.Any(p => id.StartsWith(p, StringComparison.Ordinal)))
                table[id] = m.Groups[2].Value.Replace("\\\"", "\"").Replace("\\n", "\n").Replace("\\\\", "\\");
        }
        return table;
    }

    [GeneratedRegex(@"^\s*ID\s*=\s*""([^""]+)""\s*;\s*Str\s*=\s*""((?:[^""\\]|\\.)*)""", RegexOptions.CultureInvariant)]
    private static partial Regex Entry();
}
