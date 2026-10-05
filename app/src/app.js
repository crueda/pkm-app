import { GoogleOAuthClient, isGoogleClientIdConfigured } from "./auth.js";
import { LocalDatabase } from "./db.js";
import { AuthExpiredError, GoogleDriveApi } from "./drive-api.js";
import { formatMarkdown } from "./editor-format.js";
import { favoriteFiles, normalizeFavoriteIds, toggleFavoriteId } from "./favorites.js";
import { renderMarkdown } from "./markdown.js";
import { findNinjutsuAreaFolder, findNinjutsuFolder, findNinjutsuTrainingFolder, NINJUTSU_FOLDERS, ninjutsuCategories, ninjutsuNotes, parseNinjutsuNote, searchNinjutsuNotes, trainingNoteTemplate } from "./ninjutsu.js";
import { addedItems, createSessionEdit, currentOrNextSession, effectiveSession, findExportedSessionNote, findProgramSession, formatSessionDate, formatClock, isSessionEdited, itemsFromText, NINJUTSU_PROGRAM, parseMinutes, sessionTotalMinutes, timerElapsedMs, trainingTimerState, PROGRAM_EXPORT_FOLDER_NAME, sessionExportBaseName, sessionToMarkdown } from "./ninjutsu-planner.js";
import { findPkmFolder, findRecipeFolder, findRecipeResourcesFolder, parseRecipe, recipeMatches, serializeRecipe } from "./recipes.js";
import { initialCollapsedFolderIds, joinPath, noteDisplayName, sortFilesForTree } from "./path-utils.js";
import { DrivePublisher } from "./publisher.js";
import { createSnippet, searchNotes } from "./search.js";
import { SyncEngine } from "./sync-engine.js";
import { debounce, formatDateTime, formatRelativeTime, isImageFile } from "./utils.js";

const config = Object.freeze({
  googleClientId: window.NOTES_APP_CONFIG?.googleClientId ?? "",
  appName: window.NOTES_APP_CONFIG?.appName ?? "Notas Drive",
  vaultName: window.NOTES_APP_CONFIG?.vaultName ?? "NotesVault",
  buildVersion: window.NOTES_APP_CONFIG?.buildVersion ?? "development",
  maxImportFiles: Number(window.NOTES_APP_CONFIG?.maxImportFiles ?? 2000)
});

const elements = Object.fromEntries([
  "app-shell", "menu-button", "sidebar", "sidebar-scrim", "brand-name", "connect-button",
  "favorites-button", "favorites-drawer", "favorites-scrim", "favorites-close-button", "favorites-list", "apps-button", "apps-menu", "recipes-button", "ninjutsu-button",
  "welcome-connect-button", "sync-status-button", "sync-label", "sync-dot", "theme-button",
  "search-input", "new-note-button", "new-folder-button", "import-button", "import-input",
  "note-list", "list-heading", "list-count", "folder-actions", "selected-folder-label", "folder-favorite-button", "folder-publish-button", "folder-rename-button", "folder-move-button", "folder-delete-button", "last-sync-label", "settings-button",
  "welcome-view", "welcome-description", "configuration-warning", "install-help-button",
  "editor-view", "note-path", "note-title-input", "note-save-state", "note-modified",
  "note-sync-button", "note-sync-button-label",
  "publish-note-button", "publish-dialog", "publish-title", "publish-description", "publish-link",
  "publish-status", "publish-open-button", "publish-copy-button", "publish-action-button",
  "editor-panes", "markdown-editor", "markdown-preview", "attach-photo-button", "attach-photo-input",
  "favorite-note-button", "delete-note-button",
  "recipes-view", "recipes-path-label", "recipe-search-input", "recipe-list", "recipe-form", "recipe-title-input", "recipe-ingredients-input", "recipe-preparation-input", "new-recipe-button", "save-recipe-button", "delete-recipe-button", "recipe-save-state", "recipes-layout",
  "ninjutsu-view", "ninjutsu-path-label", "ninjutsu-search-input", "ninjutsu-stats", "ninjutsu-categories", "ninjutsu-result-list", "ninjutsu-result-count", "ninjutsu-detail", "ninjutsu-empty", "ninjutsu-document", "ninjutsu-document-category", "ninjutsu-document-title", "ninjutsu-document-path", "ninjutsu-document-content", "open-ninjutsu-note-button", "new-training-button",
  "ninjutsu-tab-program", "ninjutsu-tab-library", "ninjutsu-program-panel", "ninjutsu-library-panel", "program-today-button", "program-week-list",
  "program-session", "program-session-badges", "program-session-title", "program-session-meta", "program-edit-button", "program-reset-button", "program-export-button", "program-export-state", "program-session-body", "program-start-button", "program-start-label",
  "training-timer", "timer-session-label", "timer-total", "timer-minimize-button", "timer-step", "timer-part-name", "timer-clock", "timer-part-meta", "timer-segments", "timer-items", "timer-next",
  "timer-prev-button", "timer-pause-button", "timer-next-button", "timer-stop-button", "training-timer-pill", "training-timer-pill-label",
  "create-dialog", "create-form", "create-kind", "create-eyebrow", "create-title", "create-name", "create-parent",
  "delete-dialog", "delete-form", "delete-description", "settings-dialog", "install-dialog",
  "rename-folder-dialog", "rename-folder-form", "rename-folder-name",
  "move-dialog", "move-form", "move-description", "move-parent",
  "settings-auth-state", "settings-account", "settings-vault-name", "settings-pending-count", "settings-last-sync",
  "settings-sync-button", "disconnect-button", "clear-local-data-button", "settings-version",
  "settings-network", "settings-install-button", "toast-region"
].map(id => [id, document.getElementById(id)]));

const db = new LocalDatabase();
const auth = new GoogleOAuthClient(config.googleClientId);
const drive = new GoogleDriveApi(() => auth.getAccessToken());
const publisher = new DrivePublisher(drive);
const syncEngine = new SyncEngine({
  db,
  drive,
  vaultName: config.vaultName,
  maxImportFiles: config.maxImportFiles
});

const state = {
  files: [],
  rootId: null,
  selectedId: null,
  selectedFolderId: null,
  selectedDirectoryId: null,
  query: "",
  viewMode: "preview",
  collapsedFolders: new Set(),
  favoriteIds: new Set(),
  attachmentUrls: new Map(),
  authReady: false,
  connected: false,
  syncState: "local",
  refreshSequence: 0,
  installPrompt: null,
  renamingFolderId: null,
  movingFolderId: null,
  deletingItemId: null,
  publishingItemId: null,
  publicationUrl: "",
  recipeOpen: false,
  recipeQuery: "",
  selectedRecipeId: null,
  recipeFolderId: null,
  ninjutsuOpen: false,
  ninjutsuQuery: "",
  ninjutsuCategory: "all",
  selectedNinjutsuId: null,
  ninjutsuTab: "program",
  programFilter: "all",
  selectedSessionCode: null,
  programEditing: false,
  sessionEdits: {},
  sessionEditsLoaded: false,
  exportingSession: false,
  trainingTimer: null,
  timerVisible: false
};

function showToast(message, type = "info", duration = 4200) {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  elements["toast-region"].append(toast);
  setTimeout(() => toast.remove(), duration);
}

function currentNote() {
  return state.files.find(file => file.id === state.selectedId && file.kind === "note" && !file.trashed) ?? null;
}

function currentParentId() {
  const note = currentNote();
  return state.selectedFolderId || note?.parentId || state.rootId;
}

function setSidebarOpen(open) {
  elements["app-shell"].classList.toggle("sidebar-open", open);
  elements["menu-button"].setAttribute("aria-expanded", String(open));
}

function isFavorite(fileId) {
  return state.favoriteIds.has(fileId);
}

function createStarIcon(filled = false) {
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  if (filled) svg.classList.add("filled-star");
  const path = document.createElementNS(namespace, "path");
  path.setAttribute("d", "m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9Z");
  svg.append(path);
  return svg;
}

function setFavoritesOpen(open, { restoreFocus = true } = {}) {
  elements["app-shell"].classList.toggle("favorites-open", open);
  elements["favorites-button"].setAttribute("aria-expanded", String(open));
  elements["favorites-drawer"].setAttribute("aria-hidden", String(!open));
  elements["favorites-scrim"].tabIndex = open ? 0 : -1;
  if (open) {
    renderFavorites();
    requestAnimationFrame(() => {
      const target = elements["favorites-list"].querySelector("button") || elements["favorites-close-button"];
      target.focus({ preventScroll: true });
    });
  } else if (restoreFocus) {
    elements["favorites-button"].focus({ preventScroll: true });
  }
}

function updateFavoriteNoteButton() {
  const note = currentNote();
  const active = Boolean(note && isFavorite(note.id));
  const label = active ? "Quitar nota de favoritos" : "Añadir nota a favoritos";
  elements["favorite-note-button"].setAttribute("aria-pressed", String(active));
  elements["favorite-note-button"].setAttribute("aria-label", label);
  elements["favorite-note-button"].title = active ? "Quitar de favoritos" : "Añadir a favoritos";
  elements["favorite-note-button"].classList.toggle("active", active);
  elements["favorite-note-button"].replaceChildren(createStarIcon(active));
}

async function toggleFavorite(fileId) {
  const file = state.files.find(candidate => candidate.id === fileId && !candidate.trashed);
  if (!file || file.isRoot || !["folder", "note"].includes(file.kind)) return;
  const previousIds = [...state.favoriteIds];
  const nextIds = toggleFavoriteId(previousIds, fileId);
  state.favoriteIds = new Set(nextIds);
  renderSidebar();
  renderFavorites();
  if (state.recipeOpen) {
    elements["recipes-view"].hidden = false;
    elements["welcome-view"].hidden = true;
    elements["editor-view"].hidden = true;
    renderRecipes();
  }
  updateFavoriteNoteButton();
  try {
    await db.setSetting("favoriteIds", nextIds);
  } catch (error) {
    state.favoriteIds = new Set(previousIds);
    renderSidebar();
    renderFavorites();
    updateFavoriteNoteButton();
    showToast(error.message || "No se pudo guardar el favorito", "error");
  }
}

function createFavoriteToggleButton(file, className = "row-favorite-button") {
  const active = isFavorite(file.id);
  const button = document.createElement("button");
  button.type = "button";
  button.className = `${className} ${active ? "active" : ""}`;
  button.setAttribute("aria-label", active ? `Quitar ${file.name} de favoritos` : `Añadir ${file.name} a favoritos`);
  button.setAttribute("aria-pressed", String(active));
  button.title = active ? "Quitar de favoritos" : "Añadir a favoritos";
  button.append(createStarIcon(active));
  button.addEventListener("click", () => toggleFavorite(file.id));
  return button;
}

function revealFavoriteFolder(file) {
  state.query = "";
  elements["search-input"].value = "";
  state.selectedFolderId = file.id;
  state.selectedDirectoryId = file.id;
  let current = file;
  const fileMap = new Map(state.files.map(candidate => [candidate.id, candidate]));
  while (current && current.id !== state.rootId) {
    state.collapsedFolders.delete(current.id);
    current = fileMap.get(current.parentId);
  }
  renderSidebar();
  setFavoritesOpen(false, { restoreFocus: false });
  if (matchMedia("(max-width: 820px)").matches) setSidebarOpen(true);
  requestAnimationFrame(() => {
    const row = [...elements["note-list"].querySelectorAll("[data-file-id]")]
      .find(candidate => candidate.dataset.fileId === file.id);
    row?.scrollIntoView({ block: "nearest" });
    row?.focus({ preventScroll: true });
  });
}

function renderFavorites() {
  const container = elements["favorites-list"];
  container.replaceChildren();
  const files = favoriteFiles(state.files, [...state.favoriteIds]);
  if (!files.length) {
    const empty = document.createElement("div");
    empty.className = "favorites-empty";
    const star = document.createElement("span");
    star.className = "favorites-empty-icon";
    star.append(createStarIcon());
    const title = document.createElement("strong");
    title.textContent = "Aún no hay favoritos";
    const description = document.createElement("span");
    description.textContent = "Usa la estrella de una carpeta o nota para verla aquí.";
    empty.append(star, title, description);
    container.append(empty);
    return;
  }

  for (const file of files) {
    const item = document.createElement("div");
    item.className = "favorite-item";
    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "favorite-link";
    openButton.addEventListener("click", async () => {
      if (file.kind === "folder") revealFavoriteFolder(file);
      else {
        setFavoritesOpen(false, { restoreFocus: false });
        await selectNote(file.id);
      }
    });

    const kindIcon = document.createElement("span");
    kindIcon.className = "favorite-kind-icon";
    kindIcon.setAttribute("aria-hidden", "true");
    kindIcon.textContent = file.kind === "folder" ? "▸" : "·";
    const copy = document.createElement("span");
    copy.className = "favorite-copy";
    const name = document.createElement("strong");
    name.textContent = file.kind === "note" ? noteDisplayName(file) : file.name;
    const path = document.createElement("span");
    path.textContent = file.path || (file.kind === "folder" ? file.name : "");
    copy.append(name, path);
    openButton.append(kindIcon, copy);
    item.append(openButton, createFavoriteToggleButton(file, "favorite-remove-button"));
    container.append(item);
  }
}

