import test from "node:test";
import assert from "node:assert/strict";
import { buildPathMap, createUniqueName, sanitizeName } from "../app/src/path-utils.js";
import { MIME_FOLDER, MIME_MARKDOWN } from "../app/src/utils.js";

test("sanitizeName elimina separadores y añade .md", () => {
  assert.equal(sanitizeName("  proyecto/privado  ", { markdown: true }), "proyecto-privado.md");
  assert.equal(sanitizeName("...", { markdown: false }), "Nueva carpeta");
});

test("createUniqueName evita duplicados sin distinguir mayúsculas", () => {
  const files = [{ id: "1", parentId: "root", name: "Idea.md" }];
  assert.equal(createUniqueName(files, "root", "idea", { markdown: true }), "idea 2.md");
});

test("buildPathMap construye rutas de carpetas y notas", () => {
  const files = [
    { id: "root", name: "NotesVault", parentId: null, mimeType: MIME_FOLDER },
    { id: "folder", name: "Proyectos", parentId: "root", mimeType: MIME_FOLDER },
    { id: "note", name: "App.md", parentId: "folder", mimeType: MIME_MARKDOWN }
  ];
  const paths = buildPathMap(files, "root");
  assert.equal(paths.get("folder"), "Proyectos");
  assert.equal(paths.get("note"), "Proyectos/App.md");
});
