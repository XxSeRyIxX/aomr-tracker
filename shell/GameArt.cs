// AoM Retold Tracker, Copyright (C) 2026 XxSeRyIxX. SPDX-License-Identifier: AGPL-3.0-or-later
// Additional terms under AGPL section 7 apply: see NOTICE.

using System.Buffers.Binary;
using System.IO.Compression;
using System.Text;

namespace AoMRTracker;

/// <summary>
/// The pictures of the badges and achievements, straight from the player's own game: game\ui\UITextureCache.bar keeps
/// each as a DDS texture (resources\badge\name.dds, resources\achievements\name.dds). The website ships these as PNG
/// files (tools/export); the desktop makes the same for ones newer than it ships.
/// </summary>
internal static class GameArt
{
    /// <summary>Twice the size the page shows badges at, for screens at 200%. The game's achievements are 80 px.</summary>
    public const int Size = 160;

    public const string Badges = @"resources\badge\";
    public const string Achievements = @"resources\achievements\";

    private static readonly Dictionary<string, byte[]?> Made = [];

    public static string Archive(string gameDir) => Path.Combine(gameDir, "game", "ui", "UITextureCache.bar");

    /// <summary>
    /// Every picture in one of the folders, such as "the_swift" or "achievement_annihilation". The game's "_locked"
    /// achievements are the same pictures in grey, which the page makes itself.
    /// </summary>
    public static IEnumerable<string> Names(string gameDir, string folder) =>
        File.Exists(Archive(gameDir))
            ? BarArchive.Open(Archive(gameDir)).Names
                .Where(n => n.StartsWith(folder, StringComparison.OrdinalIgnoreCase) && n.EndsWith(".dds", StringComparison.OrdinalIgnoreCase))
                .Select(n => n[folder.Length..^4].ToLowerInvariant())
                .Where(n => !n.EndsWith("_locked", StringComparison.Ordinal))
            : [];

    /// <summary>The PNG of a picture, at most Size pixels wide, or null when the game doesn't have it.</summary>
    public static byte[]? Png(string gameDir, string folder, string name)
    {
        string key = folder + name;
        lock (Made)
        {
            if (Made.TryGetValue(key, out byte[]? known)) return known;
        }
        byte[]? png = null;
        string archive = Archive(gameDir);
        if (File.Exists(archive) && BarArchive.Open(archive).Read($"{folder}{name}.dds") is { } dds && Dds.Decode(dds) is var (width, height, rgba))
        {
            while (width > Size && width % 2 == 0 && height % 2 == 0) (width, height, rgba) = Dds.Half(width, height, rgba);
            png = PngFile.Encode(width, height, rgba, CompressionLevel.SmallestSize);
        }
        lock (Made) Made[key] = png;
        return png;
    }
}

/// <summary>Decodes the DDS textures the game uses: BC1, BC3 and plain 32-bit colour, top mip level only.</summary>
internal static class Dds
{
    private const int Bc1 = 71, Bc1Srgb = 72, Bc3 = 77, Bc3Srgb = 78, Rgba = 28, RgbaSrgb = 29, Bgra = 87, BgraSrgb = 91;