function setSyncStatus({ state: nextState = "local", message = "Solo local", completedAt } = {}) {
  state.syncState = nextState;
  elements["sync-status-button"].dataset.state = nextState;
  elements["sync-label"].textContent = message;
  if (completedAt) elements["last-sync-label"].textContent = `Sincronizado ${formatRelativeTime(completedAt)}`;
  updateNoteSyncControl();
}

function noteSyncState(note) {
  if (!note) return "none";
  if (note.isLocalOnly || String(note.id).startsWith("local:")) return "local";
  return note.dirty ? "pending" : "synced";
}

function updateNoteSyncControl(note = currentNote()) {
  const syncState = noteSyncState(note);
  const syncing = state.syncState === "syncing";
  const labels = {
    local: "Solo en este dispositivo",
    pending: "Cambios pendientes de Drive",
    synced: "Guardada en Drive"
  };
  elements["note-save-state"].dataset.state = syncState;
  const transientLabels = ["Editando…", "Guardando localmente…", "Error al guardar"];
  if (note && !transientLabels.includes(elements["note-save-state"].textContent)) {
    elements["note-save-state"].textContent = labels[syncState];
  }

  const button = elements["note-sync-button"];
  const needsSync = ["local", "pending"].includes(syncState);
  button.dataset.state = syncing ? "syncing" : syncState;
  elements["note-sync-button-label"].textContent = syncing
    ? "Subiendo…"
    : syncState === "local"
      ? "Subir a Drive"
      : syncState === "pending"
        ? "Sincronizar"
        : "En Drive";
  button.disabled = !note || !needsSync || syncing || !navigator.onLine ||
    !isGoogleClientIdConfigured(config.googleClientId) || !state.authReady;
  button.setAttribute("aria-label", needsSync ? "Subir nota a Google Drive ahora" : "Nota sincronizada con Google Drive");
  button.title = !navigator.onLine
    ? "Conéctate a Internet para subir la nota"
    : needsSync && !auth.hasValidToken()
      ? "Conectar Google Drive y subir esta nota"
      : needsSync
        ? "Subir esta nota a Google Drive ahora"
        : "Esta nota ya está sincronizada con Google Drive";
}

function updateConnectButtons() {
  const configured = isGoogleClientIdConfigured(config.googleClientId);
  const label = state.connected ? "Sincronizar" : "Conectar";
  elements["connect-button"].textContent = label;
  elements["welcome-connect-button"].textContent = state.connected ? "Sincronizar ahora" : "Continuar con Google";
  elements["connect-button"].disabled = !configured || !state.authReady;
  elements["welcome-connect-button"].disabled = !configured || !state.authReady;
  elements["configuration-warning"].hidden = configured;
  elements["welcome-description"].textContent = configured
    ? "Conecta Google Drive para crear tu bóveda privada, o continúa leyendo las notas guardadas en este dispositivo."
    : "Configura el Client ID de Google para activar la sincronización. La aplicación local y la documentación ya están disponibles.";
  updateNoteSyncControl();
}

function applyTheme(mode) {
  const root = document.documentElement;
  const prefersDark = matchMedia("(prefers-color-scheme: dark)").matches;
  const resolved = mode === "system" ? (prefersDark ? "dark" : "light") : mode;
  root.dataset.theme = resolved;
  localStorage.setItem("notes-theme", mode);
  elements["theme-button"].title = `Tema: ${mode === "system" ? "sistema" : mode}`;
}

function cycleTheme() {
  const current = localStorage.getItem("notes-theme") || "system";
  const next = current === "system" ? "dark" : current === "dark" ? "light" : "system";
  applyTheme(next);
  showToast(`Tema: ${next === "system" ? "automático" : next}`);
}

function folderOptions() {
  return state.files
    .filter(file => file.kind === "folder" && !file.trashed)
    .sort((a, b) => (a.path || "").localeCompare(b.path || "", "es", { sensitivity: "base", numeric: true }));
}

function renderParentOptions(selectedParentId = currentParentId()) {
  elements["create-parent"].replaceChildren();
  for (const folder of folderOptions()) {
    const option = document.createElement("option");
    option.value = folder.id;
    option.textContent = folder.isRoot ? `/${config.vaultName}` : `/${folder.path}`;
    option.selected = folder.id === selectedParentId;
    elements["create-parent"].append(option);
  }
}

function createTreeIcon(file, expanded) {
  const icon = document.createElement("span");
  icon.className = "tree-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = file.kind === "folder" ? (expanded ? "▾" : "▸") : "·";
  return icon;
}

function renderTree() {
  const container = elements["note-list"];
  container.replaceChildren();
  const visible = state.files.filter(file => !file.trashed && !file.isRoot && ["folder", "note"].includes(file.kind));
  const children = new Map();
  for (const file of visible) {
    const group = children.get(file.parentId) ?? [];
    group.push(file);
    children.set(file.parentId, group);
  }
  for (const group of children.values()) {
    const sorted = sortFilesForTree(group);
    group.splice(0, group.length, ...sorted);
  }

  const appendChildren = (parentId, depth = 0) => {
    for (const file of children.get(parentId) ?? []) {
      const expanded = file.kind === "folder" && !state.collapsedFolders.has(file.id);
      const row = document.createElement("div");
      row.className = `tree-entry ${file.kind === "folder" ? "folder-entry" : "note-entry"} ${isFavorite(file.id) ? "favorite" : ""}`;
      const button = document.createElement("button");
      button.type = "button";
      button.className = `tree-row ${file.id === state.selectedId || file.id === state.selectedFolderId ? "selected" : ""} ${file.dirty ? "dirty" : ""}`;
      button.dataset.depth = String(Math.min(depth, 12));
      button.dataset.fileId = file.id;
      button.append(createTreeIcon(file, expanded));

      const label = document.createElement("span");
      label.className = "tree-label";
      label.textContent = file.kind === "note" ? noteDisplayName(file) : file.name;
      button.append(label);

      const meta = document.createElement("span");
      meta.className = "tree-meta";
      meta.dataset.state = noteSyncState(file);
      meta.title = noteSyncState(file) === "local"
        ? "Solo en este dispositivo"
        : file.dirty
          ? "Pendiente de sincronizar con Drive"
          : "Sincronizado con Drive";
      button.append(meta);

      button.addEventListener("click", async () => {
        if (file.kind === "folder") {
          state.selectedFolderId = file.id;
          state.selectedDirectoryId = file.id;
          if (state.collapsedFolders.has(file.id)) state.collapsedFolders.delete(file.id);
          else state.collapsedFolders.add(file.id);
          renderSidebar();
        } else {
          await selectNote(file.id);
        }
      });
      row.append(button);
      if (file.kind === "note") row.append(createFavoriteToggleButton(file));
      container.append(row);
      if (file.kind === "folder" && expanded) appendChildren(file.id, depth + 1);
    }
  };

  appendChildren(state.rootId, 0);
  if (!container.childElementCount) {
    const empty = document.createElement("div");
    empty.className = "empty-list";
    empty.textContent = "Todavía no hay notas. Crea la primera o importa una carpeta Markdown.";
    container.append(empty);
  }
  elements["list-heading"].textContent = "Notas";
  elements["list-count"].textContent = String(visible.filter(file => file.kind === "note").length);
}

function renderSearchResults() {
  const results = searchNotes(state.files, state.query, 100);
  const container = elements["note-list"];
  container.replaceChildren();
  for (const { file } of results) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `search-result ${file.id === state.selectedId ? "selected" : ""}`;
    button.addEventListener("click", () => selectNote(file.id));

    const title = document.createElement("div");
    title.className = "search-result-title";
    title.textContent = file.title || noteDisplayName(file);
    button.append(title);

    const path = document.createElement("div");
    path.className = "search-result-path";
    path.textContent = file.path || file.name;
    button.append(path);

    const snippet = document.createElement("div");
    snippet.className = "search-result-snippet";
    snippet.textContent = createSnippet(file.content, state.query);
    button.append(snippet);
    container.append(button);
  }
  if (!results.length) {
    const empty = document.createElement("div");
    empty.className = "empty-list";
    empty.textContent = "No hay notas que coincidan con la búsqueda.";
    container.append(empty);
  }
  elements["list-heading"].textContent = "Resultados";
  elements["list-count"].textContent = String(results.length);
}

function renderSidebar() {
  if (state.query.trim()) renderSearchResults();
  else renderTree();
  renderFolderActions();
}

function selectedFolder() {
  return state.files.find(file => file.id === state.selectedDirectoryId && file.kind === "folder" && !file.trashed && !file.isRoot) ?? null;
}

function renderFolderActions() {
  const folder = selectedFolder();
  const actions = elements["folder-actions"];
  actions.hidden = !folder;
  if (!folder) return;
  const active = isFavorite(folder.id);
  elements["selected-folder-label"].textContent = folder.name;
  elements["selected-folder-label"].title = folder.path || folder.name;
  elements["folder-favorite-button"].classList.toggle("active", active);
  elements["folder-favorite-button"].setAttribute("aria-label", active ? `Quitar ${folder.name} de favoritos` : `Añadir ${folder.name} a favoritos`);
  elements["folder-favorite-button"].setAttribute("aria-pressed", String(active));
  elements["folder-favorite-button"].replaceChildren(createStarIcon(active));
}

function normalizeMarkdownResourcePath(value = "") {
  const withoutFragment = String(value).split("#")[0].split("?")[0].trim();
  try {
    return decodeURIComponent(withoutFragment).replace(/^\.\/+/, "").replace(/^\/+/, "");
  } catch {
    return withoutFragment.replace(/^\.\/+/, "").replace(/^\/+/, "");
  }
}

function findAttachmentForMarkdownPath(rawPath) {
  const note = currentNote();
  if (!note) return null;
  const resourcePath = normalizeMarkdownResourcePath(rawPath);
  if (!resourcePath || /^[a-z][a-z0-9+.-]*:/i.test(resourcePath)) return null;

  const noteFolderPath = note.path?.split("/").slice(0, -1).join("/") || "";
  const targetPath = joinPath(noteFolderPath, resourcePath);
  return state.files.find(file => (
    file.kind === "attachment" &&
    !file.trashed &&
    isImageFile(file) &&
    (
      file.path === targetPath ||
      (!resourcePath.includes("/") && file.parentId === note.parentId && file.name === resourcePath)
    )
  )) ?? null;
}

function attachmentUrlKey(file) {
  return [file.id, file.remoteVersion, file.localUpdatedAt, file.size].filter(Boolean).join(":");
}

function resolveAttachmentImageUrl(rawPath) {
  const attachment = findAttachmentForMarkdownPath(rawPath);
  if (!attachment) return rawPath;
  if (!attachment.blob) return null;

  const cacheKey = attachmentUrlKey(attachment);
  const cached = state.attachmentUrls.get(attachment.id);
  if (cached?.cacheKey === cacheKey) return cached.url;
  if (cached) URL.revokeObjectURL(cached.url);

  const url = URL.createObjectURL(attachment.blob);
  state.attachmentUrls.set(attachment.id, { cacheKey, url });
  return url;
}

function pruneAttachmentUrls() {
  const liveIds = new Set(state.files.filter(file => file.kind === "attachment" && !file.trashed).map(file => file.id));
  for (const [id, cached] of state.attachmentUrls) {
    if (!liveIds.has(id)) {
      URL.revokeObjectURL(cached.url);
      state.attachmentUrls.delete(id);
    }
  }
}

function updatePreview(content) {
  elements["markdown-preview"].innerHTML = renderMarkdown(content, {
    resolveImageUrl: resolveAttachmentImageUrl
  });
}

function renderEditor({ preserveTextarea = false } = {}) {
  const note = currentNote();
  const areaOpen = state.recipeOpen || state.ninjutsuOpen;
  elements["welcome-view"].hidden = areaOpen || Boolean(note);
  elements["editor-view"].hidden = areaOpen || !note;
  elements["recipes-view"].hidden = !state.recipeOpen;
  elements["ninjutsu-view"].hidden = !state.ninjutsuOpen;
  if (!note) return;

  elements["note-title-input"].value = noteDisplayName(note);
  const parentPath = note.path?.split("/").slice(0, -1).join("/") || config.vaultName;
  elements["note-path"].textContent = parentPath;
  elements["note-save-state"].textContent = note.dirty ? "Cambios pendientes de Drive" : "Guardada en Drive";
  updateNoteSyncControl(note);
  elements["note-modified"].textContent = formatRelativeTime(note.localUpdatedAt || note.modifiedTime);

  const editor = elements["markdown-editor"];
  if (!preserveTextarea || editor.dataset.fileId !== note.id) {
    editor.value = note.content ?? "";
    editor.dataset.fileId = note.id;
  }
  updatePreview(editor.value);
  setViewMode(state.viewMode);
  updateFavoriteNoteButton();
}

async function updateSettings() {
  const [pending, lastSync, accountName, accountEmail] = await Promise.all([
    syncEngine.pendingCount(),
    db.getSetting("lastSyncAt", null),
    db.getSetting("googleAccountDisplayName", null),
    db.getSetting("googleAccountEmail", null)
  ]);
  elements["settings-auth-state"].textContent = state.connected ? "Conectado temporalmente" : "Desconectado";
  elements["settings-account"].textContent = accountEmail || accountName || "—";
  elements["settings-vault-name"].textContent = config.vaultName;
  elements["settings-pending-count"].textContent = String(pending);
  elements["settings-last-sync"].textContent = lastSync ? formatDateTime(lastSync) : "Nunca";
  elements["settings-version"].textContent = config.buildVersion;
  elements["settings-network"].textContent = navigator.onLine ? "En línea" : "Sin conexión";
  elements["last-sync-label"].textContent = lastSync ? `Sincronizado ${formatRelativeTime(lastSync)}` : "Sin sincronizar";
}

