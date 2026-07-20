import { GoogleOAuthClient, isGoogleClientIdConfigured } from "./auth.js";
import { LocalDatabase } from "./db.js";
import { AuthExpiredError, GoogleDriveApi } from "./drive-api.js";
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
  "welcome-connect-button", "sync-status-button", "sync-label", "sync-dot", "theme-button",
  "search-input", "new-note-button", "new-folder-button", "import-button", "import-input",
  "note-list", "list-heading", "list-count", "last-sync-label", "settings-button",
  "welcome-view", "welcome-description", "configuration-warning", "install-help-button",
  "editor-view", "note-path", "note-title-input", "note-save-state", "note-modified",
  "editor-panes", "markdown-editor", "markdown-preview", "attach-photo-button", "attach-photo-input",
  "delete-note-button",
  "create-dialog", "create-form", "create-kind", "create-eyebrow", "create-title", "create-name", "create-parent",
  "delete-dialog", "delete-form", "delete-description", "settings-dialog", "install-dialog",
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
  viewMode: localStorage.getItem("notes-view-mode") || "edit",
  collapsedFolders: new Set(),
  attachmentUrls: new Map(),
  authReady: false,
  connected: false,
  syncState: "local",
  refreshSequence: 0,
  installPrompt: null
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

function setSyncStatus({ state: nextState = "local", message = "Solo local", completedAt } = {}) {
  state.syncState = nextState;
  elements["sync-status-button"].dataset.state = nextState;
  elements["sync-label"].textContent = message;
  if (completedAt) elements["last-sync-label"].textContent = `Sincronizado ${formatRelativeTime(completedAt)}`;
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
      meta.title = file.dirty ? "Pendiente de sincronizar" : "";
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
      container.append(button);
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
  elements["note-save-state"].textContent = note.dirty ? "Guardado localmente · pendiente" : "Sincronizado";
  elements["note-modified"].textContent = formatRelativeTime(note.localUpdatedAt || note.modifiedTime);

  const editor = elements["markdown-editor"];
  if (!preserveTextarea || editor.dataset.fileId !== note.id) {
    editor.value = note.content ?? "";
    editor.dataset.fileId = note.id;
  }
  updatePreview(editor.value);
  setViewMode(state.viewMode, { persist: false });
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
  const [files, rootId, lastSelectedId] = await Promise.all([
    syncEngine.getLocalFiles(),
    syncEngine.getRootId(),
    db.getSetting("lastSelectedId", null)
  ]);
  if (sequence !== state.refreshSequence) return;
  state.files = files;
  state.rootId = rootId;
  pruneAttachmentUrls();

  const selectedExists = state.files.some(file => file.id === state.selectedId && file.kind === "note" && !file.trashed);
  if (!selectedExists) {
    const preferred = state.files.find(file => file.id === lastSelectedId && file.kind === "note" && !file.trashed);
    const recent = [...state.files]
      .filter(file => file.kind === "note" && !file.trashed)
      .sort((a, b) => new Date(b.localUpdatedAt || b.modifiedTime || 0) - new Date(a.localUpdatedAt || a.modifiedTime || 0))[0];
    state.selectedId = preferred?.id ?? (selectRecent ? recent?.id : null) ?? null;
  }
  if (!state.selectedFolderId || !state.files.some(file => file.id === state.selectedFolderId && file.kind === "folder")) {
    state.selectedFolderId = currentNote()?.parentId || rootId;
  }
  renderSidebar();
  renderEditor({ preserveTextarea });
  await updateSettings();
}

async function selectNote(fileId) {
  await saveCurrentNote.flush();
  state.selectedId = fileId;
  const note = currentNote();
  state.selectedFolderId = note?.parentId || state.rootId;
  await db.setSetting("lastSelectedId", fileId);
  renderSidebar();
  renderEditor();
  setSidebarOpen(false);
  requestAnimationFrame(() => elements["markdown-editor"].focus({ preventScroll: true }));
}

function setViewMode(mode, { persist = true } = {}) {
  if (!["edit", "preview", "split"].includes(mode)) mode = "edit";
  if (matchMedia("(max-width: 820px)").matches && mode === "split") mode = "edit";
  state.viewMode = mode;
  if (persist) localStorage.setItem("notes-view-mode", mode);
  elements["editor-panes"].className = `editor-panes mode-${mode}`;
  for (const button of document.querySelectorAll(".view-mode-button")) {
    button.classList.toggle("active", button.dataset.viewMode === mode);
  }
  if (mode !== "edit") updatePreview(elements["markdown-editor"].value);
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
    elements["note-save-state"].textContent = "Guardado localmente · pendiente";
    renderSidebar();
    requestSyncSoon();
    await updateSettings();
  } catch (error) {
    elements["note-save-state"].textContent = "Error al guardar";
    showToast(error.message || "No se pudo guardar la nota", "error");
  }
}, 650);

const requestSyncSoon = debounce(async () => {
  if (!state.connected || !navigator.onLine || !auth.hasValidToken()) return;
  try {
    await syncEngine.sync();
  } catch {
    // El motor ya actualiza el estado y conserva la cola local.
  }
}, 1600);

async function connectOrSync() {
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
    showToast("Google Drive está sincronizado");
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

function openDeleteDialog() {
  const note = currentNote();
  if (!note) return;
  elements["delete-description"].textContent = `“${noteDisplayName(note)}” se moverá a la papelera de Google Drive en la próxima sincronización.`;
  elements["delete-dialog"].showModal();
}

async function confirmDelete(event) {
  event.preventDefault();
  const note = currentNote();
  if (!note) return;
  try {
    await syncEngine.trashItem(note.id);
    state.selectedId = null;
    await db.deleteSetting("lastSelectedId");
    elements["delete-dialog"].close();
    await refreshLocalFiles({ selectRecent: true });
    requestSyncSoon();
    showToast("Nota movida a la papelera");
  } catch (error) {
    showToast(error.message || "No se pudo eliminar la nota", "error");
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

  elements["attach-photo-button"].disabled = true;
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
    elements["attach-photo-button"].disabled = false;
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
  elements["theme-button"].addEventListener("click", cycleTheme);
  elements["connect-button"].addEventListener("click", connectOrSync);
  elements["welcome-connect-button"].addEventListener("click", connectOrSync);
  elements["sync-status-button"].addEventListener("click", () => state.connected ? connectOrSync() : elements["settings-dialog"].showModal());
  elements["new-note-button"].addEventListener("click", () => openCreateDialog("note"));
  elements["new-folder-button"].addEventListener("click", () => openCreateDialog("folder"));
  elements["import-button"].addEventListener("click", () => elements["import-input"].click());
  elements["import-input"].addEventListener("change", event => handleImport(event.target.files));
  elements["attach-photo-button"].addEventListener("click", () => elements["attach-photo-input"].click());
  elements["attach-photo-input"].addEventListener("change", event => handleAttachPhoto(event.target.files?.[0]));
  elements["create-form"].addEventListener("submit", submitCreate);
  elements["delete-note-button"].addEventListener("click", openDeleteDialog);
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

  elements["note-title-input"].addEventListener("blur", renameCurrentNote);
  elements["note-title-input"].addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      elements["note-title-input"].blur();
    }
  });

  for (const button of document.querySelectorAll(".view-mode-button")) {
    button.addEventListener("click", () => setViewMode(button.dataset.viewMode));
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
    if (event.key === "Escape") setSidebarOpen(false);
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
