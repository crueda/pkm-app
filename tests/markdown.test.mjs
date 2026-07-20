import test from "node:test";
import assert from "node:assert/strict";
import { markdownToPlainText, renderInlineMarkdown, renderMarkdown } from "../app/src/markdown.js";

test("el Markdown escapa HTML crudo", () => {
  const html = renderMarkdown("# Seguro\n\n<script>alert('x')</script>");
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
});

test("los enlaces javascript no se convierten en href", () => {
  const html = renderInlineMarkdown("[malicioso](javascript:alert(1))");
  assert.ok(!html.includes("href="));
  assert.ok(html.includes("javascript:alert"));
});

test("los enlaces https son seguros y las wiki links conservan el destino", () => {
  const html = renderInlineMarkdown("[Google](https://google.com) y [[Proyecto|Mi proyecto]]");
  assert.ok(html.includes('rel="noopener noreferrer"'));
  assert.ok(html.includes('data-wiki-target="Proyecto"'));
  assert.ok(html.includes("Mi proyecto"));
});

test("renderiza frontmatter, listas de tareas y tablas", () => {
  const html = renderMarkdown("---\ntype: note\n---\n- [x] Hecho\n\nA | B\n--- | ---\n1 | 2");
  assert.ok(html.includes("frontmatter"));
  assert.ok(html.includes("checked"));
  assert.ok(html.includes("<table>"));
  assert.ok(!html.includes("style="));
});

test("renderiza imágenes Markdown mediante URLs seguras", () => {
  const html = renderMarkdown("![Foto](foto.png)", {
    resolveImageUrl: source => source === "foto.png" ? "blob:https://local.test/foto" : source
  });
  assert.ok(html.includes("<img"));
  assert.ok(html.includes('src="blob:https://local.test/foto"'));
  assert.ok(html.includes('alt="Foto"'));
});

test("las imágenes inseguras no generan src ejecutable", () => {
  const html = renderInlineMarkdown("![x](javascript:alert(1))");
  assert.ok(!html.includes("<img"));
  assert.ok(!html.includes("src="));
});

test("markdownToPlainText usa el texto alternativo de imágenes", () => {
  assert.equal(markdownToPlainText("Antes ![Pizarra](foto.png) después"), "Antes Pizarra después");
});
