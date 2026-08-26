import test from "node:test";
import assert from "node:assert/strict";
import { GoogleDriveApi, escapeDriveQuery, normalizeDriveFile } from "../app/src/drive-api.js";
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
