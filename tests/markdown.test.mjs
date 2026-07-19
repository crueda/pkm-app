import test from "node:test";
import assert from "node:assert/strict";
import { renderInlineMarkdown, renderMarkdown } from "../app/src/markdown.js";

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
