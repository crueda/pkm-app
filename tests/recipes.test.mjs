import test from "node:test";
import assert from "node:assert/strict";
import { parseRecipe, recipeMatches, serializeRecipe } from "../app/src/recipes.js";

test("parsea y serializa una receta Markdown", () => {
  const recipe = parseRecipe("# Tortilla\n\n## Ingredientes\n- 3 huevos\n\n## Preparación\nBatir y cuajar.");
  assert.deepEqual(recipe, { title: "Tortilla", ingredients: "- 3 huevos", preparation: "Batir y cuajar." });
  assert.equal(serializeRecipe(recipe), "# Tortilla\n\n## Ingredientes\n- 3 huevos\n\n## Preparación\nBatir y cuajar.\n");
});

test("la búsqueda contempla todos los campos", () => {
  assert.equal(recipeMatches({ title: "Tacos", ingredients: "pollo", preparation: "Hornear" }, "pollo"), true);
  assert.equal(recipeMatches({ title: "Tacos", ingredients: "pollo", preparation: "Hornear" }, "sopa"), false);
});
