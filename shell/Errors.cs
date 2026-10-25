// AoM Retold Tracker, Copyright (C) 2026 XxSeRyIxX. SPDX-License-Identifier: AGPL-3.0-or-later
// Additional terms under AGPL section 7 apply: see NOTICE.

using System.Text.Json;

namespace AoMRTracker;

/// <summary>An answer for the page: an HTTP-like status, a code it translates (app/i18n.js) and an English message.</summary>
public sealed class ApiException(int status, string code, string message) : Exception(message)
{
    public int Status { get; } = status;
    public string Code { get; } = code;
}

internal static class Errors
{
    /// <summary>The status, code and message the page gets for a failed request.</summary>
    public static (int Status, string Code, string Message) Explain(Exception e) => e switch
    {
        TaskCanceledException { InnerException: TimeoutException } => (504, "timeout", "The server took too long to answer."),
        OperationCanceledException => (499, "stopped", "Stopped."),
        ApiException a => (a.Status, a.Code, a.Message),
        HttpRequestException h => (502, "offline", $"Couldn't reach the server: {h.Message}"),
        JsonException => (502, "bad-answer", "The server sent an answer the tracker doesn't understand."),
        _ => (500, "failed", e.Message),
    };
}
