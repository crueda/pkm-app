import { AuthExpiredError, DriveApiError, normalizeDriveFile } from "./drive-api.js";
import { buildPathMap, createUniqueName, sanitizeName } from "./path-utils.js";
import { enrichNoteRecord } from "./search.js";
import { MIME_FOLDER, MIME_MARKDOWN, createId, humanFileSize, isImageFile, isMarkdownFile } from "./utils.js";

const MAX_IMAGE_ATTACHMENT_BYTES = 15 * 1024 * 1024;

function nowIso() {
  return new Date().toISOString();
}

function compactTimestamp(date = new Date()) {
  const pad = value => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join("");
}

function imageExtension(file) {
  const fromName = String(file?.name ?? "").match(/\.(avif|bmp|gif|heic|heif|jpe?g|png|webp)$/i)?.[1];
  if (fromName) return fromName.toLocaleLowerCase("es").replace("jpeg", "jpg");
  const type = String(file?.type || file?.mimeType || "").toLocaleLowerCase("es");
  return ({
    "image/avif": "avif",
    "image/bmp": "bmp",
    "image/gif": "gif",
    "image/heic": "heic",
    "image/heif": "heif",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp"
  })[type] ?? "jpg";
}

function imageMimeType(file) {
  const type = String(file?.type || file?.mimeType || "").toLocaleLowerCase("es");
  if (type.startsWith("image/")) return type;
  return ({
    avif: "image/avif",
    bmp: "image/bmp",
    gif: "image/gif",
    heic: "image/heic",
    heif: "image/heif",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp"
  })[imageExtension(file)] ?? "image/jpeg";
}

function isLocalId(id) {
  return String(id ?? "").startsWith("local:");
}

function operationPriority(operation) {
  return ({ createFolder: 10, createFile: 20, updateFile: 30, rename: 40, trash: 50 })[operation.type] ?? 99;
}

function prepareRecords(files, rootId) {
  const pathMap = buildPathMap(files, rootId);
  return files.map(file => {
    const withPath = { ...file, path: pathMap.get(file.id) ?? file.name ?? "" };
    return withPath.kind === "note" ? enrichNoteRecord(withPath) : withPath;
  });
}

function importPathFor(file) {
  return String(file.webkitRelativePath || file.name).replace(/^\/+/, "");
}

function commonImportedRoot(files) {
  const roots = new Set();
  for (const file of files) {
    const parts = importPathFor(file).split("/").filter(Boolean);
    if (!file.webkitRelativePath || parts.length < 2) return "";
    roots.add(parts[0]);
    if (roots.size > 1) return "";
  }
  return roots.values().next().value ?? "";
}

async function runWithConcurrency(tasks, limit = 4) {
  let next = 0;
  const workerCount = Math.min(limit, tasks.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (next < tasks.length) {
      const task = tasks[next];
      next += 1;
      await task();
    }
  });
  await Promise.all(workers);
}

export class AccountMismatchError extends Error {
  constructor(message = "Se ha autorizado una cuenta de Google distinta. Reconecta la cuenta anterior o borra la caché local antes de cambiar de cuenta.") {
    super(message);
    this.name = "AccountMismatchError";
    this.code = "account_mismatch";
  }
}

function conflictFileName(name) {
  const timestamp = new Date().toISOString().replace(/[:T]/g, "-").replace(/\.\d{3}Z$/, "Z");
  const stem = String(name).replace(/\.md$/i, "");
  return `${stem} (conflicto local ${timestamp}).md`;
}

export class SyncEngine extends EventTarget {
  constructor({ db, drive, vaultName = "NotesVault", maxImportFiles = 2000, maxDownloadConcurrency = 4 }) {
    super();
    this.db = db;
    this.drive = drive;
    this.vaultName = vaultName;
    this.maxImportFiles = maxImportFiles;
    this.maxDownloadConcurrency = maxDownloadConcurrency;
    this.syncPromise = null;
  }

  emit(name, detail = {}) {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }

  async getRootId() {
    return this.db.getSetting("vaultRootId", null);
  }

  async getLocalFiles() {
    const [files, rootId] = await Promise.all([this.db.getAllFiles(), this.getRootId()]);
    return prepareRecords(files, rootId);
  }

  async pendingCount() {
    return (await this.db.getOutbox()).length;
  }