async function refreshLocalFiles({ preserveTextarea = false, selectRecent = false, collapseFolders = false } = {}) {
  const previousNote = currentNote();
  const editor = elements["markdown-editor"];
  const hasUnsavedEditorText = Boolean(
    previousNote &&
    editor.dataset.fileId === previousNote.id &&
    editor.value !== (previousNote.content ?? "")
  );
  const sequence = ++state.refreshSequence;
  const [files, rootId, lastSelectedId, favoriteIds] = await Promise.all([
    syncEngine.getLocalFiles(),
    syncEngine.getRootId(),
    db.getSetting("lastSelectedId", null),
    db.getSetting("favoriteIds", [])
  ]);
  if (sequence !== state.refreshSequence) return;
  state.files = files;
  state.rootId = rootId;
  if (collapseFolders) state.collapsedFolders = new Set(initialCollapsedFolderIds(files, rootId));
  state.favoriteIds = new Set(normalizeFavoriteIds(favoriteIds));
  pruneAttachmentUrls();

  const selectedExists = state.files.some(file => file.id === state.selectedId && file.kind === "note" && !file.trashed);
  if (!selectedExists) {
    const preferred = state.files.find(file => file.id === lastSelectedId && file.kind === "note" && !file.trashed);
    const recent = [...state.files]
      .filter(file => file.kind === "note" && !file.trashed)
      .sort((a, b) => new Date(b.localUpdatedAt || b.modifiedTime || 0) - new Date(a.localUpdatedAt || a.modifiedTime || 0))[0];
    state.selectedId = preferred?.id ?? (selectRecent ? recent?.id : null) ?? null;
  }
  if (!state.selectedFolderId || !state.files.some(file => file.id === state.selectedFolderId && file.kind === "folder" && !file.trashed)) {
    state.selectedFolderId = currentNote()?.parentId || rootId;
  }
  if (state.selectedDirectoryId && !state.files.some(file => file.id === state.selectedDirectoryId && file.kind === "folder" && !file.trashed && !file.isRoot)) {
    state.selectedDirectoryId = null;
  }
  renderSidebar();
  renderEditor({ preserveTextarea: preserveTextarea || hasUnsavedEditorText });
  renderFavorites();
  if (state.recipeOpen) renderRecipes();
  if (state.ninjutsuOpen) renderNinjutsu();
  await updateSettings();
}

async function selectNote(fileId, { mode = "preview" } = {}) {
  await saveCurrentNote.flush();
  state.recipeOpen = false;
  state.ninjutsuOpen = false;
  updateAppsButton();
  state.selectedId = fileId;
  state.viewMode = mode === "edit" ? "edit" : "preview";
  const note = currentNote();
  state.selectedFolderId = note?.parentId || state.rootId;
  state.selectedDirectoryId = null;
  await db.setSetting("lastSelectedId", fileId);
  renderSidebar();
  renderEditor();
  setFavoritesOpen(false, { restoreFocus: false });
  setSidebarOpen(false);
  if (state.viewMode === "edit") {
    requestAnimationFrame(() => elements["markdown-editor"].focus({ preventScroll: true }));
  }
}

function setViewMode(mode) {
  if (!["edit", "preview"].includes(mode)) mode = "preview";
  state.viewMode = mode;
  elements["editor-panes"].className = `editor-panes mode-${mode}`;
  elements["editor-view"].dataset.viewMode = mode;
  elements["note-title-input"].readOnly = mode !== "edit";
  elements["note-title-input"].setAttribute("aria-label", mode === "edit" ? "Título de la nota" : "Título de la nota (solo lectura)");
  for (const button of document.querySelectorAll(".view-mode-button")) {
    button.classList.toggle("active", button.dataset.viewMode === mode);
    button.setAttribute("aria-pressed", String(button.dataset.viewMode === mode));
  }
  if (mode === "preview") updatePreview(elements["markdown-editor"].value);
}

function applyMarkdownFormatting(action) {
  const editor = elements["markdown-editor"];
  const result = formatMarkdown(editor.value, editor.selectionStart, editor.selectionEnd, action);
  editor.value = result.value;
  editor.focus({ preventScroll: true });
  editor.setSelectionRange(result.selectionStart, result.selectionEnd);
  editor.dispatchEvent(new Event("input", { bubbles: true }));
}

const refreshPreview = debounce(() => updatePreview(elements["markdown-editor"].value), 160);

const saveCurrentNote = debounce(async () => {
  const note = currentNote();
  if (!note) return;
  const content = elements["markdown-editor"].value;
  if (content === note.content) return;
  elements["note-save-state"].textContent = "Guardando localmente…";
  try {
    const updated = await syncEngine.updateNote(note.id, content);
    state.files = state.files.map(file => file.id === updated.id ? updated : file);
    elements["note-save-state"].textContent = "Cambios pendientes de Drive";
    updateNoteSyncControl(updated);
    renderSidebar();
    requestSyncSoon();
    await updateSettings();
  } catch (error) {
    elements["note-save-state"].textContent = "Error al guardar";
    showToast(error.message || "No se pudo guardar la nota", "error");
  }
}, 650);

const requestSyncSoon = debounce(async () => {
  const pending = await syncEngine.pendingCount();
  if (!pending) return;
  if (!navigator.onLine) {
    setSyncStatus({ state: "offline", message: `${pending} ${pending === 1 ? "cambio pendiente" : "cambios pendientes"} · sin conexión` });
    return;
  }
  if (!auth.hasValidToken()) {
    state.connected = false;
    updateConnectButtons();
    setSyncStatus({ state: "auth", message: `${pending} ${pending === 1 ? "cambio pendiente" : "cambios pendientes"} · conecta Drive` });
    return;
  }
  try {
    await syncEngine.sync();
  } catch {
    // El motor ya actualiza el estado y conserva la cola local.
  }
}, 1600);

async function connectOrSync({ successMessage = "Google Drive está sincronizado" } = {}) {
  if (!isGoogleClientIdConfigured(config.googleClientId)) {
    showToast("Configura el Client ID de Google antes de conectar", "error");
    return;
  }
  elements["connect-button"].disabled = true;
  elements["welcome-connect-button"].disabled = true;
  try {
    if (!auth.hasValidToken()) await auth.requestAccessToken();
    state.connected = true;
    updateConnectButtons();
    await saveCurrentNote.flush();
    await syncEngine.sync();
    await refreshLocalFiles({ selectRecent: true });
    showToast(successMessage);
  } catch (error) {
    if (error?.code !== "popup_closed" && error?.code !== "popup_failed_to_open") {
      showToast(error.message || "No se pudo conectar con Google", "error");
    }
  } finally {
    updateConnectButtons();
  }
}

function openCreateDialog(kind) {
  if (!state.rootId) {
    showToast("Conecta Google Drive una vez para crear la bóveda", "error");
    return;
  }
  elements["create-kind"].value = kind;
  elements["create-eyebrow"].textContent = kind === "note" ? "Markdown" : "Organización";
  elements["create-title"].textContent = kind === "note" ? "Nueva nota" : "Nueva carpeta";
  elements["create-name"].value = "";
  elements["create-name"].placeholder = kind === "note" ? "Idea, diario, proyecto…" : "Nombre de la carpeta";
  renderParentOptions();
  elements["create-dialog"].showModal();
  requestAnimationFrame(() => elements["create-name"].focus());
}

async function submitCreate(event) {
  event.preventDefault();
  const kind = elements["create-kind"].value;
  const name = elements["create-name"].value.trim();
  const parentId = elements["create-parent"].value || state.rootId;
  if (!name) return;
  try {
    if (kind === "note") {
      const note = await syncEngine.createNote(parentId, name);
      elements["create-dialog"].close();
      await refreshLocalFiles();
      await selectNote(note.id);
    } else {
      const folder = await syncEngine.createFolder(parentId, name);
      state.selectedFolderId = folder.id;
      state.collapsedFolders.delete(folder.id);
      elements["create-dialog"].close();
      await refreshLocalFiles();
    }
    requestSyncSoon();
  } catch (error) {
    showToast(error.message || "No se pudo crear el elemento", "error");
  }
}

async function renameCurrentNote() {
  if (state.viewMode !== "edit") return;
  const note = currentNote();
  if (!note) return;
  const requested = elements["note-title-input"].value.trim();
  if (!requested || requested === noteDisplayName(note)) {
    elements["note-title-input"].value = noteDisplayName(note);
    return;
  }
  try {
    await saveCurrentNote.flush();
    await syncEngine.renameItem(note.id, requested);
    await refreshLocalFiles();
    requestSyncSoon();
  } catch (error) {
    elements["note-title-input"].value = noteDisplayName(note);
    showToast(error.message || "No se pudo renombrar", "error");
  }
}

function openRenameFolderDialog(fileId) {
  const folder = state.files.find(file => file.id === fileId && file.kind === "folder" && !file.trashed && !file.isRoot);
  if (!folder) return;
  state.renamingFolderId = folder.id;
  elements["rename-folder-name"].value = folder.name;
  elements["rename-folder-dialog"].showModal();
  requestAnimationFrame(() => {
    elements["rename-folder-name"].focus();
    elements["rename-folder-name"].select();
  });
}

async function submitRenameFolder(event) {
  event.preventDefault();
  const folder = state.files.find(file => file.id === state.renamingFolderId && file.kind === "folder" && !file.trashed);
  const requested = elements["rename-folder-name"].value.trim();
  if (!folder || !requested) return;
  if (requested === folder.name) {
    elements["rename-folder-dialog"].close();
    state.renamingFolderId = null;
    return;
  }
  try {
    const renamed = await syncEngine.renameItem(folder.id, requested);
    elements["rename-folder-dialog"].close();
    state.renamingFolderId = null;
    await refreshLocalFiles();
    requestSyncSoon();
    showToast(`Carpeta renombrada como “${renamed.name}”`);
  } catch (error) {
    showToast(error.message || "No se pudo renombrar la carpeta", "error");
  }
}

function moveDestinationOptions(folder) {
  const excludedIds = new Set([folder.id]);

  let changed = true;
  while (changed) {
    changed = false;
    for (const file of state.files) {
      if (file.kind === "folder" && excludedIds.has(file.parentId) && !excludedIds.has(file.id)) {
        excludedIds.add(file.id);
        changed = true;
      }
    }
  }
  return folderOptions().filter(candidate => !excludedIds.has(candidate.id) && candidate.id !== folder.parentId);
}

function openMoveFolderDialog(fileId) {
  const folder = state.files.find(file => file.id === fileId && file.kind === "folder" && !file.trashed && !file.isRoot);
  if (!folder) return;
  const destinations = moveDestinationOptions(folder);
  if (!destinations.length) {
    showToast("No hay otra carpeta disponible como destino", "error");
    return;
  }

  state.movingFolderId = folder.id;
  elements["move-description"].textContent = `“${folder.name}” y todo su contenido conservarán su estructura.`;
  elements["move-parent"].replaceChildren();
  for (const destination of destinations) {
    const option = document.createElement("option");
    option.value = destination.id;
    option.textContent = destination.isRoot ? `/${config.vaultName}` : `/${destination.path}`;
    option.selected = destination.id === state.selectedFolderId;
    elements["move-parent"].append(option);
  }
  elements["move-dialog"].showModal();
  requestAnimationFrame(() => elements["move-parent"].focus());
}

function expandFolderAncestors(folderId) {
  const fileMap = new Map(state.files.map(file => [file.id, file]));
  let current = fileMap.get(folderId);
  while (current) {
    state.collapsedFolders.delete(current.id);
    current = fileMap.get(current.parentId);
  }
}

async function syncCurrentNote() {
  await saveCurrentNote.flush();
  const note = currentNote();
  if (!note) return;
  if (noteSyncState(note) === "synced") {
    showToast("La nota ya está sincronizada con Google Drive");
    return;
  }
  await connectOrSync({ successMessage: `“${noteDisplayName(note)}” se ha subido a Google Drive` });
}

function publicationKey(item) {
  return `${item.kind}:${item.path || item.name}`;
}

function setPublicationUrl(url = "") {
  state.publicationUrl = url;
  elements["publish-link"].value = url;
  elements["publish-open-button"].disabled = !url;
  elements["publish-copy-button"].disabled = !url;
}

async function openPublishDialog(fileId = currentNote()?.id) {
  const item = state.files.find(file => file.id === fileId && !file.trashed && !file.isRoot && ["folder", "note"].includes(file.kind));
  if (!item) return;
  state.publishingItemId = item.id;
  elements["publish-title"].textContent = item.kind === "folder" ? `Publicar “${item.name}”` : `Publicar “${noteDisplayName(item)}”`;
  elements["publish-description"].textContent = item.kind === "folder"
    ? "La copia pública conservará sus subcarpetas, notas y adjuntos. Vuelve a publicar para actualizarla."
    : "La copia pública contendrá la versión más reciente de esta nota. Vuelve a publicar para actualizarla.";
  const links = await db.getSetting("publicationLinks", {});
  const url = links?.[publicationKey(item)] || "";
  setPublicationUrl(url);
  elements["publish-status"].textContent = url
    ? "Ya existe una publicación. Puedes abrirla, copiar el enlace o actualizarla."
    : "Aún no se ha publicado desde este dispositivo.";
  elements["publish-action-button"].textContent = url ? "Actualizar publicación" : "Publicar ahora";
  elements["publish-dialog"].showModal();
}

