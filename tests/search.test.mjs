import test from "node:test";
import assert from "node:assert/strict";
import { enrichNoteRecord, extractTags, extractTitle, searchNotes } from "../app/src/search.js";

test("extractTitle usa el primer H1 y extrae etiquetas", () => {
  const content = "---\ntype: idea\n---\n# Álgebra útil\nTexto #matemáticas #estudio/uni";
  assert.equal(extractTitle(content, "fallback.md"), "Álgebra útil");
  assert.deepEqual(extractTags(content), ["estudio/uni", "matemáticas"]);
});

test("la búsqueda ignora tildes y prioriza el título", () => {
  const files = [
    enrichNoteRecord({ id: "1", kind: "note", name: "algebra.md", path: "uni/algebra.md", content: "# Álgebra lineal\nMatrices", modifiedTime: "2026-07-18T10:00:00Z" }),
    enrichNoteRecord({ id: "2", kind: "note", name: "ideas.md", path: "ideas.md", content: "# Ideas\nAprender algebra", modifiedTime: "2026-07-17T10:00:00Z" })
  ];
  const results = searchNotes(files, "algebra");
  assert.equal(results[0].file.id, "1");
  assert.equal(results.length, 2);
});

test("la búsqueda soporta filtros #tag y path", () => {
  const files = [
    enrichNoteRecord({ id: "1", kind: "note", name: "a.md", path: "proyectos/a.md", content: "# A\n#trabajo" }),
    enrichNoteRecord({ id: "2", kind: "note", name: "b.md", path: "personal/b.md", content: "# B\n#trabajo" })
  ];
  const results = searchNotes(files, "#trabajo path:proyectos");
  assert.deepEqual(results.map(result => result.file.id), ["1"]);
});