  async verifyAccount() {
    const user = await this.drive.getCurrentUser();
    const accountId = String(user?.permissionId ?? "").trim();
    if (!accountId) throw new Error("Google Drive no devolvió un identificador de cuenta válido");

    const [storedAccountId, rootId] = await Promise.all([
      this.db.getSetting("googleAccountPermissionId", null),
      this.getRootId()
    ]);

    if (storedAccountId && storedAccountId !== accountId) {
      throw new AccountMismatchError();
    }

    // Para cachés creadas por una versión anterior, solo vinculamos la cuenta
    // cuando la raíz guardada también es accesible con el token actual.
    if (!storedAccountId && rootId && !isLocalId(rootId)) {
      try {
        await this.drive.getMetadata(rootId);
      } catch (error) {
        if (error instanceof AuthExpiredError) throw error;
        if (error instanceof DriveApiError && [403, 404].includes(error.status)) {
          throw new AccountMismatchError();
        }
        throw error;
      }
    }

    await Promise.all([
      this.db.setSetting("googleAccountPermissionId", accountId),
      this.db.setSetting("googleAccountDisplayName", user.displayName || "Cuenta de Google"),
      this.db.setSetting("googleAccountEmail", user.emailAddress || "")
    ]);
    return user;
  }

  async ensureVault() {
    let rootId = await this.getRootId();
    let metadata = null;

    if (rootId && !isLocalId(rootId)) {
      try {
        metadata = await this.drive.getMetadata(rootId);
        if (metadata.trashed || metadata.mimeType !== MIME_FOLDER) metadata = null;
      } catch (error) {
        if (error instanceof AuthExpiredError) throw error;
        if (!(error instanceof DriveApiError) || error.status !== 404) throw error;
      }
    }

    if (!metadata) {
      const roots = await this.drive.findVaultRoots(this.vaultName);
      metadata = roots[0] ?? null;
    }

    if (!metadata) {
      metadata = await this.drive.createFolder(this.vaultName, null, {
        notesVaultRoot: "v1",
        notesAppManaged: "v1"
      });
    } else if (metadata.appProperties?.notesVaultRoot !== "v1") {
      metadata = await this.drive.updateMetadata(metadata.id, {
        appProperties: {
          ...(metadata.appProperties ?? {}),
          notesVaultRoot: "v1",
          notesAppManaged: "v1"
        }
      });
    }

    rootId = metadata.id;
    await this.db.setSetting("vaultRootId", rootId);
    await this.db.putFile(normalizeDriveFile(metadata, {
      kind: "folder",
      parentId: null,
      path: "",
      dirty: false,
      isRoot: true
    }));
    return normalizeDriveFile(metadata, { kind: "folder", parentId: null, path: "", isRoot: true });
  }

