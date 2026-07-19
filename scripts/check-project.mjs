import { readdir, readFile, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

async function walk(directory) {
  const entries = await readdir(directory);
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry);
    const information = await stat(fullPath);
    if (information.isDirectory()) files.push(...await walk(fullPath));
    else files.push(fullPath);
  }
  return files;
}

async function read(relative) {
  return readFile(path.join(root, relative), "utf8");
}

function requirePattern(source, pattern, message) {
  if (!pattern.test(source)) failures.push(message);
}

for (const relative of ["package.json", "app/manifest.webmanifest"]) {
  try {
    JSON.parse(await read(relative));
  } catch (error) {
    failures.push(`${relative}: JSON inválido (${error.message})`);
  }
}

const javascriptFiles = (await walk(path.join(root, "app"))).filter(file => file.endsWith(".js"));
for (const file of javascriptFiles) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  const relative = path.relative(root, file);
  if (result.status !== 0) failures.push(`${relative}: ${result.stderr.trim()}`);
  const source = await readFile(file, "utf8");
  if (/\beval\s*\(|new\s+Function\s*\(/.test(source)) failures.push(`${relative}: uso de evaluación dinámica`);
  if (/(?:localStorage|sessionStorage)\.setItem\([^\n]*(?:token|access_token|refresh_token)/i.test(source)) {
    failures.push(`${relative}: intento de persistir un token en Web Storage`);
  }
  if (/(?:indexedDB|caches\.)[^\n]*(?:accessToken|access_token|refresh_token)/i.test(source)) {
    failures.push(`${relative}: posible persistencia de un token en almacenamiento local`);
  }
  if (/client_secret|refresh_token/i.test(source)) failures.push(`${relative}: contiene una referencia prohibida a secretos persistentes`);
  if (/\/permissions(?:[/?"'`]|$)|permissions\.create/i.test(source)) failures.push(`${relative}: intenta usar APIs de compartición de Drive`);
}

const html = await read("app/index.html");
requirePattern(html, /http-equiv="Content-Security-Policy"/i, "app/index.html: falta Content Security Policy");
requirePattern(html, /name="referrer" content="no-referrer"/i, "app/index.html: falta Referrer-Policy no-referrer");
if (/\son[a-z]+\s*=/i.test(html)) failures.push("app/index.html: contiene un manejador de eventos inline");
if (/\sstyle\s*=/i.test(html)) failures.push("app/index.html: contiene estilos inline incompatibles con la CSP");
if (/<script(?![^>]+src=)[^>]*>/i.test(html)) failures.push("app/index.html: contiene un script inline");

const canonicalSpecs = [
  "openspec/specs/authentication/spec.md",
  "openspec/specs/drive-vault/spec.md",
  "openspec/specs/notes-editor/spec.md",
  "openspec/specs/offline-search/spec.md",
  "openspec/specs/pwa-deployment/spec.md",
  "openspec/specs/security/spec.md"
];
const requiredOpenSpecFiles = [
  "openspec/config.yaml",
  ...canonicalSpecs,
  "openspec/changes/archive/2026-07-18-initial-google-drive-notes-pwa/.openspec.yaml",
  "openspec/changes/archive/2026-07-18-initial-google-drive-notes-pwa/proposal.md",
  "openspec/changes/archive/2026-07-18-initial-google-drive-notes-pwa/design.md",
  "openspec/changes/archive/2026-07-18-initial-google-drive-notes-pwa/tasks.md"
];
for (const relative of requiredOpenSpecFiles) {
  try {
    await stat(path.join(root, relative));
  } catch {
    failures.push(`${relative}: falta el archivo requerido`);
  }
}

for (const relative of canonicalSpecs) {
  let source = "";
  try {
    source = await read(relative);
  } catch {
    continue;
  }
  requirePattern(source, /^## Purpose\s*$/m, `${relative}: falta la sección exacta ## Purpose`);
  requirePattern(source, /^## Requirements\s*$/m, `${relative}: falta la sección exacta ## Requirements`);
  requirePattern(source, /^### Requirement: .+/m, `${relative}: no contiene requisitos OpenSpec`);
  requirePattern(source, /^#### Scenario: .+/m, `${relative}: no contiene escenarios OpenSpec`);
  requirePattern(source, /\bSHALL\b/, `${relative}: los requisitos no usan SHALL`);
  requirePattern(source, /^\s*- \*\*GIVEN\*\*/m, `${relative}: falta un paso GIVEN`);
  requirePattern(source, /^\s*- \*\*WHEN\*\*/m, `${relative}: falta un paso WHEN`);
  requirePattern(source, /^\s*- \*\*THEN\*\*/m, `${relative}: falta un paso THEN`);
}

const deltaSpecsRoot = path.join(root, "openspec/changes/archive/2026-07-18-initial-google-drive-notes-pwa/specs");
try {
  const deltaSpecs = (await walk(deltaSpecsRoot)).filter(file => file.endsWith("spec.md"));
  if (!deltaSpecs.length) failures.push("OpenSpec: el cambio inicial no contiene deltas de especificación");
  for (const file of deltaSpecs) {
    const source = await readFile(file, "utf8");
    const relative = path.relative(root, file);
    requirePattern(source, /^## (?:ADDED|MODIFIED|REMOVED) Requirements\s*$/m, `${relative}: falta una sección delta válida`);
    requirePattern(source, /^### Requirement: .+/m, `${relative}: no contiene requisitos delta`);
    requirePattern(source, /^#### Scenario: .+/m, `${relative}: no contiene escenarios delta`);
  }
} catch (error) {
  failures.push(`OpenSpec: no se pudieron validar los deltas (${error.message})`);
}

if (failures.length) {
  console.error("Comprobaciones fallidas:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`Comprobaciones estáticas superadas (${javascriptFiles.length} archivos JavaScript, ${canonicalSpecs.length} specs OpenSpec).`);
