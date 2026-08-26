import test from "node:test";
import assert from "node:assert/strict";
import { DrivePublisher, descendantsOf, publicationName } from "../app/src/publisher.js";

test("publicationName diferencia las copias públicas", () => {
  assert.equal(publicationName({ kind: "folder", name: "Proyecto" }), "Proyecto — publicado");
  assert.equal(publicationName({ kind: "note", name: "Idea.md" }), "Idea — publicada.md");
});

test("descendantsOf conserva padres antes que sus hijos", () => {
  const folder = { id: "root" };
  const files = [
    { id: "deep", parentId: "child", kind: "note", trashed: false },
    { id: "child", parentId: "root", kind: "folder", trashed: false },
    { id: "note", parentId: "root", kind: "note", trashed: false },
    { id: "gone", parentId: "root", kind: "note", trashed: true }
  ];
  assert.deepEqual(descendantsOf(folder, files).map(file => file.id), ["child", "note", "deep"]);
});

test("publishNote actualiza la copia existente y conserva su enlace", async () => {
  const calls = [];
  const drive = {
    listFiles: async () => [{ id: "public-1", name: "anterior.md" }],
    updateMetadata: async (id, metadata) => {
      calls.push(["metadata", id, metadata.name]);
      return { id, ...metadata };
    },
    updateMarkdownContent: async (id, content) => {
      calls.push(["content", id, content]);
      return { id };
    },
    allowAnyoneWithLink: async id => {
      calls.push(["permission", id]);
      return "https://drive.google.com/file/d/public-1/view";
    }
  };
  const result = await new DrivePublisher(drive).publishNote({ id: "source-1", kind: "note", name: "Idea.md", content: "Nueva" });
  assert.equal(result.id, "public-1");
  assert.equal(result.url, "https://drive.google.com/file/d/public-1/view");
  assert.deepEqual(calls.map(call => call[0]), ["metadata", "content", "permission"]);
});