async function publishSelectedItem() {
  const initial = state.files.find(file => file.id === state.publishingItemId && !file.trashed);
  if (!initial) return;
  if (!navigator.onLine) {
    showToast("Necesitas conexión para publicar en Google Drive", "error");
    return;
  }
  if (!isGoogleClientIdConfigured(config.googleClientId)) {
    showToast("Configura el Client ID de Google antes de publicar", "error");
    return;
  }

  const signature = { kind: initial.kind, path: initial.path, name: initial.name };
  const button = elements["publish-action-button"];
  button.disabled = true;
  elements["publish-open-button"].disabled = true;
  elements["publish-copy-button"].disabled = true;
  elements["publish-status"].textContent = initial.kind === "folder" ? "Preparando y copiando la carpeta…" : "Preparando y copiando la nota…";
  try {
    if (!auth.hasValidToken()) await auth.requestAccessToken();
    state.connected = true;
    await saveCurrentNote.flush();
    await syncEngine.sync();
    await refreshLocalFiles({ preserveTextarea: true });
    const source = state.files.find(file => !file.trashed && file.kind === signature.kind && (
      (signature.path && file.path === signature.path) || (!signature.path && file.name === signature.name)
    ));
    if (!source || source.isLocalOnly || String(source.id).startsWith("local:")) {
      throw new Error("No se pudo preparar el elemento en Google Drive");
    }
    state.publishingItemId = source.id;
    const result = source.kind === "folder"
      ? await publisher.publishFolder(source, state.files)
      : await publisher.publishNote(source);
    const links = await db.getSetting("publicationLinks", {});
    links[publicationKey(source)] = result.url;
    await db.setSetting("publicationLinks", links);
    setPublicationUrl(result.url);
    elements["publish-status"].textContent = source.kind === "folder"
      ? `Publicación actualizada: ${result.publishedCount} archivos disponibles con el enlace.`
      : "Publicación actualizada y disponible para cualquiera que tenga el enlace.";
    elements["publish-action-button"].textContent = "Actualizar publicación";
    showToast("Publicación lista en Google Drive");
  } catch (error) {
    elements["publish-status"].textContent = error.message || "No se pudo crear la publicación.";
    showToast(error.message || "No se pudo publicar", "error");
  } finally {
    button.disabled = false;
    elements["publish-open-button"].disabled = !state.publicationUrl;
    elements["publish-copy-button"].disabled = !state.publicationUrl;
    updateConnectButtons();
  }
}

async function copyPublicationLink() {
  if (!state.publicationUrl) return;
  try {
    await navigator.clipboard.writeText(state.publicationUrl);
  } catch {
    elements["publish-link"].select();
    document.execCommand("copy");
  }
  showToast("Enlace copiado al portapapeles");
}

async function submitMoveFolder(event) {
  event.preventDefault();
  const fileId = state.movingFolderId;
  const parentId = elements["move-parent"].value;
  if (!fileId || !parentId) return;
  try {
    const folder = await syncEngine.moveFolder(fileId, parentId);
    state.selectedFolderId = folder.id;
    state.selectedDirectoryId = folder.id;
    expandFolderAncestors(parentId);
    elements["move-dialog"].close();
    state.movingFolderId = null;
    await refreshLocalFiles();
    requestSyncSoon();
    showToast("Carpeta movida con todo su contenido");
  } catch (error) {
    showToast(error.message || "No se pudo mover la carpeta", "error");
  }
}

function openDeleteDialog(fileId = currentNote()?.id) {
  const item = state.files.find(file => file.id === fileId && !file.trashed && !file.isRoot && ["folder", "note"].includes(file.kind));
  if (!item) return;
  state.deletingItemId = item.id;
  const name = item.kind === "note" ? noteDisplayName(item) : item.name;
  elements["delete-description"].textContent = item.kind === "folder"
    ? `“${name}” y todo su contenido se moverán a la papelera de Google Drive en la próxima sincronización.`
    : `“${name}” se moverá a la papelera de Google Drive en la próxima sincronización.`;
  elements["delete-dialog"].showModal();
}

async function confirmDelete(event) {
  event.preventDefault();
  const item = state.files.find(file => file.id === state.deletingItemId && !file.trashed && !file.isRoot);
  if (!item) return;
  const filesById = new Map(state.files.map(file => [file.id, file]));
  const belongsToItem = fileId => {
    let current = filesById.get(fileId);
    const visited = new Set();
    while (current && !visited.has(current.id)) {
      if (current.id === item.id) return true;
      visited.add(current.id);
      current = filesById.get(current.parentId);
    }
    return false;
  };
  const clearsSelectedNote = belongsToItem(state.selectedId);
  const clearsSelectedFolder = belongsToItem(state.selectedFolderId);
  try {
    if (clearsSelectedNote) await saveCurrentNote.flush();
    await syncEngine.trashItem(item.id);
    if (clearsSelectedNote) {
      state.selectedId = null;
      await db.deleteSetting("lastSelectedId");
    }
    if (clearsSelectedFolder) state.selectedFolderId = item.parentId || state.rootId;
    if (belongsToItem(state.selectedDirectoryId)) state.selectedDirectoryId = null;
    elements["delete-dialog"].close();
    state.deletingItemId = null;
    await refreshLocalFiles({ selectRecent: true });
    requestSyncSoon();
    showToast(`${item.kind === "folder" ? "Carpeta" : "Nota"} movida a la papelera`);
  } catch (error) {
    showToast(error.message || `No se pudo eliminar ${item.kind === "folder" ? "la carpeta" : "la nota"}`, "error");
  }
}

async function handleImport(fileList) {
  if (!fileList?.length) return;
  if (!state.rootId) {
    showToast("Conecta Google Drive una vez antes de importar", "error");
    return;
  }
  try {
    setSyncStatus({ state: "syncing", message: "Importando…" });
    const imported = await syncEngine.importMarkdownFiles(fileList, currentParentId());
    await refreshLocalFiles();
    showToast(`${imported.length} notas importadas`);
    requestSyncSoon.flush();
  } catch (error) {
    showToast(error.message || "No se pudo importar", "error");
  } finally {
    elements["import-input"].value = "";
    if (!state.connected) setSyncStatus({ state: navigator.onLine ? "local" : "offline", message: navigator.onLine ? "Pendiente de conectar" : "Sin conexión" });
  }
}

function markdownResourceUrl(name) {
  return encodeURI(name).replace(/[()]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function imageAltText(name) {
  return String(name).replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim() || "Foto";
}

function insertMarkdownAtCursor(markdown) {
  const editor = elements["markdown-editor"];
  const start = editor.selectionStart ?? editor.value.length;
  const end = editor.selectionEnd ?? start;
  const before = editor.value.slice(0, start);
  const after = editor.value.slice(end);
  const prefix = !before ? "" : before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const suffix = !after ? "\n" : after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
  const insertion = `${prefix}${markdown}${suffix}`;
  editor.value = `${before}${insertion}${after}`;
  const cursor = before.length + insertion.length;
  editor.setSelectionRange(cursor, cursor);
  editor.focus({ preventScroll: true });
}

async function handleAttachPhoto(file) {
  if (!file) return;
  const note = currentNote();
  if (!note) {
    showToast("Abre una nota antes de adjuntar una foto", "error");
    return;
  }
  if (!isImageFile(file)) {
    showToast("Selecciona un archivo de imagen", "error");
    return;
  }

  elements["attach-photo-button"].setAttribute("aria-disabled", "true");
  elements["note-save-state"].textContent = "Adjuntando foto…";
  try {
    await saveCurrentNote.flush();
    const attachment = await syncEngine.createImageAttachment(note.parentId, file, { relatedNoteId: note.id });
    insertMarkdownAtCursor(`![${imageAltText(attachment.name)}](${markdownResourceUrl(attachment.name)})`);
    updatePreview(elements["markdown-editor"].value);
    await saveCurrentNote.flush();
    await refreshLocalFiles({ preserveTextarea: true });
    updatePreview(elements["markdown-editor"].value);
    requestSyncSoon();
    showToast("Foto adjuntada a la nota");
  } catch (error) {
    elements["note-save-state"].textContent = "Error al adjuntar";
    showToast(error.message || "No se pudo adjuntar la foto", "error");
  } finally {
    elements["attach-photo-input"].value = "";
    elements["attach-photo-button"].setAttribute("aria-disabled", "false");
  }
}

function resolveWikiLink(rawTarget) {
  const target = String(rawTarget).split("#")[0].trim().replace(/\.md$/i, "");
  if (!target) return null;
  const folded = target.toLocaleLowerCase("es");
  const selectedParent = currentNote()?.parentId;
  const candidates = state.files.filter(file => file.kind === "note" && !file.trashed && (
    noteDisplayName(file).toLocaleLowerCase("es") === folded ||
    String(file.path || "").replace(/\.md$/i, "").toLocaleLowerCase("es") === folded
  ));
  return candidates.find(file => file.parentId === selectedParent) ?? candidates[0] ?? null;
}

async function clearLocalData() {
  const confirmed = window.confirm("Se borrarán la caché y los cambios todavía no sincronizados de este dispositivo. ¿Continuar?");
  if (!confirmed) return;
  await db.resetAll();
  state.files = [];
  state.rootId = null;
  state.selectedId = null;
  state.selectedFolderId = null;
  state.selectedDirectoryId = null;
  pruneAttachmentUrls();
  elements["settings-dialog"].close();
  await refreshLocalFiles();
  if (state.connected) {
    try {
      await syncEngine.sync();
      await refreshLocalFiles({ selectRecent: true });
    } catch {
      // Se mantiene vacía hasta reconectar.
    }
  }
  showToast("Caché local borrada");
}

function closeDialogFromButton(button) {
  const dialog = button.closest("dialog");
  if (dialog?.open) dialog.close();
}

function recipeFolder() {
  return findRecipeFolder(state.files);
}

function recipeFiles() {
  const folder = recipeFolder();
  return state.files
    .filter(file => file.kind === "note" && !file.trashed && folder && file.parentId === folder.id && /\.md$/i.test(file.name))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), "es", { sensitivity: "base", numeric: true }));
}

function renderRecipeForm() {
  const recipe = recipeFiles().find(file => file.id === state.selectedRecipeId) ?? null;
  const disabled = !recipe;
  for (const id of ["recipe-title-input", "recipe-ingredients-input", "recipe-preparation-input", "save-recipe-button", "delete-recipe-button"]) {
    elements[id].disabled = disabled;
  }
  if (!recipe) {
    elements["recipe-title-input"].value = "";
    elements["recipe-ingredients-input"].value = "";
    elements["recipe-preparation-input"].value = "";
    elements["recipe-save-state"].textContent = recipeFolder() ? "Selecciona una receta" : "No existe la carpeta de cocina";
    return;
  }
  const parsed = parseRecipe(recipe.content, noteDisplayName(recipe));
  elements["recipe-title-input"].value = parsed.title;
  elements["recipe-ingredients-input"].value = parsed.ingredients;
  elements["recipe-preparation-input"].value = parsed.preparation;
  elements["recipe-save-state"].textContent = recipe.dirty ? "Pendiente de sincronizar" : "Guardada en Drive";
  elements["recipe-save-state"].dataset.state = recipe.dirty ? "local" : "synced";
}

function renderRecipes() {
  if (!state.recipeOpen) return;
  const folder = recipeFolder();
  elements["recipes-path-label"].textContent = folder?.path || "300 - RECURSOS / 302 - COCINA";
  const files = recipeFiles().filter(file => recipeMatches(parseRecipe(file.content, noteDisplayName(file)), state.recipeQuery));
  const list = elements["recipe-list"];
  list.replaceChildren();
  for (const file of files) {
    const recipe = parseRecipe(file.content, noteDisplayName(file));
    const button = document.createElement("button");
    button.type = "button";
    button.className = `recipe-list-item ${file.id === state.selectedRecipeId ? "selected" : ""}`;
    button.innerHTML = `<strong></strong><span></span>`;
    button.querySelector("strong").textContent = recipe.title;
    button.querySelector("span").textContent = recipe.ingredients.split("\n").filter(Boolean).slice(0, 2).join(" · ") || "Sin ingredientes";
    button.addEventListener("click", () => { state.selectedRecipeId = file.id; renderRecipes(); renderRecipeForm(); });
    list.append(button);
  }
  if (!files.length) {
    const empty = document.createElement("div");
    empty.className = "empty-list";
    empty.textContent = recipeFolder() ? "No hay recetas que coincidan." : "Conecta y sincroniza para acceder a 300 - RECURSOS/302 - COCINA.";
    list.append(empty);
  }
  renderRecipeForm();
}

