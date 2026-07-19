import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appDir = path.join(root, "app");
const distDir = path.join(root, "dist");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

const appName = process.env.APP_NAME?.trim() || "Notas Drive";
const vaultName = process.env.VAULT_NAME?.trim() || "NotesVault";
const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim() || "REPLACE_WITH_GOOGLE_OAUTH_CLIENT_ID";
const buildVersion = process.env.BUILD_VERSION?.trim() || `${packageJson.version}-${new Date().toISOString().replace(/[:.]/g, "-")}`;

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });
await cp(appDir, distDir, { recursive: true });

const configSource = `window.NOTES_APP_CONFIG = Object.freeze(${JSON.stringify({
  googleClientId,
  appName,
  vaultName,
  buildVersion,
  maxImportFiles: 2000
}, null, 2)});\n`;
await writeFile(path.join(distDir, "config.js"), configSource, "utf8");

const swPath = path.join(distDir, "sw.js");
const swSource = (await readFile(swPath, "utf8")).replaceAll("__BUILD_VERSION__", buildVersion);
await writeFile(swPath, swSource, "utf8");

const manifestPath = path.join(distDir, "manifest.webmanifest");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
manifest.name = appName;
manifest.short_name = appName.length <= 12 ? appName : "Notas";
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

const indexHtml = await readFile(path.join(distDir, "index.html"), "utf8");
await writeFile(path.join(distDir, "404.html"), indexHtml, "utf8");
await writeFile(path.join(distDir, ".nojekyll"), "", "utf8");

console.log(`Build creado en ${distDir}`);
console.log(`Versión: ${buildVersion}`);
console.log(`Google Client ID: ${googleClientId.includes("REPLACE_WITH") ? "sin configurar" : "configurado"}`);
