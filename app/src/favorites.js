export function normalizeFavoriteIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter(id => typeof id === "string")
    .map(id => id.trim())
    .filter(Boolean))];
}

export function toggleFavoriteId(value, fileId) {
  const ids = normalizeFavoriteIds(value);
  const normalizedId = typeof fileId === "string" ? fileId.trim() : "";
  if (!normalizedId) return ids;
  return ids.includes(normalizedId)
    ? ids.filter(id => id !== normalizedId)
    : [...ids, normalizedId];
}

export function replaceFavoriteId(value, previousId, nextId) {
  return normalizeFavoriteIds(normalizeFavoriteIds(value).map(id => id === previousId ? nextId : id));
}

export function favoriteFiles(files, favoriteIds) {
  const ids = new Set(normalizeFavoriteIds(favoriteIds));
  return files.filter(file => (
    ids.has(file.id) &&
    !file.trashed &&
    !file.isRoot &&
    ["folder", "note"].includes(file.kind)
  )).sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
    return String(a.name).localeCompare(String(b.name), "es", {
      sensitivity: "base",
      numeric: true
    });
  });
}