function setRecipeView(open) {
  state.recipeOpen = open;
  if (open) state.ninjutsuOpen = false;
  elements["recipes-view"].hidden = !open;
  elements["ninjutsu-view"].hidden = true;
  elements["welcome-view"].hidden = open || Boolean(currentNote());
  elements["editor-view"].hidden = open || !currentNote();
  updateAppsButton();
  if (!open) {
    renderEditor();
    return;
  }
  if (open) {
    const first = recipeFiles()[0];
    state.selectedRecipeId = state.selectedRecipeId && recipeFiles().some(file => file.id === state.selectedRecipeId) ? state.selectedRecipeId : first?.id ?? null;
    renderRecipes();
    requestAnimationFrame(() => elements["recipe-search-input"].focus());
  }
}

async function ensureRecipeFolder() {
  if (!state.rootId) throw new Error("Conecta Google Drive una vez antes de crear recetas");
  let folder = recipeFolder();
  if (folder) return folder;
  const resources = findRecipeResourcesFolder(state.files)
    ?? await syncEngine.createFolder(findPkmFolder(state.files)?.id || state.rootId, "300 - RECURSOS");
  await refreshLocalFiles();
  folder = recipeFolder() || state.files.find(file => file.kind === "folder" && !file.trashed && file.parentId === resources.id && file.name === "302 - COCINA");
  if (!folder) {
    await syncEngine.createFolder(resources.id, "302 - COCINA");
    await refreshLocalFiles();
    folder = recipeFolder();
  }
  return folder;
}

async function createRecipe() {
  try {
    const folder = await ensureRecipeFolder();
    const note = await syncEngine.createNote(folder.id, "Nueva receta", serializeRecipe({ title: "Nueva receta" }));
    await refreshLocalFiles();
    state.selectedRecipeId = note.id;
    renderRecipes();
    elements["recipe-title-input"].focus();
    elements["recipe-title-input"].select();
  } catch (error) { showToast(error.message || "No se pudo crear la receta", "error"); }
}

async function saveRecipe(event) {
  event.preventDefault();
  const recipe = recipeFiles().find(file => file.id === state.selectedRecipeId);
  if (!recipe) return;
  try {
    const title = elements["recipe-title-input"].value.trim();
    await syncEngine.updateNote(recipe.id, serializeRecipe({ title, ingredients: elements["recipe-ingredients-input"].value, preparation: elements["recipe-preparation-input"].value }));
    if (noteDisplayName(recipe) !== title) await syncEngine.renameItem(recipe.id, title);
    await refreshLocalFiles();
    showToast("Receta guardada");
  } catch (error) { showToast(error.message || "No se pudo guardar la receta", "error"); }
}

async function deleteRecipe() {
  const recipe = recipeFiles().find(file => file.id === state.selectedRecipeId);
  if (!recipe || !confirm(`¿Eliminar “${noteDisplayName(recipe)}”?`)) return;
  try { await syncEngine.trashItem(recipe.id); state.selectedRecipeId = null; await refreshLocalFiles(); renderRecipes(); showToast("Receta movida a la papelera"); }
  catch (error) { showToast(error.message || "No se pudo eliminar la receta", "error"); }
}

function ninjutsuFolder() {
  return findNinjutsuFolder(state.files);
}

function selectedNinjutsuNote() {
  return ninjutsuNotes(state.files, ninjutsuFolder()).find(file => file.id === state.selectedNinjutsuId) ?? null;
}

function createNinjutsuCategoryButton({ id, label, count }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `ninjutsu-category-button ${state.ninjutsuCategory === id ? "active" : ""}`;
  button.setAttribute("aria-pressed", String(state.ninjutsuCategory === id));
  button.innerHTML = `<strong></strong><span></span>`;
  button.querySelector("strong").textContent = label;
  button.querySelector("span").textContent = String(count);
  button.addEventListener("click", () => {
    state.ninjutsuCategory = id;
    state.selectedNinjutsuId = null;
    renderNinjutsu();
  });
  return button;
}

function renderNinjutsuStats(notes, categories) {
  const trainingCount = notes.filter(file => parseNinjutsuNote(file, ninjutsuFolder()).metadata.tipo === "entrenamiento").length;
  const values = [
    [String(notes.length), "notas en la biblioteca"],
    [String(categories.length), "secciones organizadas"],
    [String(trainingCount), "entrenamientos guardados"]
  ];
  elements["ninjutsu-stats"].replaceChildren(...values.map(([value, label]) => {
    const item = document.createElement("div");
    item.className = "ninjutsu-stat";
    const strong = document.createElement("strong");
    strong.textContent = value;
    const span = document.createElement("span");
    span.textContent = label;
    item.append(strong, span);
    return item;
  }));
}

function renderNinjutsuDetail(folder) {
  const note = selectedNinjutsuNote();
  elements["ninjutsu-empty"].hidden = Boolean(note);
  elements["ninjutsu-document"].hidden = !note;
  if (!note) return;
  const parsed = parseNinjutsuNote(note, folder);
  elements["ninjutsu-document-category"].textContent = parsed.category;
  elements["ninjutsu-document-title"].textContent = parsed.title;
  elements["ninjutsu-document-path"].textContent = parsed.relativePath;
  elements["ninjutsu-document-content"].innerHTML = renderMarkdown(parsed.body);
}

function renderNinjutsu() {
  if (!state.ninjutsuOpen) return;
  renderNinjutsuTabs();
  renderProgram();
  const folder = ninjutsuFolder();
  const notes = ninjutsuNotes(state.files, folder);
  const categories = ninjutsuCategories(state.files, folder);
  elements["ninjutsu-path-label"].textContent = folder?.path || `${NINJUTSU_FOLDERS.area} / ${NINJUTSU_FOLDERS.root}`;
  renderNinjutsuStats(notes, categories);

  const categoryNav = elements["ninjutsu-categories"];
  categoryNav.replaceChildren(createNinjutsuCategoryButton({ id: "all", label: "Todo", count: notes.length }));
  for (const category of categories) categoryNav.append(createNinjutsuCategoryButton(category));

  const results = searchNinjutsuNotes(state.files, folder, state.ninjutsuQuery, state.ninjutsuCategory);
  if (state.selectedNinjutsuId && !results.some(({ file }) => file.id === state.selectedNinjutsuId)) state.selectedNinjutsuId = null;
  if (!state.selectedNinjutsuId && results.length) state.selectedNinjutsuId = results[0].file.id;
  elements["ninjutsu-result-count"].textContent = String(results.length);
  const list = elements["ninjutsu-result-list"];
  list.replaceChildren();
  for (const { file, parsed } of results) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `ninjutsu-result ${file.id === state.selectedNinjutsuId ? "selected" : ""}`;
    button.innerHTML = `<strong></strong><small></small><p></p>`;
    button.querySelector("strong").textContent = parsed.title;
    button.querySelector("small").textContent = parsed.category;
    button.querySelector("p").textContent = parsed.summary || parsed.relativePath;
    button.addEventListener("click", () => {
      state.selectedNinjutsuId = file.id;
      renderNinjutsu();
    });
    list.append(button);
  }
  if (!results.length) {
    const empty = document.createElement("div");
    empty.className = "empty-list";
    empty.textContent = folder
      ? "No hay contenidos que coincidan con la búsqueda."
      : `Conecta y sincroniza para acceder a ${NINJUTSU_FOLDERS.area}/${NINJUTSU_FOLDERS.root}.`;
    list.append(empty);
  }
  renderNinjutsuDetail(folder);
}

function setNinjutsuView(open) {
  state.ninjutsuOpen = open;
  if (open) state.recipeOpen = false;
  elements["ninjutsu-view"].hidden = !open;
  elements["recipes-view"].hidden = true;
  elements["welcome-view"].hidden = open || Boolean(currentNote());
  elements["editor-view"].hidden = open || !currentNote();
  updateAppsButton();
  if (!open) {
    renderEditor();
    return;
  }
  const notes = ninjutsuNotes(state.files, ninjutsuFolder());
  state.selectedNinjutsuId = notes.some(file => file.id === state.selectedNinjutsuId) ? state.selectedNinjutsuId : notes[0]?.id ?? null;
  if (!state.selectedSessionCode) state.selectedSessionCode = currentOrNextSession()?.code ?? null;
  renderNinjutsu();
  loadSessionEdits().then(() => {
    renderProgram();
    if (state.ninjutsuTab === "program") scrollSelectedSessionIntoView();
  });
  if (state.ninjutsuTab === "library") requestAnimationFrame(() => elements["ninjutsu-search-input"].focus());
}

async function ensureNinjutsuTrainingFolder() {
  if (!state.rootId) throw new Error("Conecta Google Drive una vez antes de crear entrenamientos");
  let area = findNinjutsuAreaFolder(state.files);
  if (!area) {
    area = await syncEngine.createFolder(findPkmFolder(state.files)?.id || state.rootId, NINJUTSU_FOLDERS.area);
    await refreshLocalFiles();
    area = findNinjutsuAreaFolder(state.files) || area;
  }
  let root = ninjutsuFolder();
  if (!root) {
    root = await syncEngine.createFolder(area.id, NINJUTSU_FOLDERS.root);
    await refreshLocalFiles();
    root = ninjutsuFolder() || root;
  }
  let training = findNinjutsuTrainingFolder(state.files, root);
  if (!training) {
    training = await syncEngine.createFolder(root.id, NINJUTSU_FOLDERS.training);
    await refreshLocalFiles();
    training = findNinjutsuTrainingFolder(state.files, ninjutsuFolder()) || training;
  }
  return training;
}

async function createTraining() {
  try {
    const folder = await ensureNinjutsuTrainingFolder();
    const date = new Date().toLocaleDateString("sv-SE");
    const note = await syncEngine.createNote(folder.id, `${date} - Entrenamiento`, trainingNoteTemplate({ date }));
    await refreshLocalFiles();
    await selectNote(note.id, { mode: "edit" });
    requestSyncSoon();
  } catch (error) {
    showToast(error.message || "No se pudo crear el entrenamiento", "error");
  }
}

function updateAppsButton() {
  elements["apps-button"].classList.toggle("active", state.recipeOpen || state.ninjutsuOpen);
  elements["recipes-button"].classList.toggle("active", state.recipeOpen);
  elements["ninjutsu-button"].classList.toggle("active", state.ninjutsuOpen);
}

function setAppsMenuOpen(open, { restoreFocus = true } = {}) {
  elements["apps-menu"].hidden = !open;
  elements["apps-button"].setAttribute("aria-expanded", String(open));
  if (open) {
    updateAppsButton();
    requestAnimationFrame(() => {
      const items = [...elements["apps-menu"].querySelectorAll(".apps-menu-item")];
      (items.find(item => item.classList.contains("active")) || items[0])?.focus({ preventScroll: true });
    });
  } else if (restoreFocus) {
    elements["apps-button"].focus({ preventScroll: true });
  }
}

function handleAppsMenuKeydown(event) {
  const items = [...elements["apps-menu"].querySelectorAll(".apps-menu-item")];
  const index = items.indexOf(document.activeElement);
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const delta = event.key === "ArrowDown" ? 1 : -1;
    items[(index + delta + items.length) % items.length]?.focus();
  } else if (event.key === "Tab") {
    setAppsMenuOpen(false, { restoreFocus: false });
  }
}

function setNinjutsuTab(tab) {
  state.ninjutsuTab = tab === "library" ? "library" : "program";
  renderNinjutsu();
  if (state.ninjutsuTab === "library") requestAnimationFrame(() => elements["ninjutsu-search-input"].focus());
  else scrollSelectedSessionIntoView();
}

function renderNinjutsuTabs() {
  const program = state.ninjutsuTab === "program";
  elements["ninjutsu-program-panel"].hidden = !program;
  elements["ninjutsu-library-panel"].hidden = program;
  for (const [tab, active] of [[elements["ninjutsu-tab-program"], program], [elements["ninjutsu-tab-library"], !program]]) {
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  }
}

const SESSION_EDITS_KEY = `ninjutsuSessionEdits:${NINJUTSU_PROGRAM.id}`;

async function loadSessionEdits() {
  if (state.sessionEditsLoaded) return;
  try {
    const stored = await db.getSetting(SESSION_EDITS_KEY, {});
    state.sessionEdits = stored && typeof stored === "object" ? stored : {};
  } catch {
    state.sessionEdits = {};
  }
  state.sessionEditsLoaded = true;
}

const saveSessionEdits = debounce(async () => {
  try {
    await db.setSetting(SESSION_EDITS_KEY, state.sessionEdits);
  } catch (error) {
    showToast(error.message || "No se pudieron guardar los cambios de la sesión", "error");
  }
}, 400);

function selectedProgramSession() {
  return findProgramSession(state.selectedSessionCode) ?? currentOrNextSession();
}

function sessionExportFolder() {
  const root = ninjutsuFolder();
  const training = root ? findNinjutsuTrainingFolder(state.files, root) : null;
  if (!training) return null;
  return state.files.find(file => file.kind === "folder" && !file.trashed && file.parentId === training.id && file.name === PROGRAM_EXPORT_FOLDER_NAME) ?? null;
}

function exportedNoteFor(session, folder = sessionExportFolder()) {
  return findExportedSessionNote(state.files, folder, session, state.sessionEdits[session.code]);
}

function selectProgramSession(code) {
  if (state.programEditing) saveSessionEdits.flush();
  state.selectedSessionCode = code;
  state.programEditing = false;
  renderProgram();
}

