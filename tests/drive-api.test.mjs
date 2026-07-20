import test from "node:test";
import assert from "node:assert/strict";
import { escapeDriveQuery, normalizeDriveFile } from "../app/src/drive-api.js";
import { MIME_FOLDER } from "../app/src/utils.js";

test("escapeDriveQuery protege comillas y barras", () => {
  assert.equal(escapeDriveQuery("L'idea\\x"), "L\\'idea\\\\x");
});

test("normalizeDriveFile distingue carpetas y notas", () => {
  assert.equal(normalizeDriveFile({ id: "1", name: "A", mimeType: MIME_FOLDER }).kind, "folder");
  assert.equal(normalizeDriveFile({ id: "2", name: "Nota.md", mimeType: "text/plain" }).kind, "note");
  assert.equal(normalizeDriveFile({ id: "3", name: "foto.png", mimeType: "image/png" }).kind, "attachment");
});
