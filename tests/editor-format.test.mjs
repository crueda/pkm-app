import test from "node:test";
import assert from "node:assert/strict";

import { formatMarkdown } from "../app/src/editor-format.js";

test("aplica y retira negrita sobre la selección", () => {
  const formatted = formatMarkdown("hola mundo", 5, 10, "bold");
  assert.equal(formatted.value, "hola **mundo**");
  assert.deepEqual([formatted.selectionStart, formatted.selectionEnd], [7, 12]);

  const removed = formatMarkdown(formatted.value, 5, 14, "bold");
  assert.equal(removed.value, "hola mundo");
});

test("inserta un marcador editable cuando no hay selección", () => {
  const result = formatMarkdown("", 0, 0, "italic");
  assert.equal(result.value, "_texto en cursiva_");
  assert.equal(result.value.slice(result.selectionStart, result.selectionEnd), "texto en cursiva");
});

test("convierte varias líneas en una lista con viñetas", () => {
  const result = formatMarkdown("Uno\nDos", 0, 7, "bulleted-list");
  assert.equal(result.value, "- Uno\n- Dos");
});

test("inserta una viñeta en una línea vacía y deja el cursor listo", () => {
  const result = formatMarkdown("", 0, 0, "bulleted-list");
  assert.equal(result.value, "- ");
  assert.deepEqual([result.selectionStart, result.selectionEnd], [2, 2]);
});

test("cambia un encabezado existente al nivel solicitado", () => {
  const result = formatMarkdown("### Sección", 4, 4, "heading-2");
  assert.equal(result.value, "## Sección");
});

test("crea enlaces y selecciona la URL cuando hay texto", () => {
  const result = formatMarkdown("OpenAI", 0, 6, "link");
  assert.equal(result.value, "[OpenAI](https://)");
  assert.equal(result.value.slice(result.selectionStart, result.selectionEnd), "https://");
});

test("envuelve la selección en un bloque de código", () => {
  const result = formatMarkdown("const x = 1;", 0, 12, "code-block");
  assert.equal(result.value, "```\nconst x = 1;\n```");
  assert.equal(result.value.slice(result.selectionStart, result.selectionEnd), "const x = 1;");
});