function scrollSelectedSessionIntoView() {
  requestAnimationFrame(() => {
    elements["program-week-list"].querySelector(".program-session-item.selected")?.scrollIntoView({ block: "nearest" });
  });
}

function createChip(text, className) {
  const chip = document.createElement("span");
  chip.className = `program-chip ${className}`;
  chip.textContent = text;
  return chip;
}

function instructorChip(session, { long = false } = {}) {
  const label = long && session.provisional ? `${session.instructor} · provisional` : session.instructor;
  const chip = createChip(label, `instructor ${session.instructor === "Carlos" ? "carlos" : "julio"}${session.provisional ? " provisional" : ""}`);
  if (session.provisional) chip.title = "Reparto provisional: falta confirmar disponibilidad";
  return chip;
}

function renderProgramList() {
  const today = new Date().toLocaleDateString("sv-SE");
  const nextCode = currentOrNextSession(today)?.code;
  const folder = sessionExportFolder();
  for (const button of document.querySelectorAll("[data-program-filter]")) {
    const active = button.dataset.programFilter === state.programFilter;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  const list = elements["program-week-list"];
  list.replaceChildren();
  for (const trimester of NINJUTSU_PROGRAM.trimesters) {
    const group = document.createElement("section");
    group.className = "program-trimester";
    const heading = document.createElement("h3");
    heading.textContent = trimester.name;
    group.append(heading);
    for (const week of trimester.weeks) {
      const sessions = week.sessions.filter(session => state.programFilter === "all" || session.day === state.programFilter);
      if (!sessions.length) continue;
      const weekBlock = document.createElement("div");
      weekBlock.className = "program-week";
      const weekLabel = document.createElement("div");
      weekLabel.className = "program-week-label";
      weekLabel.textContent = `Semana ${week.week}`;
      weekBlock.append(weekLabel);
      for (const base of sessions) {
        const session = findProgramSession(base.code);
        const selected = session.code === state.selectedSessionCode;
        const button = document.createElement("button");
        button.type = "button";
        button.className = `program-session-item ${session.day}${selected ? " selected" : ""}${session.date < today ? " past" : ""}`;
        button.setAttribute("aria-current", String(selected));
        const top = document.createElement("span");
        top.className = "program-session-item-top";
        const code = document.createElement("strong");
        code.className = "program-code";
        code.textContent = session.code;
        const date = document.createElement("span");
        date.textContent = `${session.dayLabel.slice(0, 3)} ${formatSessionDate(session)}`;
        top.append(code, date);
        if (session.code === nextCode) top.append(createChip("Próxima", "next"));
        const title = document.createElement("span");
        title.className = "program-session-item-title";
        title.textContent = session.title;
        const flags = document.createElement("span");
        flags.className = "program-session-item-flags";
        flags.append(instructorChip(session));
        if (session.nonTeaching) flags.append(createChip("No lectivo", "warning"));
        if (isSessionEdited(session, state.sessionEdits[session.code])) flags.append(createChip("Editada", "edited"));
        if (exportedNoteFor(session, folder)) flags.append(createChip("En Drive", "exported"));
        button.append(top, title, flags);
        button.addEventListener("click", () => selectProgramSession(session.code));
        weekBlock.append(button);
      }
      group.append(weekBlock);
    }
    list.append(group);
  }
}

function renderSessionView(session, edit) {
  const effective = effectiveSession(session, edit);
  const body = document.createDocumentFragment();
  if (session.nonTeaching) {
    const alert = document.createElement("p");
    alert.className = "program-alert";
    alert.textContent = "Día no lectivo en la UVa: confirma si hay clase o traslada la sesión.";
    body.append(alert);
  }
  effective.parts.forEach((part, index) => {
    const section = document.createElement("section");
    section.className = "program-part";
    const heading = document.createElement("h3");
    const name = document.createElement("span");
    name.textContent = part.name;
    const minutes = document.createElement("span");
    minutes.className = "program-minutes";
    minutes.textContent = part.minutes ? `${part.minutes}′` : "";
    heading.append(name, minutes);
    const list = document.createElement("ul");
    const added = addedItems(session.parts[index], part.items);
    for (const item of part.items) {
      const li = document.createElement("li");
      li.textContent = item;
      if (added.has(item)) {
        li.classList.add("added");
        li.title = "Añadido por ti";
      }
      list.append(li);
    }
    if (!part.items.length) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = "Sin contenido";
      list.append(li);
    }
    section.append(heading, list);
    body.append(section);
  });
  if (effective.notes.trim()) {
    const notes = document.createElement("section");
    notes.className = "program-notes";
    const heading = document.createElement("h3");
    heading.textContent = "Mis notas";
    const content = document.createElement("div");
    content.className = "markdown-body";
    content.innerHTML = renderMarkdown(effective.notes);
    notes.append(heading, content);
    body.append(notes);
  }
  if (session.levels?.length) {
    const levels = document.createElement("dl");
    levels.className = "program-levels";
    for (const level of session.levels) {
      const row = document.createElement("div");
      const dt = document.createElement("dt");
      dt.textContent = level.grades;
      const dd = document.createElement("dd");
      dd.textContent = level.text;
      row.append(dt, dd);
      levels.append(row);
    }
    body.append(levels);
  }
  if (session.reviews?.length) {
    const reviews = document.createElement("div");
    reviews.className = "program-reviews";
    const title = document.createElement("p");
    title.textContent = "Repaso espaciado · último trabajo hace";
    const list = document.createElement("ul");
    for (const review of session.reviews) {
      const li = document.createElement("li");
      const topic = document.createElement("span");
      topic.textContent = review.topic;
      const gap = document.createElement("strong");
      gap.textContent = review.gap;
      li.append(topic, gap);
      list.append(li);
    }
    reviews.append(title, list);
    body.append(reviews);
  }
  if (session.note) {
    const note = document.createElement("p");
    note.className = "program-note";
    note.textContent = session.note;
    body.append(note);
  }
  return body;
}

function renderSessionEditor(session, edit) {
  const effective = effectiveSession(session, edit);
  const form = document.createDocumentFragment();
  const hint = document.createElement("p");
  hint.className = "program-edit-hint";
  hint.textContent = "Un elemento por línea; ajusta los minutos de cada bloque para el temporizador. Los cambios se guardan solos en este dispositivo; pulsa «Exportar a Drive» para dejar la sesión en tu carpeta.";
  form.append(hint);
  effective.parts.forEach((part, index) => {
    const id = `program-part-${index}`;
    const row = document.createElement("div");
    row.className = "program-part-label-row";
    const label = document.createElement("label");
    label.className = "field-label program-part-label";
    label.htmlFor = id;
    label.textContent = part.name;
    const minutesLabel = document.createElement("label");
    minutesLabel.className = "program-minutes-field";
    const minutesInput = document.createElement("input");
    minutesInput.type = "number";
    minutesInput.min = "0";
    minutesInput.max = "600";
    minutesInput.step = "1";
    minutesInput.inputMode = "numeric";
    minutesInput.value = String(part.minutes ?? 0);
    minutesInput.dataset.partMinutes = String(index);
    minutesInput.setAttribute("aria-label", `Minutos de ${part.name}`);
    minutesLabel.append(minutesInput, " min");
    row.append(label, minutesLabel);
    const textarea = document.createElement("textarea");
    textarea.id = id;
    textarea.className = "program-textarea";
    textarea.dataset.partIndex = String(index);
    textarea.rows = Math.max(2, part.items.length);
    textarea.value = part.items.join("\n");
    form.append(row, textarea);
  });
  const notesLabel = document.createElement("label");
  notesLabel.className = "field-label program-part-label";
  notesLabel.htmlFor = "program-notes-input";
  notesLabel.textContent = "Mis notas (asistentes, qué funcionó, pendientes…)";
  const notes = document.createElement("textarea");
  notes.id = "program-notes-input";
  notes.className = "program-textarea program-notes-input";
  notes.dataset.notes = "true";
  notes.rows = 5;
  notes.placeholder = "Admite Markdown";
  notes.value = effective.notes;
  form.append(notesLabel, notes);
  return form;
}

function autoSizeTextarea(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = `${textarea.scrollHeight + 2}px`;
}

function handleSessionEditInput(event) {
  const target = event.target;
  const minutesField = target instanceof HTMLInputElement && target.dataset.partMinutes !== undefined;
  if (!(target instanceof HTMLTextAreaElement) && !minutesField) return;
  if (!minutesField) autoSizeTextarea(target);
  const session = selectedProgramSession();
  if (!session) return;
  const edit = state.sessionEdits[session.code] ?? createSessionEdit(session);
  if (!edit.parts?.length) edit.parts = createSessionEdit(session).parts;
  if (minutesField) {
    const index = Number(target.dataset.partMinutes);
    if (edit.parts[index]) edit.parts[index].minutes = parseMinutes(target.value, edit.parts[index].minutes);
  } else if (target.dataset.notes) edit.notes = target.value;
  else {
    const index = Number(target.dataset.partIndex);
    if (edit.parts[index]) edit.parts[index].items = itemsFromText(target.value);
  }
  edit.updatedAt = new Date().toISOString();
  state.sessionEdits[session.code] = edit;
  saveSessionEdits();
  renderProgramHeader(session);
}

function renderProgramHeader(session) {
  const edit = state.sessionEdits[session.code];
  const edited = isSessionEdited(session, edit);
  const exported = exportedNoteFor(session);
  const badges = elements["program-session-badges"];
  badges.replaceChildren(createChip(session.code, `code ${session.day}`), instructorChip(session, { long: true }));
  if (session.done) badges.append(createChip("Impartida", "done"));
  if (edited) badges.append(createChip("Editada", "edited"));
  elements["program-session-title"].textContent = session.title;
  elements["program-session-meta"].textContent = `${formatSessionDate(session, { long: true })} · 21:00–22:30 · ${sessionTotalMinutes(effectiveSession(session, edit).parts)} min · ${session.trimesterName} · semana ${session.week}`;
  elements["program-edit-button"].textContent = state.programEditing ? "Hecho" : "Editar";
  elements["program-edit-button"].setAttribute("aria-pressed", String(state.programEditing));
  elements["program-reset-button"].hidden = !edited;
  const totalMinutes = sessionTotalMinutes(effectiveSession(session, edit).parts);
  elements["program-start-label"].textContent = state.trainingTimer?.sessionCode === session.code ? "Ver temporizador" : "Empezar";
  elements["program-start-button"].title = `Empezar el entrenamiento con temporizador (${totalMinutes} min)`;
  elements["program-export-button"].disabled = state.exportingSession;
  elements["program-export-button"].textContent = state.exportingSession ? "Exportando…" : exported ? "Actualizar en Drive" : "Exportar a Drive";
  const exportState = elements["program-export-state"];
  if (exported) {
    exportState.textContent = `${exported.dirty ? "Pendiente de subir a Drive" : "Guardada en Drive"} · ${exported.path || exported.name}`;
    exportState.dataset.state = exported.dirty ? "local" : "synced";
  } else {
    exportState.textContent = `Al exportar se guardará en ${NINJUTSU_FOLDERS.root} / ${NINJUTSU_FOLDERS.training} / ${PROGRAM_EXPORT_FOLDER_NAME}`;
    exportState.dataset.state = "none";
  }
}

function renderProgram() {
  if (!state.ninjutsuOpen || state.ninjutsuTab !== "program") return;
  const session = selectedProgramSession();
  if (!session) return;
  state.selectedSessionCode = session.code;
  renderProgramList();
  renderProgramHeader(session);
  const body = elements["program-session-body"];
  const mode = state.programEditing ? "edit" : "view";
  if (mode === "edit" && body.dataset.mode === "edit" && body.dataset.session === session.code) return;
  body.dataset.mode = mode;
  body.dataset.session = session.code;
  const edit = state.sessionEdits[session.code];
  body.replaceChildren(mode === "edit" ? renderSessionEditor(session, edit) : renderSessionView(session, edit));
  if (mode === "edit") requestAnimationFrame(() => body.querySelectorAll("textarea").forEach(autoSizeTextarea));
}

async function resetSelectedSession() {
  const session = selectedProgramSession();
  if (!session || !confirm(`¿Restaurar ${session.code} al contenido original de la programación? Se perderán tus añadidos.`)) return;
  const exportedFileId = state.sessionEdits[session.code]?.exportedFileId;
  if (exportedFileId) state.sessionEdits[session.code] = { ...createSessionEdit(session), exportedFileId };
  else delete state.sessionEdits[session.code];
  await saveSessionEdits.flush();
  state.programEditing = false;
  renderProgram();
  showToast("Sesión restaurada");
}

async function ensureProgramExportFolder() {
  const training = await ensureNinjutsuTrainingFolder();
  let folder = sessionExportFolder();
  if (!folder) {
    folder = await syncEngine.createFolder(training.id, PROGRAM_EXPORT_FOLDER_NAME);
    await refreshLocalFiles();
    folder = sessionExportFolder() || folder;
  }
  return folder;
}

