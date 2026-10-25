// AoM Retold Tracker, Copyright (C) 2026 XxSeRyIxX. SPDX-License-Identifier: AGPL-3.0-or-later
// Additional terms under AGPL section 7 apply: see NOTICE.

// Writes what the website takes from an installed game and Steam:
//   app/data/game.json          the game's texts in English and Spanish, and the game build they come from
//   app/data/steam-schema.vdf   Steam's achievement list (icons, and the names and texts the page shows: English and Spanish)
//   app/art/badges.pack/.json   the badge art, packed into one file with an index of where each image starts
//   app/art/achievements.pack/.json   the achievement art, the same way
// Never .bin: download managers (IDM) take those over even when the page only reads them.
// What the game's servers say (badges, challenges, rarity) is tools/server-data.mjs, which needs no game.
// Run this after a game update: dotnet run --project tools/export -c Release [-- path\to\app]

using System.Buffers.Binary;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using AoMRTracker;

string app = Path.GetFullPath(args.Length > 0 ? args[0] : "app");
if (!File.Exists(Path.Combine(app, "index.html")))
{
    Console.Error.WriteLine($"{app} is not the app folder. Run this from the repository, or pass the app folder.");
    return 1;
}
IReadOnlyList<string> roots = Steam.Roots();
GameInstall install = GameInstall.Find() ?? throw new InvalidOperationException("Age of Mythology: Retold isn't installed with Steam.");
string schemaFile = roots.Select(Steam.SchemaFile).FirstOrDefault(File.Exists)
    ?? throw new InvalidOperationException("Steam's achievement list for the game isn't on this computer: start the game once with Steam.");
string gameDir = install.Dir;
string? build = install.Build;

string data = Path.Combine(app, "data");
string art = Path.Combine(app, "art");
Directory.CreateDirectory(data);
Directory.CreateDirectory(art);

// Steam's file has 26 languages, eight times what the page reads (core.js steamTextLanguage), and every visit downloads it.
File.WriteAllBytes(Path.Combine(data, "steam-schema.vdf"), KeepLanguages(File.ReadAllBytes(schemaFile), ["english", "spanish", "latam"]));

int badges = Pack("badges", GameArt.Badges);
int achievements = Pack("achievements", GameArt.Achievements);

JsonObject game = new()
{
    ["exported"] = DateTime.UtcNow.ToString("yyyy-MM-dd"),
    ["build"] = build,
    ["strings"] = new JsonObject
    {
        ["en"] = Sorted(StringTables.Load(gameDir, GameInstall.StringsFolder("en", "english"))),
        ["es"] = Sorted(StringTables.Load(gameDir, GameInstall.StringsFolder("es", "spanish"))),
    },
};
File.WriteAllText(Path.Combine(data, "game.json"), game.ToJsonString(new JsonSerializerOptions { WriteIndented = true }) + "\n");

long kilobytes = (new FileInfo(Path.Combine(art, "badges.pack")).Length + new FileInfo(Path.Combine(art, "achievements.pack")).Length) / 1024;
Console.WriteLine($"Exported game build {build}: {badges} badge and {achievements} achievement images ({kilobytes} KB), " +
    $"{game["strings"]!["en"]!.AsObject().Count} texts per language, Steam's achievement list, into {app}.");
return 0;

// One file per kind for all its art instead of a request per picture; the page cuts each image out of it. Box is the
// size every picture has.
int Pack(string file, string folder)
{
    JsonObject at = [];
    int[]? box = null;
    using (FileStream pack = new(Path.Combine(art, $"{file}.pack"), FileMode.Create))
    {
        foreach (string name in GameArt.Names(gameDir, folder).Order(StringComparer.Ordinal))
        {
            byte[] png = GameArt.Png(gameDir, folder, name) ?? throw new InvalidDataException($"Can't decode {name}.");
            int[] size = [BinaryPrimitives.ReadInt32BigEndian(png.AsSpan(16)), BinaryPrimitives.ReadInt32BigEndian(png.AsSpan(20))];
            if (!(box ??= size).SequenceEqual(size)) throw new InvalidDataException($"{name} is {size[0]}x{size[1]}, the rest {box[0]}x{box[1]}.");
            at[name] = new JsonArray(pack.Position, png.Length);
            pack.Write(png);
        }
    }
    if (box is null) throw new InvalidDataException($"The game has no {file} art.");
    JsonObject index = new() { ["box"] = new JsonArray(box[0], box[1]), ["at"] = at };
    File.WriteAllText(Path.Combine(art, $"{file}.json"), index.ToJsonString() + "\n");
    return at.Count;
}

// Copies Steam's binary KeyValues (the format of app/files.js parseKeyValues), with the name and description of each
// achievement in the given languages only.
static byte[] KeepLanguages(byte[] vdf, string[] languages)
{
    using MemoryStream output = new();
    int pos = 0;
    Copy("", "");
    return output.ToArray();

    void Copy(string parent, string name)
    {
        bool texts = parent == "display" && name is "name" or "desc";
        while (pos < vdf.Length)
        {
            int start = pos;
            byte type = vdf[pos++];
            if (type is 8 or 11)
            {
                output.WriteByte(type);
                return;
            }
            string key = Text();
            if (type == 0)
            {
                output.Write(vdf, start, pos - start);
                Copy(name, key);
                continue;
            }
            pos = type switch
            {
                1 => SkipText(),
                2 or 3 or 4 or 6 => pos + 4,
                7 or 10 => pos + 8,
                _ => throw new InvalidDataException($"Unknown KeyValues type {type} in Steam's achievement list."),
            };
            if (pos > vdf.Length) throw new InvalidDataException("Steam's achievement list ends early.");
            // Steam writes some names in capitals ("LATAM"); the page reads them in lower case.
            if (!texts || languages.Contains(key, StringComparer.OrdinalIgnoreCase)) output.Write(vdf, start, pos - start);
        }
    }

    string Text()
    {
        int at = pos;
        pos = SkipText();
        return Encoding.UTF8.GetString(vdf, at, pos - 1 - at);
    }

    int SkipText()
    {
        int end = Array.IndexOf(vdf, (byte)0, pos);
        return end < 0 ? throw new InvalidDataException("Steam's achievement list ends early.") : end + 1;
    }
}

static JsonObject Sorted(Dictionary<string, string> table) =>
    new(table.OrderBy(p => p.Key, StringComparer.Ordinal).Select(p => KeyValuePair.Create(p.Key, (JsonNode?)JsonValue.Create(p.Value))));