    /// <summary>Width, height and RGBA pixels, or null for anything else.</summary>
    public static (int Width, int Height, byte[] Rgba)? Decode(byte[] d)
    {
        if (d.Length < 128 || d[0] != 'D' || d[1] != 'D' || d[2] != 'S' || d[3] != ' ') return null;
        int height = BinaryPrimitives.ReadInt32LittleEndian(d.AsSpan(12));
        int width = BinaryPrimitives.ReadInt32LittleEndian(d.AsSpan(16));
        if (width is < 1 or > 4096 || height is < 1 or > 4096) return null;
        string fourCc = Encoding.ASCII.GetString(d, 84, 4);
        int offset = 128;
        int format;
        if (fourCc == "DX10")
        {
            if (d.Length < 148) return null;
            format = BinaryPrimitives.ReadInt32LittleEndian(d.AsSpan(128));
            offset = 148;
        }
        else
        {
            format = fourCc switch { "DXT1" => Bc1, "DXT5" => Bc3, _ => BinaryPrimitives.ReadInt32LittleEndian(d.AsSpan(88)) == 32 ? Bgra : 0 };
        }

        byte[] rgba = new byte[width * height * 4];
        ReadOnlySpan<byte> data = d.AsSpan(offset);
        switch (format)
        {
            case Bc1 or Bc1Srgb or Bc3 or Bc3Srgb:
                bool alpha = format is Bc3 or Bc3Srgb;
                int blockSize = alpha ? 16 : 8;
                int blocksX = (width + 3) / 4, blocksY = (height + 3) / 4;
                if (data.Length < blocksX * blocksY * blockSize) return null;
                for (int by = 0; by < blocksY; by++)
                    for (int bx = 0; bx < blocksX; bx++)
                        DecodeBlock(data.Slice((by * blocksX + bx) * blockSize, blockSize), alpha, rgba, width, height, bx * 4, by * 4);
                return (width, height, rgba);
            case Rgba or RgbaSrgb or Bgra or BgraSrgb:
                if (data.Length < rgba.Length) return null;
                data[..rgba.Length].CopyTo(rgba);
                if (format is Bgra or BgraSrgb)
                    for (int i = 0; i < rgba.Length; i += 4) (rgba[i], rgba[i + 2]) = (rgba[i + 2], rgba[i]);
                return (width, height, rgba);
            default:
                return null;
        }
    }

    /// <summary>Half the width and height: each pixel is the average of four, weighted by alpha so edges don't darken.</summary>
    public static (int Width, int Height, byte[] Rgba) Half(int width, int height, byte[] rgba)
    {
        int w = width / 2, h = height / 2;
        byte[] half = new byte[w * h * 4];
        for (int y = 0; y < h; y++)
            for (int x = 0; x < w; x++)
            {
                int r = 0, g = 0, b = 0, a = 0;
                for (int dy = 0; dy < 2; dy++)
                    for (int dx = 0; dx < 2; dx++)
                    {
                        int p = ((2 * y + dy) * width + 2 * x + dx) * 4;
                        int alpha = rgba[p + 3];
                        r += rgba[p] * alpha;
                        g += rgba[p + 1] * alpha;
                        b += rgba[p + 2] * alpha;
                        a += alpha;
                    }
                int q = (y * w + x) * 4;
                if (a > 0)
                {
                    half[q] = (byte)((r + a / 2) / a);
                    half[q + 1] = (byte)((g + a / 2) / a);
                    half[q + 2] = (byte)((b + a / 2) / a);
                }
                half[q + 3] = (byte)((a + 2) / 4);
            }
        return (w, h, half);
    }

    private static void DecodeBlock(ReadOnlySpan<byte> block, bool hasAlpha, byte[] rgba, int width, int height, int x0, int y0)
    {
        Span<byte> alphas = stackalloc byte[8];
        ulong alphaBits = 0;
        if (hasAlpha)
        {
            byte a0 = block[0], a1 = block[1];
            alphas[0] = a0;
            alphas[1] = a1;
            if (a0 > a1)
                for (int k = 1; k < 7; k++) alphas[k + 1] = (byte)(((7 - k) * a0 + k * a1) / 7);
            else
            {
                for (int k = 1; k < 5; k++) alphas[k + 1] = (byte)(((5 - k) * a0 + k * a1) / 5);
                alphas[6] = 0;
                alphas[7] = 255;
            }
            for (int i = 0; i < 6; i++) alphaBits |= (ulong)block[2 + i] << (8 * i);
            block = block[8..];
        }

        ushort c0 = BinaryPrimitives.ReadUInt16LittleEndian(block), c1 = BinaryPrimitives.ReadUInt16LittleEndian(block[2..]);
        Span<byte> colors = stackalloc byte[16];
        Expand(c0, colors[..4]);
        Expand(c1, colors[4..8]);
        if (hasAlpha || c0 > c1)
        {
            for (int c = 0; c < 3; c++)
            {
                colors[8 + c] = (byte)((2 * colors[c] + colors[4 + c]) / 3);
                colors[12 + c] = (byte)((colors[c] + 2 * colors[4 + c]) / 3);
            }
            colors[11] = colors[15] = 255;
        }
        else
        {
            for (int c = 0; c < 3; c++) colors[8 + c] = (byte)((colors[c] + colors[4 + c]) / 2);
            colors[11] = 255;
            colors[12] = colors[13] = colors[14] = colors[15] = 0;
        }

        uint indices = BinaryPrimitives.ReadUInt32LittleEndian(block[4..]);
        for (int i = 0; i < 16; i++)
        {
            int x = x0 + (i & 3), y = y0 + (i >> 2);
            if (x >= width || y >= height) continue;
            int color = (int)((indices >> (2 * i)) & 3) * 4;
            int p = (y * width + x) * 4;
            rgba[p] = colors[color];
            rgba[p + 1] = colors[color + 1];
            rgba[p + 2] = colors[color + 2];
            rgba[p + 3] = hasAlpha ? alphas[(int)((alphaBits >> (3 * i)) & 7)] : colors[color + 3];
        }
    }