async function exportSelectedSession() {
  const session = selectedProgramSession();
  if (!session || state.exportingSession) return;
  state.exportingSession = true;
  renderProgramHeader(session);
  try {
    await saveSessionEdits.flush();
    const folder = await ensureProgramExportFolder();
    const edit = state.sessionEdits[session.code] ?? createSessionEdit(session);
    const markdown = sessionToMarkdown(session, edit);
    const existing = findExportedSessionNote(state.files, folder, session, edit);
    let noteId = existing?.id;
    if (existing) await syncEngine.updateNote(existing.id, markdown);
    else noteId = (await syncEngine.createNote(folder.id, sessionExportBaseName(session), markdown)).id;
    state.sessionEdits[session.code] = { ...edit, exportedFileId: noteId, exportedAt: new Date().toISOString() };
    await saveSessionEdits.flush();
    await refreshLocalFiles();
    requestSyncSoon();
    showToast(state.connected ? `${session.code} exportada a Drive` : `${session.code} exportada; se subirá a Drive al conectar`);
  } catch (error) {
    showToast(error.message || "No se pudo exportar la sesión", "error");
  } finally {
    state.exportingSession = false;
    renderProgram();
  }
}

function bindEvents() {
  elements["menu-button"].addEventListener("click", () => setSidebarOpen(!elements["app-shell"].classList.contains("sidebar-open")));
  elements["sidebar-scrim"].addEventListener("click", () => setSidebarOpen(false));
  elements["favorites-button"].addEventListener("click", () => {
    const open = !elements["app-shell"].classList.contains("favorites-open");
    setFavoritesOpen(open);
  });
  elements["favorites-close-button"].addEventListener("click", () => setFavoritesOpen(false));
  elements["favorites-scrim"].addEventListener("click", () => setFavoritesOpen(false));
  elements["apps-button"].addEventListener("click", event => {
    event.stopPropagation();
    setAppsMenuOpen(elements["apps-menu"].hidden);
  });
  elements["apps-menu"].addEventListener("keydown", handleAppsMenuKeydown);
  document.addEventListener("click", event => {
    if (!elements["apps-menu"].hidden && !event.target.closest?.(".apps-menu-wrapper")) setAppsMenuOpen(false, { restoreFocus: false });
  });
  elements["recipes-button"].addEventListener("click", () => {
    setAppsMenuOpen(false, { restoreFocus: false });
    setFavoritesOpen(false, { restoreFocus: false });
    setRecipeView(true);
  });
  elements["ninjutsu-button"].addEventListener("click", () => {
    setAppsMenuOpen(false, { restoreFocus: false });
    setFavoritesOpen(false, { restoreFocus: false });
    setNinjutsuView(true);
  });
  elements["theme-button"].addEventListener("click", cycleTheme);
  elements["connect-button"].addEventListener("click", connectOrSync);
  elements["welcome-connect-button"].addEventListener("click", connectOrSync);
  elements["sync-status-button"].addEventListener("click", () => state.connected ? connectOrSync() : elements["settings-dialog"].showModal());
  elements["new-note-button"].addEventListener("click", () => openCreateDialog("note"));
  elements["new-folder-button"].addEventListener("click", () => openCreateDialog("folder"));
  elements["import-button"].addEventListener("click", () => elements["import-input"].click());
  elements["import-input"].addEventListener("change", event => handleImport(event.target.files));
  elements["attach-photo-button"].addEventListener("keydown", event => {
    if (!["Enter", " "].includes(event.key) || elements["attach-photo-button"].getAttribute("aria-disabled") === "true") return;
    event.preventDefault();
    elements["attach-photo-input"].click();
  });
  elements["attach-photo-input"].addEventListener("change", event => handleAttachPhoto(event.target.files?.[0]));
  elements["favorite-note-button"].addEventListener("click", () => {
    const note = currentNote();
    if (note) toggleFavorite(note.id);
  });
  elements["note-sync-button"].addEventListener("click", syncCurrentNote);
  elements["publish-note-button"].addEventListener("click", () => openPublishDialog());
  elements["publish-action-button"].addEventListener("click", publishSelectedItem);
  elements["publish-copy-button"].addEventListener("click", copyPublicationLink);
  elements["publish-open-button"].addEventListener("click", () => {
    if (state.publicationUrl) window.open(state.publicationUrl, "_blank", "noopener,noreferrer");
  });
  elements["create-form"].addEventListener("submit", submitCreate);
  elements["move-form"].addEventListener("submit", submitMoveFolder);
  elements["delete-note-button"].addEventListener("click", () => openDeleteDialog());
  elements["rename-folder-form"].addEventListener("submit", submitRenameFolder);
  elements["delete-form"].addEventListener("submit", confirmDelete);
  elements["folder-favorite-button"].addEventListener("click", () => {
    const folder = selectedFolder();
    if (folder) toggleFavorite(folder.id);
  });
  elements["folder-publish-button"].addEventListener("click", () => {
    const folder = selectedFolder();
    if (folder) openPublishDialog(folder.id);
  });
  elements["folder-rename-button"].addEventListener("click", () => {
    const folder = selectedFolder();
    if (folder) openRenameFolderDialog(folder.id);
  });
  elements["folder-move-button"].addEventListener("click", () => {
    const folder = selectedFolder();
    if (folder) openMoveFolderDialog(folder.id);
  });
  elements["folder-delete-button"].addEventListener("click", () => {
    const folder = selectedFolder();
    if (folder) openDeleteDialog(folder.id);
  });
  elements["new-recipe-button"].addEventListener("click", createRecipe);
  elements["recipe-form"].addEventListener("submit", saveRecipe);
  elements["delete-recipe-button"].addEventListener("click", deleteRecipe);
  elements["recipe-search-input"].addEventListener("input", event => { state.recipeQuery = event.target.value; renderRecipes(); });
  elements["ninjutsu-search-input"].addEventListener("input", event => { state.ninjutsuQuery = event.target.value; renderNinjutsu(); });
  elements["open-ninjutsu-note-button"].addEventListener("click", () => {
    const note = selectedNinjutsuNote();
    if (note) selectNote(note.id);
  });
  elements["new-training-button"].addEventListener("click", createTraining);
  for (const tab of [elements["ninjutsu-tab-program"], elements["ninjutsu-tab-library"]]) {
    tab.addEventListener("click", () => setNinjutsuTab(tab.dataset.ninjutsuTab));
  }
  for (const button of document.querySelectorAll("[data-program-filter]")) {
    button.addEventListener("click", () => {
      state.programFilter = button.dataset.programFilter;
      renderProgram();
    });
  }
  elements["program-today-button"].addEventListener("click", () => {
    const next = currentOrNextSession();
    if (!next) return;
    if (state.programFilter !== "all" && state.programFilter !== next.day) state.programFilter = "all";
    selectProgramSession(next.code);
    scrollSelectedSessionIntoView();
  });
  elements["program-edit-button"].addEventListener("click", () => {
    if (state.programEditing) saveSessionEdits.flush();
    state.programEditing = !state.programEditing;
    renderProgram();
    if (state.programEditing) requestAnimationFrame(() => elements["program-session-body"].querySelector("textarea")?.focus());
  });
  elements["program-reset-button"].addEventListener("click", resetSelectedSession);
  elements["program-export-button"].addEventListener("click", exportSelectedSession);
  elements["program-session-body"].addEventListener("input", handleSessionEditInput);
  elements["program-start-button"].addEventListener("click", startOrShowTrainingTimer);
  elements["timer-minimize-button"].addEventListener("click", () => setTimerVisible(false));
  elements["training-timer-pill"].addEventListener("click", () => setTimerVisible(true));
  elements["timer-pause-button"].addEventListener("click", toggleTimerPause);
  elements["timer-prev-button"].addEventListener("click", () => jumpTimerPart(-1));
  elements["timer-next-button"].addEventListener("click", () => jumpTimerPart(1));
  elements["timer-stop-button"].addEventListener("click", stopTrainingTimer);
  elements["timer-segments"].addEventListener("click", event => {
    const segment = event.target.closest("[data-segment]");
    if (segment) seekTimerToPart(Number(segment.dataset.segment));
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      if (state.timerVisible) requestWakeLock();
      renderTrainingTimer();
    }
  });

  elements["search-input"].addEventListener("input", event => {
    state.query = event.target.value;
    renderSidebar();
  });

  elements["markdown-editor"].addEventListener("input", () => {
    elements["note-save-state"].textContent = "Editando…";
    refreshPreview();
    saveCurrentNote();
  });
  elements["markdown-editor"].addEventListener("keydown", event => {
    const modifier = event.metaKey || event.ctrlKey;
    if (!modifier) return;
    const action = ({ b: "bold", i: "italic", k: "link" })[event.key.toLocaleLowerCase("es")];
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    applyMarkdownFormatting(action);
  });

  elements["note-title-input"].addEventListener("blur", renameCurrentNote);
  elements["note-title-input"].addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      elements["note-title-input"].blur();
    }
  });

  for (const button of document.querySelectorAll(".view-mode-button")) {
    button.addEventListener("click", async () => {
      const mode = button.dataset.viewMode;
      if (mode === "preview") await saveCurrentNote.flush();
      setViewMode(mode);
      if (mode === "edit") requestAnimationFrame(() => elements["markdown-editor"].focus({ preventScroll: true }));
    });
  }

  for (const button of document.querySelectorAll("[data-markdown-action]")) {
    button.addEventListener("mousedown", event => event.preventDefault());
    button.addEventListener("click", () => applyMarkdownFormatting(button.dataset.markdownAction));
  }

  elements["markdown-preview"].addEventListener("click", event => {
    const wiki = event.target.closest("[data-wiki-target]");
    if (!wiki) return;
    const note = resolveWikiLink(wiki.dataset.wikiTarget);
    if (note) selectNote(note.id);
    else showToast(`No se encontró “${wiki.dataset.wikiTarget}”`);
  });

  elements["settings-button"].addEventListener("click", async () => {
    await updateSettings();
    elements["settings-dialog"].showModal();
  });
  elements["settings-sync-button"].addEventListener("click", connectOrSync);
  elements["disconnect-button"].addEventListener("click", async () => {
    await auth.disconnect();
    state.connected = false;
    updateConnectButtons();
    setSyncStatus({ state: "local", message: "Solo local" });
    await updateSettings();
    showToast("Google Drive desconectado");
  });
  elements["clear-local-data-button"].addEventListener("click", clearLocalData);
  elements["settings-install-button"].addEventListener("click", () => elements["install-dialog"].showModal());
  elements["install-help-button"].addEventListener("click", async () => {
    if (state.installPrompt) {
      state.installPrompt.prompt();
      await state.installPrompt.userChoice;
      state.installPrompt = null;
    } else {
      elements["install-dialog"].showModal();
    }
  });

  for (const button of document.querySelectorAll("[data-close-dialog]")) {
    button.addEventListener("click", () => closeDialogFromButton(button));
  }

  addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    state.installPrompt = event;
  });

  addEventListener("online", () => {
    updateSettings();
    if (state.connected) requestSyncSoon();
    else setSyncStatus({ state: "local", message: "Solo local" });
  });
  addEventListener("offline", () => {
    updateSettings();
    setSyncStatus({ state: "offline", message: "Sin conexión" });
  });

  addEventListener("keydown", event => {
    const modifier = event.metaKey || event.ctrlKey;
    const editing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || event.target?.isContentEditable;
    if (state.ninjutsuOpen && state.ninjutsuTab === "library" && event.key === "/" && !editing) {
      event.preventDefault();
      elements["ninjutsu-search-input"].focus();
    }
    if (modifier && event.key.toLocaleLowerCase("es") === "k") {
      event.preventDefault();
      setSidebarOpen(true);
      elements["search-input"].focus();
    }
    if (modifier && event.key.toLocaleLowerCase("es") === "n") {
      event.preventDefault();
      openCreateDialog("note");
    }
    if (modifier && event.key.toLocaleLowerCase("es") === "s") {
      event.preventDefault();
      saveCurrentNote.flush().then(() => state.connected && connectOrSync());
    }
    if (state.timerVisible && !editing && event.key === " " && event.target === document.body) {
      event.preventDefault();
      toggleTimerPause();
    }
    if (event.key === "Escape") {
      if (state.timerVisible) setTimerVisible(false);
      else if (!elements["apps-menu"].hidden) setAppsMenuOpen(false);
      else if (elements["app-shell"].classList.contains("favorites-open")) setFavoritesOpen(false);
      else setSidebarOpen(false);
    }
  });

  auth.addEventListener("authchange", event => {
    state.connected = Boolean(event.detail.connected);
    updateConnectButtons();
    updateSettings();
  });

  syncEngine.addEventListener("status", event => setSyncStatus(event.detail));
  syncEngine.addEventListener("changed", async event => {
    const preserve =
      (event.detail.reason === "update-note" && event.detail.fileId === state.selectedId) ||
      (event.detail.reason === "create-attachment" && event.detail.noteId === state.selectedId);
    await refreshLocalFiles({ preserveTextarea: preserve });
  });
  syncEngine.addEventListener("authrequired", () => {
    auth.markExpired();
    state.connected = false;
    updateConnectButtons();
  });
  syncEngine.addEventListener("conflict", event => {
    showToast(`Se creó “${event.detail.conflictName}” para conservar tus cambios`, "error", 7000);
  });
  syncEngine.addEventListener("error", event => {
    showToast(event.detail.error?.message || "Error de sincronización", "error");
  });
  syncEngine.addEventListener("progress", event => {
    const detail = event.detail;
    if (detail.phase === "import") setSyncStatus({ state: "syncing", message: `Importando ${detail.current}/${detail.total}` });
    if (detail.phase === "upload") setSyncStatus({ state: "syncing", message: `Subiendo · ${detail.pending} pendientes` });
    if (detail.phase === "download") setSyncStatus({ state: "syncing", message: `Descargando ${detail.current}/${detail.total}` });
    if (detail.phase === "scan") setSyncStatus({ state: "syncing", message: "Preparando la primera sincronización…" });
    if (detail.phase === "changes") setSyncStatus({ state: "syncing", message: detail.total ? `Comprobando cambios ${detail.current}/${detail.total}` : "Comprobando cambios…" });
  });
}

