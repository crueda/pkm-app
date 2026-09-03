import test from "node:test";
import assert from "node:assert/strict";
import { DriveApiError, GoogleDriveApi, escapeDriveQuery, isRetryableDriveError, normalizeDriveFile } from "../app/src/drive-api.js";
import { MIME_FOLDER } from "../app/src/utils.js";

test("escapeDriveQuery protege comillas y barras", () => {
  assert.equal(escapeDriveQuery("L'idea\\x"), "L\\'idea\\\\x");
});

test("normalizeDriveFile distingue carpetas y notas", () => {
  assert.equal(normalizeDriveFile({ id: "1", name: "A", mimeType: MIME_FOLDER }).kind, "folder");
  assert.equal(normalizeDriveFile({ id: "2", name: "Nota.md", mimeType: "text/plain" }).kind, "note");
  assert.equal(normalizeDriveFile({ id: "3", name: "foto.png", mimeType: "image/png" }).kind, "attachment");
});

test("allowAnyoneWithLink reutiliza un permiso público existente", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), method: options.method || "GET" });
    if (String(url).includes("/permissions")) {
      return new Response(JSON.stringify({ permissions: [{ id: "public", type: "anyone", role: "reader" }] }), {
        headers: { "Content-Type": "application/json" }
      });
    }
    return new Response(JSON.stringify({ id: "file-1", webViewLink: "https://drive.google.com/file/d/file-1/view" }), {
      headers: { "Content-Type": "application/json" }
    });
  };
  try {
    const api = new GoogleDriveApi(() => "token");
    assert.equal(await api.allowAnyoneWithLink("file-1"), "https://drive.google.com/file/d/file-1/view");
    assert.deepEqual(requests.map(request => request.method), ["GET", "GET"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("cancela una petición de Drive que supera el tiempo límite", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  });
  try {
    const api = new GoogleDriveApi(() => "token", { requestTimeoutMs: 5, maxRetries: 0 });
    await assert.rejects(() => api.getCurrentUser(), error => error?.code === "request_timeout");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("identifica los errores temporales que se pueden reintentar", () => {
  assert.equal(isRetryableDriveError(new DriveApiError("ocupado", { status: 503 })), true);
  assert.equal(isRetryableDriveError(new DriveApiError("límite", { status: 403, code: "rateLimitExceeded" })), true);
  assert.equal(isRetryableDriveError(new DriveApiError("prohibido", { status: 403 })), false);
});