  async sync() {
    if (this.syncPromise) return this.syncPromise;
    this.syncPromise = this.#runSync().finally(() => {
      this.syncPromise = null;
    });
    return this.syncPromise;
  }

  async #runSync() {
    this.emit("status", { state: "syncing", message: "Sincronizando…" });
    try {
      const account = await this.verifyAccount();
      const root = await this.ensureVault();
      await this.flushOutbox();
      await this.pullRemoteTree(root.id);
      const completedAt = nowIso();
      await this.db.setSetting("lastSyncAt", completedAt);
      this.emit("changed", { reason: "sync" });
      this.emit("status", { state: "idle", message: "Sincronizado", completedAt });
      return { rootId: root.id, completedAt, account };
    } catch (error) {
      if (error instanceof AuthExpiredError) {
        this.emit("authrequired", { error });
        this.emit("status", { state: "auth", message: "Reconecta Google Drive" });
      } else if (!navigator.onLine || error instanceof TypeError) {
        this.emit("status", { state: "offline", message: "Sin conexión; cambios guardados localmente" });
      } else {
        this.emit("status", { state: "error", message: error.message || "Error al sincronizar" });
        this.emit("error", { error });
      }
      throw error;
    }
  }

  async pullRemoteTree(rootId) {
    const [remoteMetadata, localFiles] = await Promise.all([
      this.drive.listTree(rootId),
      this.db.getAllFiles()
    ]);
    const localMap = new Map(localFiles.map(file => [file.id, file]));
    const root = localMap.get(rootId) ?? {
      id: rootId,
      name: this.vaultName,
      mimeType: MIME_FOLDER,
      kind: "folder",
      parentId: null,
      isRoot: true,
      dirty: false
    };
    const records = [root];
    const remoteIds = new Set([rootId]);
    const downloads = [];

    for (const metadata of remoteMetadata) {
      remoteIds.add(metadata.id);
      const normalized = normalizeDriveFile(metadata);
      const existing = localMap.get(metadata.id);
      let record = { ...existing, ...normalized, dirty: existing?.dirty ?? false };

      if (normalized.kind === "note") {
        const unchanged = existing?.content != null && String(existing.remoteVersion) === String(normalized.remoteVersion);
        if (existing?.dirty) {
          record = {
            ...existing,
            name: normalized.name,
            parentId: normalized.parentId,
            modifiedTime: normalized.modifiedTime,
            remoteCurrentVersion: normalized.remoteVersion
          };
        } else if (!unchanged) {
          downloads.push(async () => {
            const content = await this.drive.downloadText(metadata.id);
            Object.assign(record, { content, dirty: false, localUpdatedAt: normalized.modifiedTime });
          });
        }
      } else if (normalized.kind === "attachment") {
        const unchanged = existing?.blob != null && String(existing.remoteVersion) === String(normalized.remoteVersion);
        if (existing?.dirty) {
          record = {
            ...existing,
            name: normalized.name,
            parentId: normalized.parentId,
            modifiedTime: normalized.modifiedTime,
            remoteCurrentVersion: normalized.remoteVersion
          };
        } else if (isImageFile(normalized) && !unchanged) {
          downloads.push(async () => {
            const blob = await this.drive.downloadBlob(metadata.id);
            Object.assign(record, { blob, dirty: false, localUpdatedAt: normalized.modifiedTime });
          });
        }
      }
      records.push(record);
    }

    if (downloads.length) {
      let completed = 0;
      this.emit("progress", { phase: "download", current: completed, total: downloads.length });
      await runWithConcurrency(downloads.map(download => async () => {
        await download();
        completed += 1;
        this.emit("progress", { phase: "download", current: completed, total: downloads.length });
      }), this.maxDownloadConcurrency);
    }

    for (const local of localFiles) {
      if (local.id === rootId || remoteIds.has(local.id)) continue;
      if (local.isLocalOnly || local.dirty || isLocalId(local.id)) records.push(local);
    }

    const prepared = prepareRecords(records, rootId);
    const keepIds = new Set(prepared.map(file => file.id));
    const staleIds = localFiles.filter(file => !keepIds.has(file.id)).map(file => file.id);
    await this.db.putFiles(prepared);
    await this.db.deleteFiles(staleIds);
  }

  async flushOutbox() {
    let guard = 0;
    while (guard < 10_000) {
      guard += 1;
      const operations = (await this.db.getOutbox()).sort((a, b) => {
        return operationPriority(a) - operationPriority(b) || String(a.createdAt).localeCompare(String(b.createdAt));
      });
      if (!operations.length) return;

      const operation = operations.find(candidate => {
        if (candidate.type === "createFolder" || candidate.type === "createFile") {
          return !candidate.parentId || !isLocalId(candidate.parentId);
        }
        return !isLocalId(candidate.fileId);
      });
      if (!operation) {
        throw new Error("La cola local contiene dependencias que no se pueden resolver");
      }

      await this.#processOperation(operation);
      this.emit("progress", { phase: "upload", pending: Math.max(0, operations.length - 1) });
    }
    throw new Error("La cola de sincronización superó el límite de seguridad");
  }

  async #processOperation(operation) {
    if (operation.type === "createFolder") {
      const metadata = await this.drive.createFolder(operation.name, operation.parentId, { notesAppManaged: "v1" });
      await this.db.replaceLocalId(operation.fileId, normalizeDriveFile(metadata, { dirty: false }));
      await this.db.deleteOutbox(operation.opId);
      return;
    }

    if (operation.type === "createFile") {
      if (operation.kind === "attachment" || operation.blob) {
        const blob = operation.blob instanceof Blob
          ? operation.blob
          : new Blob([operation.content ?? ""], { type: operation.mimeType || "application/octet-stream" });
        const mimeType = operation.mimeType || blob.type || "application/octet-stream";
        const metadata = await this.drive.createFile(operation.name, operation.parentId, blob, mimeType, {
          notesAppManaged: "v1",
          ...(operation.appProperties ?? {})
        });
        await this.db.replaceLocalId(operation.fileId, normalizeDriveFile(metadata, {
          blob,
          dirty: false,
          localUpdatedAt: nowIso()
        }));
        await this.db.deleteOutbox(operation.opId);
        return;
      }

      const metadata = await this.drive.createMarkdownFile(operation.name, operation.parentId, operation.content ?? "", {
        notesAppManaged: "v1"
      });
      await this.db.replaceLocalId(operation.fileId, normalizeDriveFile(metadata, {
        content: operation.content ?? "",
        dirty: false,
        localUpdatedAt: nowIso()
      }));
      await this.db.deleteOutbox(operation.opId);
      return;
    }

    if (operation.type === "updateFile") {
      const local = await this.db.getFile(operation.fileId);
      if (!local) {
        await this.db.deleteOutbox(operation.opId);
        return;
      }
      const currentMetadata = await this.drive.getMetadata(operation.fileId);
      const currentVersion = currentMetadata.version != null ? String(currentMetadata.version) : null;
      const baseVersion = operation.baseVersion != null ? String(operation.baseVersion) : null;

      if (baseVersion && currentVersion && baseVersion !== currentVersion) {
        const remoteContent = await this.drive.downloadText(operation.fileId);
        const conflictMetadata = await this.drive.createMarkdownFile(
          conflictFileName(local.name),
          local.parentId,
          operation.content ?? local.content ?? "",
          { notesAppManaged: "v1", notesConflictOf: operation.fileId }
        );
        const remoteRecord = normalizeDriveFile(currentMetadata, {
          content: remoteContent,
          dirty: false,
          localUpdatedAt: currentMetadata.modifiedTime
        });
        const conflictRecord = normalizeDriveFile(conflictMetadata, {
          content: operation.content ?? local.content ?? "",
          dirty: false,
          localUpdatedAt: nowIso()
        });
        await this.db.putFiles([enrichNoteRecord(remoteRecord), enrichNoteRecord(conflictRecord)]);
        await this.db.deleteOutbox(operation.opId);
        this.emit("conflict", {
          originalId: operation.fileId,
          conflictId: conflictMetadata.id,
          conflictName: conflictMetadata.name
        });
        return;
      }

      const metadata = await this.drive.updateMarkdownContent(operation.fileId, operation.content ?? "");
      await this.db.putFile(enrichNoteRecord({
        ...local,
        ...normalizeDriveFile(metadata),
        content: operation.content ?? "",
        dirty: false,
        localUpdatedAt: nowIso()
      }));
      await this.db.deleteOutbox(operation.opId);
      return;
    }

    if (operation.type === "rename") {
      const local = await this.db.getFile(operation.fileId);
      const metadata = await this.drive.updateMetadata(operation.fileId, { name: operation.name });
      if (local) {
        await this.db.putFile({
          ...local,
          ...normalizeDriveFile(metadata),
          content: local.content,
          dirty: false,
          localUpdatedAt: nowIso()
        });
      }
      await this.db.deleteOutbox(operation.opId);
      return;
    }

    if (operation.type === "trash") {
      await this.drive.trash(operation.fileId);
      await this.#deleteLocalTree(operation.fileId);
      await this.db.deleteOutbox(operation.opId);
      return;
    }

    await this.db.deleteOutbox(operation.opId);
  }

  async createFolder(parentId, requestedName) {
    const files = await this.getLocalFiles();
    const name = createUniqueName(files, parentId, requestedName, { markdown: false });
    const record = {
      id: createId(),
      name,
      mimeType: MIME_FOLDER,
      kind: "folder",
      parentId,
      createdTime: nowIso(),
      modifiedTime: nowIso(),
      localUpdatedAt: nowIso(),
      dirty: true,
      isLocalOnly: true,
      trashed: false,
      appProperties: { notesAppManaged: "v1" }
    };
    await this.db.putFile(record);
    await this.db.putOutbox({
      opId: createId("op"),
      type: "createFolder",
      fileId: record.id,
      parentId,
      name,
      createdAt: nowIso()
    });
    await this.#rebuildPaths();
    this.emit("changed", { reason: "create-folder", fileId: record.id });
    return this.db.getFile(record.id);
  }

  async createNote(parentId, requestedName, content = "") {
    const files = await this.getLocalFiles();
    const name = createUniqueName(files, parentId, requestedName, { markdown: true });
    const record = enrichNoteRecord({
      id: createId(),
      name,
      mimeType: MIME_MARKDOWN,
      kind: "note",
      parentId,
      content: String(content),
      createdTime: nowIso(),
      modifiedTime: nowIso(),
      localUpdatedAt: nowIso(),
      dirty: true,
      isLocalOnly: true,
      trashed: false,
      appProperties: { notesAppManaged: "v1" }
    });
    await this.db.putFile(record);
    await this.db.putOutbox({
      opId: createId("op"),
      type: "createFile",
      fileId: record.id,
      parentId,
      name,
      content: record.content,
      createdAt: nowIso()
    });
    await this.#rebuildPaths();
    this.emit("changed", { reason: "create-note", fileId: record.id });
    return this.db.getFile(record.id);
  }

  async createImageAttachment(parentId, imageFile, { relatedNoteId = null } = {}) {
    if (!parentId) throw new Error("No se encontró la carpeta de la nota");
    if (!imageFile || !isImageFile(imageFile)) throw new Error("Selecciona un archivo de imagen válido");
    if (Number(imageFile.size) > MAX_IMAGE_ATTACHMENT_BYTES) {
      throw new Error(`La imagen supera el límite de ${humanFileSize(MAX_IMAGE_ATTACHMENT_BYTES)}`);
    }

    const mimeType = imageMimeType(imageFile);
    const blob = imageFile.slice
      ? imageFile.slice(0, imageFile.size, mimeType)
      : new Blob([imageFile], { type: mimeType });
    const files = await this.getLocalFiles();
    const requestedName = `foto-${compactTimestamp()}.${imageExtension(imageFile)}`;
    const name = createUniqueName(files, parentId, requestedName, { preserveExtension: true });
    const time = nowIso();
    const record = {
      id: createId(),
      name,
      mimeType,
      kind: "attachment",
      parentId,
      blob,
      size: blob.size,
      createdTime: time,
      modifiedTime: time,
      localUpdatedAt: time,
      dirty: true,
      isLocalOnly: true,
      trashed: false,
      appProperties: {
        notesAppManaged: "v1",
        notesAttachment: "image"
      }
    };

    await this.db.putFile(record);
    await this.db.putOutbox({
      opId: createId("op"),
      type: "createFile",
      kind: "attachment",
      fileId: record.id,
      parentId,
      name,
      mimeType,
      blob,
      appProperties: record.appProperties,
      createdAt: time
    });
    await this.#rebuildPaths();
    this.emit("changed", { reason: "create-attachment", fileId: record.id, noteId: relatedNoteId });
    return this.db.getFile(record.id);
  }

  async updateNote(fileId, content) {
    const file = await this.db.getFile(fileId);
    if (!file || file.kind !== "note") throw new Error("La nota ya no existe");
    const updated = enrichNoteRecord({
      ...file,
      content: String(content),
      dirty: true,
      modifiedTime: nowIso(),
      localUpdatedAt: nowIso()
    });
    await this.db.putFile(updated);

    const operations = await this.db.getOutbox();
    if (isLocalId(fileId)) {
      const createOperation = operations.find(operation => operation.type === "createFile" && operation.fileId === fileId);
      if (createOperation) await this.db.putOutbox({ ...createOperation, content: updated.content });
    } else {
      const existing = operations.find(operation => operation.type === "updateFile" && operation.fileId === fileId);
      await this.db.putOutbox(existing ? {
        ...existing,
        content: updated.content,
        updatedAt: nowIso()
      } : {
        opId: createId("op"),
        type: "updateFile",
        fileId,
        content: updated.content,
        baseVersion: file.remoteVersion,
        createdAt: nowIso()
      });
    }
    this.emit("changed", { reason: "update-note", fileId });
    return updated;
  }

  async renameItem(fileId, requestedName) {
    const [file, files] = await Promise.all([this.db.getFile(fileId), this.getLocalFiles()]);
    if (!file) throw new Error("El elemento ya no existe");
    const markdown = file.kind === "note";
    const sanitized = sanitizeName(requestedName, { markdown });
    const name = createUniqueName(files.filter(candidate => candidate.id !== fileId), file.parentId, sanitized, { markdown });
    const updated = {
      ...file,
      name,
      dirty: true,
      modifiedTime: nowIso(),
      localUpdatedAt: nowIso()
    };
    await this.db.putFile(updated);

    const operations = await this.db.getOutbox();
    if (isLocalId(fileId)) {
      const createOperation = operations.find(operation => ["createFile", "createFolder"].includes(operation.type) && operation.fileId === fileId);
      if (createOperation) await this.db.putOutbox({ ...createOperation, name });
    } else {
      const existing = operations.find(operation => operation.type === "rename" && operation.fileId === fileId);
      await this.db.putOutbox(existing ? { ...existing, name, updatedAt: nowIso() } : {
        opId: createId("op"),
        type: "rename",
        fileId,
        name,
        baseVersion: file.remoteVersion,
        createdAt: nowIso()
      });
    }
    await this.#rebuildPaths();
    this.emit("changed", { reason: "rename", fileId });
    return this.db.getFile(fileId);
  }

  async trashItem(fileId) {
    const file = await this.db.getFile(fileId);
    if (!file) return;
    if (isLocalId(fileId)) {
      await this.#deleteLocalTree(fileId);
      this.emit("changed", { reason: "delete-local", fileId });
      return;
    }

    const operations = await this.db.getOutbox();
    await this.db.deleteOutboxMany(
      operations
        .filter(operation => operation.fileId === fileId && operation.type !== "trash")
        .map(operation => operation.opId)
    );
    const existingTrash = operations.find(operation => operation.type === "trash" && operation.fileId === fileId);
    if (!existingTrash) {
      await this.db.putOutbox({
        opId: createId("op"),
        type: "trash",
        fileId,
        createdAt: nowIso()
      });
    }
    await this.db.putFile({ ...file, trashed: true, dirty: true, localUpdatedAt: nowIso() });
    this.emit("changed", { reason: "trash", fileId });
  }

  async importMarkdownFiles(fileList, parentId) {
    const candidates = [...fileList]
      .filter(file => isMarkdownFile(file))
      .filter(file => !String(file.webkitRelativePath || file.name).split("/").some(part => part === ".obsidian" || part.startsWith(".")));
    if (candidates.length > this.maxImportFiles) {
      throw new Error(`La importación admite un máximo de ${this.maxImportFiles} archivos por lote`);
    }

    const rootId = parentId || await this.getRootId();
    if (!rootId) throw new Error("Conecta Google Drive una vez antes de importar");
    const folderIds = new Map([["", rootId]]);
    const stripRoot = commonImportedRoot(candidates);
    const imported = [];

    for (let index = 0; index < candidates.length; index += 1) {
      const file = candidates[index];
      const relativeParts = importPathFor(file).split("/").filter(Boolean);
      if (stripRoot && relativeParts[0] === stripRoot) relativeParts.shift();
      const relative = relativeParts.join("/");
      const parts = relative.split("/").filter(Boolean);
      const filename = parts.pop();
      let accumulated = "";
      let currentParentId = rootId;

      for (const rawFolder of parts) {
        accumulated = accumulated ? `${accumulated}/${rawFolder}` : rawFolder;
        if (!folderIds.has(accumulated)) {
          const allFiles = await this.getLocalFiles();
          const existing = allFiles.find(candidate => candidate.parentId === currentParentId && candidate.kind === "folder" && candidate.name.toLocaleLowerCase("es") === rawFolder.toLocaleLowerCase("es"));
          const folder = existing ?? await this.createFolder(currentParentId, rawFolder);
          folderIds.set(accumulated, folder.id);
        }
        currentParentId = folderIds.get(accumulated);
      }

      const content = await file.text();
      const note = await this.createNote(currentParentId, filename, content);
      imported.push(note);
      this.emit("progress", { phase: "import", current: index + 1, total: candidates.length, name: filename });
    }
    return imported;
  }

  async #deleteLocalTree(rootFileId) {
    const files = await this.db.getAllFiles();
    const ids = new Set([rootFileId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const file of files) {
        if (file.parentId && ids.has(file.parentId) && !ids.has(file.id)) {
          ids.add(file.id);
          changed = true;
        }
      }
    }
    const operations = await this.db.getOutbox();
    await Promise.all([
      this.db.deleteFiles([...ids]),
      this.db.deleteOutboxMany(
        operations
          .filter(operation => ids.has(operation.fileId) || ids.has(operation.parentId))
          .map(operation => operation.opId)
      )
    ]);
  }

  async #rebuildPaths() {
    const [files, rootId] = await Promise.all([this.db.getAllFiles(), this.getRootId()]);
    await this.db.putFiles(prepareRecords(files, rootId));
  }
}
