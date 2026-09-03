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
  const titleLine = lines.find(line => /^#\s+/.test(line.trim()));
  const title = titleLine ? titleLine.trim().replace(/^#\s+/, "").trim() : fallbackTitle;
  const sections = { ingredients: [], preparation: [] };
  let active = null;
  for (const line of lines) {
    const heading = line.match(/^##\s+(.+?)\s*#*$/);
    if (heading) {
      active = sectionKey(heading[1]);
      continue;
    }
    if (active) sections[active].push(line);
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
