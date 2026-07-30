import test from "node:test";
import assert from "node:assert/strict";
import {
  favoriteFiles,
  normalizeFavoriteIds,
  replaceFavoriteId,
  toggleFavoriteId
} from "../app/src/favorites.js";

test("normalizeFavoriteIds elimina valores inválidos y duplicados", () => {
  assert.deepEqual(normalizeFavoriteIds(["a", " a ", "", null, "b", "a"]), ["a", "b"]);
});

test("toggleFavoriteId añade y elimina un favorito", () => {
  assert.deepEqual(toggleFavoriteId(["a"], "b"), ["a", "b"]);
  assert.deepEqual(toggleFavoriteId(["a", "b"], "a"), ["b"]);
});

test("replaceFavoriteId conserva el favorito al recibir un ID remoto", () => {
  assert.deepEqual(replaceFavoriteId(["local:1", "remote:2"], "local:1", "remote:1"), ["remote:1", "remote:2"]);
  assert.deepEqual(replaceFavoriteId(["local:1", "remote:1"], "local:1", "remote:1"), ["remote:1"]);
});

test("favoriteFiles filtra eliminados y ordena carpetas antes que notas", () => {
  const files = [
    { id: "note", kind: "note", name: "A.md", trashed: false },
    { id: "deleted", kind: "note", name: "B.md", trashed: true },
    { id: "folder", kind: "folder", name: "Zeta", trashed: false },
    { id: "root", kind: "folder", name: "Raíz", isRoot: true, trashed: false }
  ];
  assert.deepEqual(
    favoriteFiles(files, ["note", "deleted", "folder", "root"]).map(file => file.id),
    ["folder", "note"]
  );
});
