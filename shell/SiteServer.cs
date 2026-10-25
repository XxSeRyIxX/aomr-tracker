// AoM Retold Tracker, Copyright (C) 2026 XxSeRyIxX. SPDX-License-Identifier: AGPL-3.0-or-later
// Additional terms under AGPL section 7 apply: see NOTICE.

using System.Net;
using System.Net.Sockets;
using System.Text;

namespace AoMRTracker;

/// <summary>
/// The page over loopback HTTP, for macOS and Linux, whose webviews can't answer http:// requests from memory the way
/// WebView2 does on Windows. Only 127.0.0.1, only GET, and only requests addressed to the app's own origin: a website
/// that points its own name at this address (DNS rebinding) still sends that name, and is refused.
/// </summary>
internal sealed class SiteServer : IDisposable
{
    private readonly TcpListener _listener;
    private readonly CancellationTokenSource _stopping = new();
    private readonly string _host;

    public SiteServer(int port)
    {
        _listener = new TcpListener(IPAddress.Loopback, port);
        _listener.Start();
        Port = ((IPEndPoint)_listener.LocalEndpoint).Port;
        _host = $"127.0.0.1:{Port}";
        _ = Task.Run(AcceptLoopAsync);
    }

    public int Port { get; }

    public void Dispose()
    {
        _stopping.Cancel();
        _listener.Stop();
    }

    private async Task AcceptLoopAsync()
    {
        while (!_stopping.IsCancellationRequested)
        {
            TcpClient client;
            try
            {
                client = await _listener.AcceptTcpClientAsync(_stopping.Token);
            }
            catch (Exception e) when (e is OperationCanceledException or SocketException or ObjectDisposedException)
            {
                return;
            }
            _ = Task.Run(() => ServeAsync(client));
        }
    }

    private async Task ServeAsync(TcpClient client)
    {
        using (client)
        {
            try
            {
                NetworkStream stream = client.GetStream();
                using CancellationTokenSource timeout = new(TimeSpan.FromSeconds(10));
                if (await ReadHeadAsync(stream, timeout.Token) is not var (method, target, host)) return;
                if (!string.Equals(host, _host, StringComparison.OrdinalIgnoreCase))
                    await WriteAsync(stream, "421 Misdirected Request", "text/plain", "Wrong host."u8.ToArray());
                else if (method != "GET")
                    await WriteAsync(stream, "405 Method Not Allowed", "text/plain", "GET only."u8.ToArray());
                else if (Site.Open(target) is not var (content, type))
                    await WriteAsync(stream, "404 Not Found", "text/plain", "Not found."u8.ToArray());
                else
                {
                    using (content)
                    {
                        using MemoryStream body = new();
                        await content.CopyToAsync(body);
                        await WriteAsync(stream, "200 OK", type, body.ToArray());
                    }
                }
            }
            catch (Exception e) when (e is IOException or SocketException or OperationCanceledException or ObjectDisposedException)
            {
                // the webview hung up
            }
        }
    }

    /// <summary>The method, target and Host header of a request; null for anything that isn't a whole request head.</summary>
    internal static async Task<(string Method, string Target, string? Host)?> ReadHeadAsync(Stream stream, CancellationToken ct)
    {
        byte[] buffer = new byte[16 * 1024];
        int received = 0;
        while (received < buffer.Length)
        {
            int read = await stream.ReadAsync(buffer.AsMemory(received), ct);
            if (read == 0) return null;
            received += read;
            int end = buffer.AsSpan(0, received).IndexOf("\r\n\r\n"u8);
            if (end < 0) continue;
            string[] lines = Encoding.ASCII.GetString(buffer, 0, end).Split("\r\n");
            string[] request = lines[0].Split(' ');
            if (request.Length != 3) return null;
            string? host = lines.Skip(1).Select(line => line.Split(':', 2))
                .Where(field => field.Length == 2 && field[0].Trim().Equals("Host", StringComparison.OrdinalIgnoreCase))
                .Select(field => field[1].Trim()).FirstOrDefault();
            return (request[0], request[1], host);
        }
        return null;
    }

    private static async Task WriteAsync(Stream stream, string status, string type, byte[] body)
    {
        string head = $"HTTP/1.1 {status}\r\nContent-Type: {type}\r\nContent-Length: {body.Length}\r\n" +
            "Cache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n";
        await stream.WriteAsync(Encoding.ASCII.GetBytes(head));
        await stream.WriteAsync(body);
        await stream.FlushAsync();
    }
}
