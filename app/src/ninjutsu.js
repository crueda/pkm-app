const AREA_FOLDER_NAME = "200 - AREA";
const NINJUTSU_FOLDER_NAME = "201 - NINJUTSU";
const TRAINING_FOLDER_NAME = "03 - Entrenamientos";

function normalize(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .replace(/[^a-z0-9ºª]+/g, " ")
    .trim();
}

function namedFolder(file, name) {
  return file?.kind === "folder" && !file.trashed && String(file.name).localeCompare(name, "es", { sensitivity: "base" }) === 0;
}

function childIds(files, ancestorId) {
  const childrenByParent = new Map();
  for (const file of files) {
    if (file.trashed) continue;
    const siblings = childrenByParent.get(file.parentId) ?? [];
    siblings.push(file);
    childrenByParent.set(file.parentId, siblings);
  }
  const descendants = new Set();
  const pending = [ancestorId];
  while (pending.length) {
    const parentId = pending.pop();
    for (const child of childrenByParent.get(parentId) ?? []) {
      if (descendants.has(child.id)) continue;
      descendants.add(child.id);
      if (child.kind === "folder") pending.push(child.id);
    }
  }
  return descendants;
}

export function findNinjutsuFolder(files = []) {
  const foldersById = new Map(files.filter(file => file.kind === "folder" && !file.trashed).map(file => [file.id, file]));
  return files
    .filter(file => namedFolder(file, NINJUTSU_FOLDER_NAME) && namedFolder(foldersById.get(file.parentId), AREA_FOLDER_NAME))
    .map(folder => {
      const descendants = childIds(files, folder.id);
      const noteCount = files.filter(file => file.kind === "note" && !file.trashed && descendants.has(file.id)).length;
      return { folder, noteCount };
    })
    .sort((a, b) => b.noteCount - a.noteCount || String(a.folder.path).localeCompare(String(b.folder.path), "es", { sensitivity: "base", numeric: true }))[0]?.folder ?? null;
}

export function findNinjutsuAreaFolder(files = []) {
  const foldersById = new Map(files.filter(file => file.kind === "folder" && !file.trashed).map(file => [file.id, file]));
  return files
    .filter(file => namedFolder(file, AREA_FOLDER_NAME))
    .sort((a, b) => {
      const aInsidePkm = namedFolder(foldersById.get(a.parentId), "PKM") ? 1 : 0;
      const bInsidePkm = namedFolder(foldersById.get(b.parentId), "PKM") ? 1 : 0;
      return bInsidePkm - aInsidePkm || String(a.path).localeCompare(String(b.path), "es", { sensitivity: "base", numeric: true });
    })[0] ?? null;
}

export function findNinjutsuTrainingFolder(files = [], ninjutsuFolder = findNinjutsuFolder(files)) {
  if (!ninjutsuFolder) return null;
  return files.find(file => namedFolder(file, TRAINING_FOLDER_NAME) && file.parentId === ninjutsuFolder.id) ?? null;
}

export function ninjutsuNotes(files = [], folder = findNinjutsuFolder(files)) {
  if (!folder) return [];
  const descendants = childIds(files, folder.id);
  return files
    .filter(file => file.kind === "note" && !file.trashed && descendants.has(file.id) && /\.md$/i.test(file.name))
    .sort((a, b) => String(a.path || a.name).localeCompare(String(b.path || b.name), "es", { sensitivity: "base", numeric: true }));
}

export function parseNinjutsuNote(file, folder) {
  const content = String(file?.content ?? "").replaceAll("\r\n", "\n");
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  const metadata = {};
  if (frontmatterMatch) {
    for (const line of frontmatterMatch[1].split("\n")) {
      const match = line.match(/^([\wáéíóúüñ-]+):\s*(.*?)\s*$/i);
      if (match) metadata[match[1].toLocaleLowerCase("es")] = match[2].replace(/^(["'])(.*)\1$/, "$2");
    }
  }
  const body = frontmatterMatch ? content.slice(frontmatterMatch[0].length) : content;
  const heading = body.match(/^#\s+(.+?)\s*$/m)?.[1]?.trim();
  const fallbackTitle = String(file?.name ?? "Sin título").replace(/\.md$/i, "");
  const folderPath = String(folder?.path || folder?.name || NINJUTSU_FOLDER_NAME).replace(/\\/g, "/");
  const relativePath = String(file?.path || file?.name || "").replace(/\\/g, "/").replace(`${folderPath}/`, "");
  const segments = relativePath.split("/").filter(Boolean);
  const rawCategory = segments.length > 1 ? segments[0] : "General";
  const category = rawCategory.replace(/^\d+\s*-\s*/, "").trim() || "General";
  const firstParagraph = body
    .split(/\n\s*\n/)
    .map(value => value.trim())
    .filter(value => value && !/^#{1,6}\s/.test(value) && !/^>/.test(value) && !/^[-*_]{3,}$/.test(value))
    .map(value => value
      .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
      .replace(/^[-*+]\s+/gm, "")
      .replace(/[*_`]/g, "")
      .trim())
    .find(Boolean) ?? "";
  return {
    title: heading || fallbackTitle,
    category,
    rawCategory,
    relativePath,
    metadata,
    body,
    summary: firstParagraph.replace(/\s+/g, " ").slice(0, 180)
  };
}

export function searchNinjutsuNotes(files = [], folder, query = "", category = "all") {
  const terms = normalize(query).split(" ").filter(Boolean);
  return ninjutsuNotes(files, folder)
    .map(file => ({ file, parsed: parseNinjutsuNote(file, folder) }))
    .filter(({ parsed }) => category === "all" || parsed.rawCategory === category)
    .filter(({ file, parsed }) => {
      const haystack = normalize([
        parsed.title,
        parsed.category,
        parsed.relativePath,
        parsed.body,
        Object.values(parsed.metadata).join(" "),
        file.name
      ].join(" "));
      return terms.every(term => haystack.includes(term));
    });
}

export function ninjutsuCategories(files = [], folder) {
  const counts = new Map();
  for (const file of ninjutsuNotes(files, folder)) {
    const parsed = parseNinjutsuNote(file, folder);
    const current = counts.get(parsed.rawCategory) ?? { id: parsed.rawCategory, label: parsed.category, count: 0 };
    current.count += 1;
    counts.set(parsed.rawCategory, current);
  }
  return [...counts.values()].sort((a, b) => a.id.localeCompare(b.id, "es", { sensitivity: "base", numeric: true }));
}

export function trainingNoteTemplate({ date = new Date().toISOString().slice(0, 10) } = {}) {
  return `---\ntipo: entrenamiento\narea: ninjutsu\nfecha: ${date}\nasistentes: \nnivel: kyu hasta 3er kyu\n---\n# Entrenamiento ${date}\n\n## Objetivos\n- \n\n## Material\n- \n\n## Plan de la sesión\n| Tiempo | Bloque | Contenido | Adaptaciones |\n| --- | --- | --- | --- |\n| 0-10 min | Apertura |  |  |\n| 10-25 min | Activación |  |  |\n| 25-45 min | Técnica 1 |  |  |\n| 45-65 min | Técnica 2 |  |  |\n| 65-80 min | Integración |  |  |\n| 80-90 min | Vuelta a la calma |  |  |\n\n## Observaciones\n- Lo que funcionó:\n- Dificultades:\n- Próxima sesión:\n`;
}

export const NINJUTSU_FOLDERS = Object.freeze({
  area: AREA_FOLDER_NAME,
  root: NINJUTSU_FOLDER_NAME,
  training: TRAINING_FOLDER_NAME
});