    private static void Expand(ushort c, Span<byte> rgba)
    {
        int r = (c >> 11) & 31, g = (c >> 5) & 63, b = c & 31;
        rgba[0] = (byte)((r << 3) | (r >> 2));
        rgba[1] = (byte)((g << 2) | (g >> 4));
        rgba[2] = (byte)((b << 3) | (b >> 2));
        rgba[3] = 255;
    }
}

/// <summary>A minimal PNG writer: 8-bit RGBA, no filtering, one zlib stream.</summary>
internal static class PngFile
{
    private static readonly uint[] CrcTable = MakeCrcTable();

    public static byte[] Encode(int width, int height, byte[] rgba, CompressionLevel level = CompressionLevel.Fastest)
    {
        using MemoryStream raw = new();
        using (ZLibStream zlib = new(raw, level, leaveOpen: true))
        {
            for (int y = 0; y < height; y++)
            {
                zlib.WriteByte(0);
                zlib.Write(rgba, y * width * 4, width * 4);
            }
        }

        using MemoryStream png = new();
        png.Write([0x89, (byte)'P', (byte)'N', (byte)'G', 0x0D, 0x0A, 0x1A, 0x0A]);
        byte[] header = new byte[13];
        BinaryPrimitives.WriteInt32BigEndian(header, width);
        BinaryPrimitives.WriteInt32BigEndian(header.AsSpan(4), height);
        header[8] = 8;   // bits per channel
        header[9] = 6;   // RGBA
        Chunk(png, "IHDR", header);
        Chunk(png, "IDAT", raw.ToArray());
        Chunk(png, "IEND", []);
        return png.ToArray();
    }

    private static void Chunk(Stream png, string type, byte[] data)
    {
        Span<byte> number = stackalloc byte[4];
        BinaryPrimitives.WriteInt32BigEndian(number, data.Length);
        png.Write(number);
        byte[] typeBytes = Encoding.ASCII.GetBytes(type);
        png.Write(typeBytes);
        png.Write(data);
        BinaryPrimitives.WriteUInt32BigEndian(number, Crc(Crc(0xFFFFFFFF, typeBytes), data) ^ 0xFFFFFFFF);
        png.Write(number);
    }

    internal static uint Crc(uint crc, ReadOnlySpan<byte> data)
    {
        foreach (byte b in data) crc = CrcTable[(crc ^ b) & 0xFF] ^ (crc >> 8);
        return crc;
    }

    private static uint[] MakeCrcTable()
    {
        uint[] table = new uint[256];
        for (uint n = 0; n < 256; n++)
        {
            uint c = n;
            for (int k = 0; k < 8; k++) c = (c & 1) != 0 ? 0xEDB88320 ^ (c >> 1) : c >> 1;
            table[n] = c;
        }
        return table;
    }
}
