const SECTION_NAMES = {
  ingredients: ["ingredientes", "ingredients"],
  preparation: ["preparación", "preparacion", "elaboración", "elaboracion", "preparation"]
};

function sectionKey(value) {
  const normalized = String(value).trim().toLocaleLowerCase("es");
  return Object.entries(SECTION_NAMES).find(([, names]) => names.includes(normalized))?.[0] ?? null;
}

export function parseRecipe(content = "", fallbackTitle = "Sin título") {
  const lines = String(content).replaceAll("\r\n", "\n").split("\n");
  const titleIndex = lines.findIndex(line => /^#\s+/.test(line.trim()));
  const titleLine = titleIndex >= 0 ? lines[titleIndex] : null;
  const title = titleLine ? titleLine.trim().replace(/^#\s+/, "").trim() : fallbackTitle;
  const sections = { ingredients: [], preparation: [] };
  let active = null;
  let recognizedSections = 0;
  for (const line of lines) {
    const heading = line.match(/^##\s+(.+?)\s*#*$/);
    if (heading) {
      active = sectionKey(heading[1]);
      if (active) recognizedSections += 1;
      continue;
    }
    if (active) sections[active].push(line);
  }
  if (!recognizedSections) {
    sections.preparation = lines.filter((_line, index) => index !== titleIndex);
  }
  return {
    title,
    ingredients: sections.ingredients.join("\n").trim(),
    preparation: sections.preparation.join("\n").trim()
  };
}

export function serializeRecipe({ title = "Sin título", ingredients = "", preparation = "" } = {}) {
  return `# ${String(title).trim() || "Sin título"}\n\n## Ingredientes\n${String(ingredients).trim()}\n\n## Preparación\n${String(preparation).trim()}\n`;
}

export function recipeMatches(recipe, query) {
  const haystack = [recipe.title, recipe.ingredients, recipe.preparation].join(" ").toLocaleLowerCase("es");
  return !String(query).trim() || haystack.includes(String(query).trim().toLocaleLowerCase("es"));
}

function namedFolder(file, name) {
  return file?.kind === "folder" && !file.trashed && String(file.name).localeCompare(name, "es", { sensitivity: "base" }) === 0;
}

export function findRecipeFolder(files = []) {
  const foldersById = new Map(files.filter(file => file.kind === "folder" && !file.trashed).map(file => [file.id, file]));
  return files
    .filter(file => namedFolder(file, "302 - COCINA") && namedFolder(foldersById.get(file.parentId), "300 - RECURSOS"))
    .map(folder => ({
      folder,
      recipeCount: files.filter(file => file.kind === "note" && !file.trashed && file.parentId === folder.id && /\.md$/i.test(file.name)).length
    }))
    .sort((a, b) => b.recipeCount - a.recipeCount || String(a.folder.path).localeCompare(String(b.folder.path), "es", { sensitivity: "base", numeric: true }))[0]?.folder ?? null;
}

export function findRecipeResourcesFolder(files = []) {
  const foldersById = new Map(files.filter(file => file.kind === "folder" && !file.trashed).map(file => [file.id, file]));
  return files
    .filter(file => namedFolder(file, "300 - RECURSOS"))
    .sort((a, b) => {
      const aInsidePkm = namedFolder(foldersById.get(a.parentId), "PKM") ? 1 : 0;
      const bInsidePkm = namedFolder(foldersById.get(b.parentId), "PKM") ? 1 : 0;
      return bInsidePkm - aInsidePkm || String(a.path).localeCompare(String(b.path), "es", { sensitivity: "base", numeric: true });
    })[0] ?? null;
}

export function findPkmFolder(files = []) {
  return files
    .filter(file => namedFolder(file, "PKM"))
    .sort((a, b) => String(a.path).localeCompare(String(b.path), "es", { sensitivity: "base", numeric: true }))[0] ?? null;
}