const TRAINING_TIMER_KEY = "ninjutsuTrainingTimer";
let timerInterval = null;
let timerLastIndex = null;
let wakeLock = null;
let audioContext = null;

function timerSession() {
  const code = state.trainingTimer?.sessionCode;
  const session = code ? findProgramSession(code) : null;
  return session ? effectiveSession(session, state.sessionEdits[code]) : null;
}

function persistTrainingTimer() {
  db.setSetting(TRAINING_TIMER_KEY, state.trainingTimer).catch(() => {});
}

async function restoreTrainingTimer() {
  try {
    const stored = await db.getSetting(TRAINING_TIMER_KEY, null);
    if (!stored?.sessionCode || !Number.isFinite(stored.startedAt) || !findProgramSession(stored.sessionCode)) return;
    // Un temporizador olvidado de otro día no debe reaparecer.
    if (timerElapsedMs(stored) > 6 * 3600000) {
      await db.setSetting(TRAINING_TIMER_KEY, null);
      return;
    }
    state.trainingTimer = stored;
    await loadSessionEdits();
    startTimerTicking();
  } catch {
    state.trainingTimer = null;
  }
}

function startTimerTicking() {
  clearInterval(timerInterval);
  timerLastIndex = null;
  timerInterval = setInterval(renderTrainingTimer, 250);
  renderTrainingTimer();
}

async function requestWakeLock() {
  if (!("wakeLock" in navigator) || wakeLock || document.visibilityState !== "visible") return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => { wakeLock = null; });
  } catch {
    wakeLock = null;
  }
}

function releaseWakeLock() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

function playTimerChime(times = 2) {
  try {
    navigator.vibrate?.(times > 2 ? [300, 120, 300, 120, 600] : [250, 120, 250]);
    audioContext ??= new (window.AudioContext || window.webkitAudioContext)();
    const start = audioContext.currentTime;
    for (let index = 0; index < times; index += 1) {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.frequency.value = index === times - 1 ? 1046 : 784;
      gain.gain.setValueAtTime(0.0001, start + index * 0.28);
      gain.gain.exponentialRampToValueAtTime(0.35, start + index * 0.28 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + index * 0.28 + 0.24);
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start(start + index * 0.28);
      oscillator.stop(start + index * 0.28 + 0.26);
    }
  } catch {
    // El aviso sonoro es opcional.
  }
}

async function startOrShowTrainingTimer() {
  const session = selectedProgramSession();
  if (!session) return;
  if (state.programEditing) await saveSessionEdits.flush();
  const active = state.trainingTimer;
  if (active && active.sessionCode !== session.code) {
    if (!confirm(`Ya hay un entrenamiento en marcha (${active.sessionCode}). ¿Terminarlo y empezar ${session.code}?`)) return;
    state.trainingTimer = null;
  }
  if (!state.trainingTimer) {
    if (!sessionTotalMinutes(effectiveSession(session, state.sessionEdits[session.code]).parts)) {
      showToast("Esta sesión no tiene minutos asignados. Edítala para poner la duración de cada bloque.", "error");
      return;
    }
    state.trainingTimer = { sessionCode: session.code, startedAt: Date.now(), pausedMs: 0, pausedAt: null };
    persistTrainingTimer();
    // Desbloquea el audio con el gesto del usuario para que suenen los cambios de bloque.
    try {
      audioContext ??= new (window.AudioContext || window.webkitAudioContext)();
      audioContext.resume?.();
    } catch {}
    startTimerTicking();
  }
  setTimerVisible(true);
  renderProgramHeader(session);
}

function setTimerVisible(visible) {
  state.timerVisible = Boolean(visible && state.trainingTimer);
  elements["training-timer"].hidden = !state.timerVisible;
  document.body.classList.toggle("timer-open", state.timerVisible);
  if (state.timerVisible) {
    requestWakeLock();
    requestAnimationFrame(() => elements["timer-pause-button"].focus());
  } else releaseWakeLock();
  renderTrainingTimer();
}

function setTimerElapsed(elapsedMs) {
  const timer = state.trainingTimer;
  if (!timer) return;
  const reference = timer.pausedAt ?? Date.now();
  timer.startedAt = reference - (timer.pausedMs || 0) - Math.max(0, elapsedMs);
  timerLastIndex = null;
  persistTrainingTimer();
  renderTrainingTimer();
}

function seekTimerToPart(index) {
  const session = timerSession();
  if (!session) return;
  const parts = session.parts;
  const target = Math.max(0, Math.min(index, parts.length));
  setTimerElapsed(sessionTotalMinutes(parts.slice(0, target)) * 60000);
}

function jumpTimerPart(direction) {
  const session = timerSession();
  if (!session) return;
  const current = trainingTimerState(session.parts, timerElapsedMs(state.trainingTimer));
  // «Anterior» vuelve al inicio del bloque actual si ya lleva unos segundos.
  if (direction < 0 && !current.finished && current.partElapsedMs > 10000) seekTimerToPart(current.index);
  else seekTimerToPart(current.index + direction);
}

function toggleTimerPause() {
  const timer = state.trainingTimer;
  if (!timer) return;
  if (timer.pausedAt) {
    timer.pausedMs = (timer.pausedMs || 0) + (Date.now() - timer.pausedAt);
    timer.pausedAt = null;
  } else timer.pausedAt = Date.now();
  persistTrainingTimer();
  renderTrainingTimer();
}

function stopTrainingTimer() {
  const timer = state.trainingTimer;
  if (!timer) return;
  const session = timerSession();
  const status = session ? trainingTimerState(session.parts, timerElapsedMs(timer)) : null;
  if (status && !status.finished && !confirm("¿Terminar el entrenamiento ahora? El temporizador se detendrá.")) return;
  clearInterval(timerInterval);
  timerInterval = null;
  state.trainingTimer = null;
  persistTrainingTimer();
  setTimerVisible(false);
  if (session) {
    showToast(`${session.code} terminado en ${formatClock(status?.elapsedMs ?? 0)}. Puedes añadir tus notas y exportarla a Drive.`);
    if (status?.finished) {
      state.selectedSessionCode = session.code;
      state.programEditing = true;
    }
    if (state.ninjutsuOpen) renderProgram();
  }
}

function renderTimerSegments(parts, status) {
  const container = elements["timer-segments"];
  if (container.childElementCount !== parts.length || container.dataset.session !== state.trainingTimer.sessionCode) {
    container.dataset.session = state.trainingTimer.sessionCode;
    container.replaceChildren(...parts.map((part, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "timer-segment";
      button.dataset.segment = String(index);
      button.title = `Ir a ${part.name} (${part.minutes}′)`;
      const fill = document.createElement("span");
      fill.className = "timer-segment-fill";
      const label = document.createElement("span");
      label.className = "timer-segment-label";
      label.textContent = part.name;
      button.append(fill, label);
      return button;
    }));
  }
  let start = 0;
  parts.forEach((part, index) => {
    const duration = (Number(part.minutes) || 0) * 60000;
    const progress = duration ? Math.min(1, Math.max(0, (status.elapsedMs - start) / duration)) : 1;
    const button = container.children[index];
    button.style.flexGrow = String(Math.max(Number(part.minutes) || 0, 0.0001));
    button.classList.toggle("current", index === status.index);
    button.classList.toggle("done", index < status.index);
    button.setAttribute("aria-current", index === status.index ? "step" : "false");
    button.firstElementChild.style.width = `${progress * 100}%`;
    start += duration;
  });
}

function renderTrainingTimer() {
  const timer = state.trainingTimer;
  const session = timer ? timerSession() : null;
  const pill = elements["training-timer-pill"];
  if (!timer || !session) {
    pill.hidden = true;
    elements["training-timer"].hidden = true;
    return;
  }
  const status = trainingTimerState(session.parts, timerElapsedMs(timer));
  const paused = Boolean(timer.pausedAt);

  if (timerLastIndex !== null && status.index !== timerLastIndex && !paused) {
    playTimerChime(status.finished ? 3 : 2);
    if (status.finished) showToast("Tiempo de entrenamiento completado");
    else if (!state.timerVisible) showToast(`Ahora: ${status.part.name} (${status.part.minutes}′)`);
  }
  timerLastIndex = status.index;

  pill.hidden = state.timerVisible;
  pill.classList.toggle("paused", paused);
  pill.classList.toggle("finished", status.finished);
  elements["training-timer-pill-label"].textContent = status.finished
    ? `${session.code} · terminado · +${formatClock(status.overtimeMs)}`
    : `${session.code} · ${status.part.name} · ${formatClock(status.partRemainingMs)}${paused ? " · en pausa" : ""}`;

  if (!state.timerVisible) return;
  const view = elements["training-timer"];
  view.classList.toggle("paused", paused);
  view.classList.toggle("finished", status.finished);
  view.classList.toggle("ending", !status.finished && status.partRemainingMs <= 60000);
  elements["timer-session-label"].textContent = `${session.code} · ${session.title}`;
  elements["timer-total"].textContent = `Transcurrido ${formatClock(status.elapsedMs)} de ${formatClock(status.totalMs)}${status.finished ? "" : ` · quedan ${formatClock(status.remainingMs)}`}`;
  elements["timer-step"].textContent = status.finished ? "Fin del entrenamiento" : `Bloque ${status.index + 1} de ${session.parts.length}${paused ? " · en pausa" : ""}`;
  elements["timer-part-name"].textContent = status.finished ? "¡Entrenamiento completado!" : status.part.name;
  elements["timer-clock"].textContent = status.finished ? `+${formatClock(status.overtimeMs)}` : formatClock(status.partRemainingMs);
  elements["timer-part-meta"].textContent = status.finished
    ? "Tiempo extra sobre lo programado"
    : `quedan en este bloque · ${formatClock(status.partElapsedMs)} de ${status.part.minutes}′`;
  renderTimerSegments(session.parts, status);

  const items = elements["timer-items"];
  const itemsKey = `${session.code}:${status.index}:${status.part?.items.join("|") ?? ""}`;
  if (items.dataset.key !== itemsKey) {
    items.dataset.key = itemsKey;
    const source = status.finished ? ["Anota asistentes, qué ha funcionado y lo pendiente, y exporta la sesión a Drive."] : status.part.items;
    items.replaceChildren(...(source.length ? source : ["Sin contenido para este bloque"]).map(text => {
      const li = document.createElement("li");
      li.textContent = text;
      return li;
    }));
  }
  elements["timer-next"].textContent = status.finished ? "" : status.next ? `Después: ${status.next.name} (${status.next.minutes}′)` : "Último bloque";
  elements["timer-pause-button"].textContent = paused ? "Reanudar" : "Pausar";
  elements["timer-prev-button"].disabled = status.index === 0 && status.partElapsedMs <= 10000;
  elements["timer-next-button"].disabled = status.finished;
  elements["timer-stop-button"].textContent = status.finished ? "Cerrar y anotar" : "Terminar entrenamiento";
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
  try {
    const registration = await navigator.serviceWorker.register("./sw.js", { scope: "./" });
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      worker?.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
          showToast("Hay una versión nueva. Recarga para actualizar.");
        }
      });
    });
  } catch (error) {
    console.warn("No se pudo registrar el Service Worker", error);
  }
}

async function initialize() {
  document.title = config.appName;
  elements["brand-name"].textContent = config.appName;
  elements["settings-vault-name"].textContent = config.vaultName;
  applyTheme(localStorage.getItem("notes-theme") || "system");
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if ((localStorage.getItem("notes-theme") || "system") === "system") applyTheme("system");
  });
  bindEvents();
  await db.open();
  await refreshLocalFiles({ selectRecent: true, collapseFolders: true });
  await restoreTrainingTimer();
  if (location.hash === "#new-note") {
    history.replaceState(null, "", `${location.pathname}${location.search}`);
    queueMicrotask(() => openCreateDialog("note"));
  }
  updateConnectButtons();

  if (isGoogleClientIdConfigured(config.googleClientId)) {
    try {
      await auth.init();
      state.authReady = true;
    } catch (error) {
      showToast(error.message || "No se pudo preparar Google OAuth", "error");
    }
  }
  updateConnectButtons();
  setSyncStatus({
    state: navigator.onLine ? "local" : "offline",
    message: navigator.onLine ? (await syncEngine.pendingCount() ? "Cambios pendientes" : "Solo local") : "Sin conexión"
  });
  await registerServiceWorker();
}

initialize().catch(error => {
  console.error(error);
  showToast(error.message || "No se pudo iniciar la aplicación", "error", 9000);
});

window.addEventListener("unhandledrejection", event => {
  if (event.reason instanceof AuthExpiredError) return;
  console.error("Unhandled rejection", event.reason);
});
