import test from "node:test";
import assert from "node:assert/strict";

import {
  findNinjutsuAreaFolder,
  findNinjutsuFolder,
  findNinjutsuTrainingFolder,
  ninjutsuCategories,
  ninjutsuNotes,
  parseNinjutsuNote,
  searchNinjutsuNotes,
  trainingNoteTemplate
} from "../app/src/ninjutsu.js";

const files = [
  { id: "pkm", kind: "folder", name: "PKM", parentId: "root", path: "PKM" },
  { id: "area", kind: "folder", name: "200 - AREA", parentId: "pkm", path: "PKM/200 - AREA" },
  { id: "ninja", kind: "folder", name: "201 - NINJUTSU", parentId: "area", path: "PKM/200 - AREA/201 - NINJUTSU" },
  { id: "program", kind: "folder", name: "01 - Programa 2024", parentId: "ninja", path: "PKM/200 - AREA/201 - NINJUTSU/01 - Programa 2024" },
  { id: "grades", kind: "folder", name: "Grados", parentId: "program", path: "PKM/200 - AREA/201 - NINJUTSU/01 - Programa 2024/Grados" },
  { id: "training", kind: "folder", name: "03 - Entrenamientos", parentId: "ninja", path: "PKM/200 - AREA/201 - NINJUTSU/03 - Entrenamientos" },
  {
    id: "kyu9",
    kind: "note",
    name: "09 - 9º Kyu.md",
    parentId: "grades",
    path: "PKM/200 - AREA/201 - NINJUTSU/01 - Programa 2024/Grados/09 - 9º Kyu.md",
    content: "---\ntipo: grado\nnivel: 9º kyu\n---\n# 9.º Kyu\n\n## Taihen Jutsu\nZenpo kaiten y koho kaiten."
  },
  {
    id: "open",
    kind: "note",
    name: "001 - Puertas abiertas.md",
    parentId: "training",
    path: "PKM/200 - AREA/201 - NINJUTSU/03 - Entrenamientos/001 - Puertas abiertas.md",
    content: "---\ntipo: entrenamiento\nfecha: 2026-09-24\n---\n# Puertas abiertas\n\nSesión con juegos de distancia."
  }
];

test("encuentra el área y la biblioteca de Ninjutsu dentro de PKM", () => {
  assert.equal(findNinjutsuAreaFolder(files)?.id, "area");
  assert.equal(findNinjutsuFolder(files)?.id, "ninja");
  assert.equal(findNinjutsuTrainingFolder(files)?.id, "training");
});

test("incluye notas de todas las subcarpetas de Ninjutsu", () => {
  assert.deepEqual(ninjutsuNotes(files).map(file => file.id), ["kyu9", "open"]);
});

test("parsea metadatos, título y categoría desde Markdown", () => {
  const parsed = parseNinjutsuNote(files.find(file => file.id === "open"), findNinjutsuFolder(files));
  assert.equal(parsed.title, "Puertas abiertas");
  assert.equal(parsed.category, "Entrenamientos");
  assert.equal(parsed.metadata.tipo, "entrenamiento");
  assert.match(parsed.summary, /Sesión con juegos/);
});

test("busca sin distinguir tildes y filtra por categoría", () => {
  assert.deepEqual(searchNinjutsuNotes(files, findNinjutsuFolder(files), "sesion distancia").map(result => result.file.id), ["open"]);
  assert.deepEqual(searchNinjutsuNotes(files, findNinjutsuFolder(files), "kaiten", "01 - Programa 2024").map(result => result.file.id), ["kyu9"]);
  assert.deepEqual(ninjutsuCategories(files, findNinjutsuFolder(files)).map(category => [category.label, category.count]), [
    ["Programa 2024", 1],
    ["Entrenamientos", 1]
  ]);
});

test("genera una plantilla de entrenamiento trazable y editable", () => {
  const markdown = trainingNoteTemplate({ date: "2026-10-01" });
  assert.match(markdown, /tipo: entrenamiento/);
  assert.match(markdown, /fecha: 2026-10-01/);
  assert.match(markdown, /## Plan de la sesión/);
  assert.match(markdown, /## Observaciones/);
});
