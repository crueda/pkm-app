import test from "node:test";
import assert from "node:assert/strict";
import { findPkmFolder, findRecipeFolder, findRecipeResourcesFolder, parseRecipe, recipeMatches, serializeRecipe } from "../app/src/recipes.js";

test("parsea y serializa una receta Markdown", () => {
  const recipe = parseRecipe("# Tortilla\n\n## Ingredientes\n- 3 huevos\n\n## Preparación\nBatir y cuajar.");
  assert.deepEqual(recipe, { title: "Tortilla", ingredients: "- 3 huevos", preparation: "Batir y cuajar." });
  assert.equal(serializeRecipe(recipe), "# Tortilla\n\n## Ingredientes\n- 3 huevos\n\n## Preparación\nBatir y cuajar.\n");
});

test("coloca en preparación el cuerpo de una receta antigua sin secciones", () => {
  const recipe = parseRecipe("# Bizcocho\n\nMezclar harina y huevos.\n\nHornear durante 35 minutos.");
  assert.deepEqual(recipe, {
    title: "Bizcocho",
    ingredients: "",
    preparation: "Mezclar harina y huevos.\n\nHornear durante 35 minutos."
  });
});

test("conserva todo el texto sin secciones cuando el título viene del archivo", () => {
  const recipe = parseRecipe("Mezclar todos los ingredientes.\nServir frío.", "Gazpacho");
  assert.deepEqual(recipe, {
    title: "Gazpacho",
    ingredients: "",
    preparation: "Mezclar todos los ingredientes.\nServir frío."
  });
});

test("la búsqueda contempla todos los campos", () => {
  assert.equal(recipeMatches({ title: "Tacos", ingredients: "pollo", preparation: "Hornear" }, "pollo"), true);
  assert.equal(recipeMatches({ title: "Tacos", ingredients: "pollo", preparation: "Hornear" }, "sopa"), false);
});

test("encuentra la carpeta de recetas aunque esté dentro de PKM", () => {
  const files = [
    { id: "pkm", kind: "folder", name: "PKM", path: "PKM" },
    { id: "resources", kind: "folder", name: "300 - RECURSOS", parentId: "pkm", path: "PKM/300 - RECURSOS" },
    { id: "cooking", kind: "folder", name: "302 - COCINA", parentId: "resources", path: "PKM/300 - RECURSOS/302 - COCINA" },
    { id: "recipe", kind: "note", name: "Tortilla.md", parentId: "cooking", path: "PKM/300 - RECURSOS/302 - COCINA/Tortilla.md" }
  ];
  assert.equal(findRecipeFolder(files)?.id, "cooking");
  assert.equal(findRecipeResourcesFolder(files)?.id, "resources");
  assert.equal(findPkmFolder(files)?.id, "pkm");
});

test("prefiere la carpeta de cocina que ya contiene recetas", () => {
  const files = [
    { id: "resources-root", kind: "folder", name: "300 - RECURSOS", path: "300 - RECURSOS" },
    { id: "cooking-empty", kind: "folder", name: "302 - COCINA", parentId: "resources-root", path: "300 - RECURSOS/302 - COCINA" },
    { id: "pkm", kind: "folder", name: "PKM", path: "PKM" },
    { id: "resources-pkm", kind: "folder", name: "300 - RECURSOS", parentId: "pkm", path: "PKM/300 - RECURSOS" },
    { id: "cooking-real", kind: "folder", name: "302 - COCINA", parentId: "resources-pkm", path: "PKM/300 - RECURSOS/302 - COCINA" },
    { id: "recipe", kind: "note", name: "Sopa.md", parentId: "cooking-real" }
  ];
  assert.equal(findRecipeFolder(files)?.id, "cooking-real");
  assert.equal(findRecipeResourcesFolder(files)?.id, "resources-pkm");
});
