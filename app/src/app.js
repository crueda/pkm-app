import { GoogleOAuthClient, isGoogleClientIdConfigured } from "./auth.js";
import { LocalDatabase } from "./db.js";
import { AuthExpiredError, GoogleDriveApi } from "./drive-api.js";
import { formatMarkdown } from "./editor-format.js";
import { favoriteFiles, normalizeFavoriteIds, toggleFavoriteId } from "./favorites.js";
import { renderMarkdown } from "./markdown.js";
import { joinPath, noteDisplayName, sortFilesForTree } from "./path-utils.js";
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
  "favorites-button", "favorites-drawer", "favorites-scrim", "favorites-close-button", "favorites-list",
  "welcome-connect-button", "sync-status-button", "sync-label", "sync-dot", "theme-button",
  "search-input", "new-note-button", "new-folder-button", "import-button", "import-input",
  "note-list", "list-heading", "list-count", "last-sync-label", "settings-button",
  "welcome-view", "welcome-description", "configuration-warning", "install-help-button",
  "editor-view", "note-path", "note-title-input", "note-save-state", "note-modified",
  "note-sync-button", "note-sync-button-label",
  "editor-panes", "markdown-editor", "markdown-preview", "attach-photo-button", "attach-photo-input",
  "favorite-note-button", "delete-note-button",
  "create-dialog", "create-form", "create-kind", "create-eyebrow", "create-title", "create-name", "create-parent",
  "delete-dialog", "delete-form", "delete-description", "settings-dialog", "install-dialog",
  "move-dialog", "move-form", "move-description", "move-parent",
  "settings-auth-state", "settings-account", "settings-vault-name", "settings-pending-count", "settings-last-sync",
  "settings-sync-button", "disconnect-button", "clear-local-data-button", "settings-version",
  "settings-network", "settings-install-button", "toast-region"
].map(id => [id, document.getElementById(id)]));

const db = new LocalDatabase();
const auth = new GoogleOAuthClient(config.googleClientId);
const drive = new GoogleDriveApi(() => auth.getAccessToken());
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
  movingFolderId: null,
  deletingItemId: null
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

function createMoveFolderButton(file) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "row-move-button";
  button.setAttribute("aria-label", `Mover carpeta ${file.name}`);
  button.title = "Mover carpeta";
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M4 6.5h6l2 2h8v9H4Z M9 13h7m-3-3 3 3-3 3");
  icon.append(path);
  button.append(icon);
  button.addEventListener("click", () => openMoveFolderDialog(file.id));
  return button;
}

function createDeleteFolderButton(file) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "row-delete-button";
  button.setAttribute("aria-label", `Eliminar carpeta ${file.name}`);
  button.title = "Mover carpeta a la papelera";
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M5 7h14m-9-3h4l1 3H9Zm-3 3 1 13h8l1-13M10 10v7m4-7v7");
  icon.append(path);
  button.append(icon);
  button.addEventListener("click", () => openDeleteDialog(file.id));
  return button;
}

function revealFavoriteFolder(file) {
  state.query = "";
  elements["search-input"].value = "";
  state.selectedFolderId = file.id;
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
      row.className = `tree-entry ${file.kind === "folder" ? "folder-entry" : ""} ${isFavorite(file.id) ? "favorite" : ""}`;
      const button = document.createElement("button");
      button.type = "button";
      button.className = `tree-row ${file.id === state.selectedId ? "selected" : ""} ${file.dirty ? "dirty" : ""}`;
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
          if (state.collapsedFolders.has(file.id)) state.collapsedFolders.delete(file.id);
          else state.collapsedFolders.add(file.id);
          renderSidebar();
        } else {
          await selectNote(file.id);
        }
      });
      row.append(button);
      if (file.kind === "folder") row.append(createMoveFolderButton(file), createDeleteFolderButton(file));
      row.append(createFavoriteToggleButton(file));
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
  elements["welcome-view"].hidden = Boolean(note);
  elements["editor-view"].hidden = !note;
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

async function refreshLocalFiles({ preserveTextarea = false, selectRecent = false } = {}) {
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
  renderSidebar();
  renderEditor({ preserveTextarea });
  renderFavorites();
  await updateSettings();
}

async function selectNote(fileId, { mode = "preview" } = {}) {
  await saveCurrentNote.flush();
  state.selectedId = fileId;
  state.viewMode = mode === "edit" ? "edit" : "preview";
  const note = currentNote();
  state.selectedFolderId = note?.parentId || state.rootId;
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
      const note = await syncEngine.createNote(parentId, name, `# ${name.replace(/\.md$/i, "")}\n\n`);
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

async function submitMoveFolder(event) {
  event.preventDefault();
  const fileId = state.movingFolderId;
  const parentId = elements["move-parent"].value;
  if (!fileId || !parentId) return;
  try {
    const folder = await syncEngine.moveFolder(fileId, parentId);
    state.selectedFolderId = folder.id;
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

function bindEvents() {
  elements["menu-button"].addEventListener("click", () => setSidebarOpen(!elements["app-shell"].classList.contains("sidebar-open")));
  elements["sidebar-scrim"].addEventListener("click", () => setSidebarOpen(false));
  elements["favorites-button"].addEventListener("click", () => {
    const open = !elements["app-shell"].classList.contains("favorites-open");
    setFavoritesOpen(open);
  });
  elements["favorites-close-button"].addEventListener("click", () => setFavoritesOpen(false));
  elements["favorites-scrim"].addEventListener("click", () => setFavoritesOpen(false));
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
  elements["create-form"].addEventListener("submit", submitCreate);
  elements["move-form"].addEventListener("submit", submitMoveFolder);
  elements["delete-note-button"].addEventListener("click", () => openDeleteDialog());
  elements["delete-form"].addEventListener("submit", confirmDelete);

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
    if (event.key === "Escape") {
      if (elements["app-shell"].classList.contains("favorites-open")) setFavoritesOpen(false);
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
  });
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
  await refreshLocalFiles({ selectRecent: true });
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
