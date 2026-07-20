import { MIME_FOLDER, basenameWithoutExtension } from "./utils.js";

const FORBIDDEN_NAME_CHARS = /[\\/:*?"<>|\u0000-\u001F]/g;

export function sanitizeName(input, { markdown = false, maxLength = 120 } = {}) {
  let name = String(input ?? "")
    .normalize("NFC")
    .replace(FORBIDDEN_NAME_CHARS, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+$/, "")
    .replace(/[. ]+$/g, "")
    .slice(0, maxLength)
    .trim();

  if (!name) name = markdown ? "Sin título.md" : "Nueva carpeta";
  if (markdown && !/\.md$/i.test(name)) name = `${name}.md`;
  return name;
}

export function joinPath(...parts) {
  return parts
    .flatMap(part => String(part ?? "").split("/"))
    .map(part => part.trim())
    .filter(Boolean)
    .join("/");
}

export function noteDisplayName(file) {
  return basenameWithoutExtension(file?.name ?? "");
}

export function buildPathMap(files, rootId) {
  const map = new Map(files.map(file => [file.id, file]));
  const memo = new Map([[rootId, ""]]);
  const visiting = new Set();

  function resolve(id) {
    if (memo.has(id)) return memo.get(id);
    const file = map.get(id);
    if (!file) return "";
    if (visiting.has(id)) return file.name ?? "";
    visiting.add(id);
    const parentPath = file.parentId ? resolve(file.parentId) : "";
    visiting.delete(id);
    const path = joinPath(parentPath, file.name);
    memo.set(id, path);
    return path;
  }

  for (const file of files) resolve(file.id);
  return memo;
}

export function sortFilesForTree(files) {
  return [...files].sort((a, b) => {
    const aFolder = a.mimeType === MIME_FOLDER;
    const bFolder = b.mimeType === MIME_FOLDER;
    if (aFolder !== bFolder) return aFolder ? -1 : 1;
    return String(a.name).localeCompare(String(b.name), "es", {
      sensitivity: "base",
      numeric: true
    });
  });
}

export function createUniqueName(existingFiles, parentId, requestedName, { markdown = false, preserveExtension = false } = {}) {
  const sanitized = sanitizeName(requestedName, { markdown });
  const names = new Set(
    existingFiles
      .filter(file => file.parentId === parentId && !file.trashed)
      .map(file => String(file.name).toLocaleLowerCase("es"))
  );
  if (!names.has(sanitized.toLocaleLowerCase("es"))) return sanitized;

  let extension = markdown ? ".md" : "";
  let stem = markdown ? basenameWithoutExtension(sanitized) : sanitized;
  if (!markdown && preserveExtension) {
    const dotIndex = sanitized.lastIndexOf(".");
    if (dotIndex > 0 && dotIndex < sanitized.length - 1) {
      stem = sanitized.slice(0, dotIndex);
      extension = sanitized.slice(dotIndex);
    }
  }
  let counter = 2;
  while (names.has(`${stem} ${counter}${extension}`.toLocaleLowerCase("es"))) counter += 1;
  return `${stem} ${counter}${extension}`;
}
