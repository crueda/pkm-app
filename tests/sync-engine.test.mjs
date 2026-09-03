import test from "node:test";
import assert from "node:assert/strict";

import { SyncEngine } from "../app/src/sync-engine.js";
import { DriveApiError } from "../app/src/drive-api.js";
import { MIME_FOLDER, MIME_MARKDOWN } from "../app/src/utils.js";

class MemoryDb {
  constructor() {
    this.files = new Map();
    this.settings = new Map();
    this.outbox = new Map();
  }

  async getAllFiles() { return structuredClone([...this.files.values()]); }
  async getFile(id) { return structuredClone(this.files.get(id)); }
  async putFile(file) { this.files.set(file.id, structuredClone(file)); return file; }
  async putFiles(files) { for (const file of files) this.files.set(file.id, structuredClone(file)); }
  async deleteFile(id) { this.files.delete(id); }
  async deleteFiles(ids) { for (const id of ids) this.files.delete(id); }
  async getSetting(key, fallback = null) { return this.settings.has(key) ? structuredClone(this.settings.get(key)) : fallback; }
  async setSetting(key, value) { this.settings.set(key, structuredClone(value)); return value; }
  async deleteSetting(key) { this.settings.delete(key); }
  async getOutbox() { return structuredClone([...this.outbox.values()]); }
  async putOutbox(operation) { this.outbox.set(operation.opId, structuredClone(operation)); return operation; }
  async deleteOutbox(opId) { this.outbox.delete(opId); }
  async deleteOutboxMany(opIds) { for (const id of opIds) this.outbox.delete(id); }

  async replaceLocalId(localId, remoteFile) {
    const current = this.files.get(localId);
    assert.ok(current, `Falta el archivo local ${localId}`);
    this.files.delete(localId);
    for (const [id, file] of this.files) {
      if (file.parentId === localId) this.files.set(id, { ...file, parentId: remoteFile.id });
    }
    this.files.set(remoteFile.id, {
      ...current,
      ...structuredClone(remoteFile),
      id: remoteFile.id,
      parentId: remoteFile.parentId ?? current.parentId,
      dirty: false,
      isLocalOnly: false
    });
    for (const [opId, operation] of this.outbox) {
      this.outbox.set(opId, {
        ...operation,
        fileId: operation.fileId === localId ? remoteFile.id : operation.fileId,
        parentId: operation.parentId === localId ? remoteFile.id : operation.parentId
      });
    }
  }
}

class MemoryDrive {
  constructor() {
    this.files = new Map();
    this.contents = new Map();
    this.sequence = 0;
    this.clock = 0;
    this.changeSequence = 0;
    this.changes = [];
    this.listTreeCalls = 0;
    this.currentUser = { permissionId: "account-a", displayName: "Cuenta A", emailAddress: "a@example.test" };
  }

  timestamp() {
    this.clock += 1;
    return new Date(Date.UTC(2026, 6, 18, 10, 0, this.clock)).toISOString();
  }

  nextId() {
    this.sequence += 1;
    return `drive-${this.sequence}`;
  }

  metadata(id) {
    const file = this.files.get(id);
    if (!file) throw new Error(`Archivo remoto inexistente: ${id}`);
    return structuredClone(file);
  }

  recordChange(file) {
    this.changeSequence += 1;
    this.changes.push({
      token: this.changeSequence,
      change: { fileId: file.id, removed: false, file: structuredClone(file) }
    });
  }

  async getMetadata(id) { return this.metadata(id); }
  async getCurrentUser() { return structuredClone(this.currentUser); }

  async findVaultRoots() {
    return [...this.files.values()]
      .filter(file => file.mimeType === MIME_FOLDER && file.appProperties?.notesVaultRoot === "v1" && !file.trashed)
      .map(structuredClone);
  }

  async createFolder(name, parentId = null, appProperties = {}) {
    const id = this.nextId();
    const time = this.timestamp();
    const metadata = {
      id,
      name,
      mimeType: MIME_FOLDER,
      parents: parentId ? [parentId] : [],
      createdTime: time,
      modifiedTime: time,
      version: "1",
      trashed: false,
      appProperties
    };
    this.files.set(id, metadata);
    this.recordChange(metadata);
    return structuredClone(metadata);
  }

  async createMarkdownFile(name, parentId, content, appProperties = {}) {
    const id = this.nextId();
    const time = this.timestamp();
    const metadata = {
      id,
      name,
      mimeType: MIME_MARKDOWN,
      parents: [parentId],
      createdTime: time,
      modifiedTime: time,
      version: "1",
      size: String(new TextEncoder().encode(content).byteLength),
      trashed: false,
      appProperties
    };
    this.files.set(id, metadata);
    this.contents.set(id, String(content));
    this.recordChange(metadata);
    return structuredClone(metadata);
  }

  async createFile(name, parentId, blob, mimeType = "application/octet-stream", appProperties = {}) {
    const id = this.nextId();
    const time = this.timestamp();
    const metadata = {
      id,
      name,
      mimeType,
      parents: [parentId],
      createdTime: time,
      modifiedTime: time,
      version: "1",
      size: String(blob.size ?? 0),
      trashed: false,
      appProperties
    };
    this.files.set(id, metadata);
    this.contents.set(id, blob);
    this.recordChange(metadata);
    return structuredClone(metadata);
  }

  async updateMetadata(id, patch) {
    const current = this.metadata(id);
    const next = {
      ...current,
      ...structuredClone(patch),
      modifiedTime: this.timestamp(),
      version: String(Number(current.version || 0) + 1)
    };
    this.files.set(id, next);
    this.recordChange(next);
    return structuredClone(next);
  }

  async updateMarkdownContent(id, content) {
    const current = this.metadata(id);
    this.contents.set(id, String(content));
    const next = {
      ...current,
      modifiedTime: this.timestamp(),
      version: String(Number(current.version || 0) + 1),
      size: String(new TextEncoder().encode(content).byteLength)
    };
    this.files.set(id, next);
    this.recordChange(next);
    return structuredClone(next);
  }

  async downloadText(id) { return this.contents.get(id) ?? ""; }
  async downloadBlob(id) { return this.contents.get(id) ?? new Blob([]); }

  async moveFile(id, previousParentId, parentId) {
    const current = this.metadata(id);
    assert.equal(current.parents?.[0] ?? null, previousParentId);
    return this.updateMetadata(id, { parents: [parentId] });
  }

  async listTree(rootId) {
    this.listTreeCalls += 1;
    const result = [];
    const queue = [rootId];
    while (queue.length) {
      const parentId = queue.shift();
      for (const file of this.files.values()) {
        if (file.trashed || file.parents?.[0] !== parentId) continue;
        result.push(structuredClone(file));
        if (file.mimeType === MIME_FOLDER) queue.push(file.id);
      }
    }
    return result;
  }

  async getStartPageToken() { return String(this.changeSequence); }

  async listChanges(pageToken) {
    const from = Number(pageToken || 0);
    return {
      changes: this.changes.filter(entry => entry.token > from).map(entry => structuredClone(entry.change)),
      newStartPageToken: String(this.changeSequence)
    };
  }

  async trash(id) {
    return this.updateMetadata(id, { trashed: true });
  }
}

test("sincroniza una carpeta y una nota creadas offline respetando dependencias", async () => {
  const db = new MemoryDb();
  const drive = new MemoryDrive();
  const engine = new SyncEngine({ db, drive, vaultName: "NotesVault" });

  const root = await engine.ensureVault();
  const localFolder = await engine.createFolder(root.id, "Proyectos");
  await engine.createNote(localFolder.id, "Aplicación", "# Aplicación\n\nPrimer borrador");

  assert.equal((await db.getOutbox()).length, 2);
  await engine.sync();

  const localFiles = await engine.getLocalFiles();
  assert.equal((await db.getOutbox()).length, 0);
  assert.equal(localFiles.some(file => file.id.startsWith("local:")), false);

  const folder = localFiles.find(file => file.kind === "folder" && file.name === "Proyectos");
  const note = localFiles.find(file => file.kind === "note" && file.name === "Aplicación.md");
  assert.ok(folder);
  assert.ok(note);
  assert.equal(note.parentId, folder.id);
  assert.equal(note.content, "# Aplicación\n\nPrimer borrador");
  assert.equal(note.path, "Proyectos/Aplicación.md");
});

test("sube la última versión de una nota creada y editada antes de conectar", async () => {
  const db = new MemoryDb();
  const drive = new MemoryDrive();
  const engine = new SyncEngine({ db, drive, vaultName: "NotesVault" });

  const root = await engine.ensureVault();
  const localNote = await engine.createNote(root.id, "Idea", "# Idea");
  await engine.updateNote(localNote.id, "# Idea\n\nTexto escrito sin conexión");

  const beforeSync = await db.getOutbox();
  assert.equal(beforeSync.length, 1);
  assert.equal(beforeSync[0].type, "createFile");
  assert.equal(beforeSync[0].content, "# Idea\n\nTexto escrito sin conexión");

  await engine.sync();
  const syncedNote = (await engine.getLocalFiles()).find(file => file.kind === "note" && file.name === "Idea.md");

  assert.equal(syncedNote.isLocalOnly, false);
  assert.equal(syncedNote.dirty, false);
  assert.equal(drive.contents.get(syncedNote.id), "# Idea\n\nTexto escrito sin conexión");
  assert.equal((await db.getOutbox()).length, 0);
});

test("usa el registro incremental después de la primera sincronización", async () => {
  const db = new MemoryDb();
  const drive = new MemoryDrive();
  const engine = new SyncEngine({ db, drive, vaultName: "NotesVault" });
  const root = await engine.ensureVault();
  const remote = await drive.createMarkdownFile("Diario.md", root.id, "Primera versión", { notesAppManaged: "v1" });

  await engine.sync();
  const initialTreeCalls = drive.listTreeCalls;
  await drive.updateMarkdownContent(remote.id, "Segunda versión");
  await engine.sync();

  const note = (await engine.getLocalFiles()).find(file => file.id === remote.id);
  assert.equal(note.content, "Segunda versión");
  assert.equal(drive.listTreeCalls, initialTreeCalls);
  assert.equal(await db.getSetting("driveChangePageToken"), String(drive.changeSequence));
});

test("aplica altas y borrados remotos mediante cambios incrementales", async () => {
  const db = new MemoryDb();
  const drive = new MemoryDrive();
  const engine = new SyncEngine({ db, drive, vaultName: "NotesVault" });
  const root = await engine.ensureVault();
  await engine.sync();
  const initialTreeCalls = drive.listTreeCalls;

  const folder = await drive.createFolder("Remota", root.id, { notesAppManaged: "v1" });
  const note = await drive.createMarkdownFile("Nueva.md", folder.id, "# Nueva", { notesAppManaged: "v1" });
  await engine.sync();
  assert.equal((await engine.getLocalFiles()).find(file => file.id === note.id).path, "Remota/Nueva.md");

  await drive.trash(folder.id);
  await engine.sync();
  assert.equal(await db.getFile(folder.id), undefined);
  assert.equal(await db.getFile(note.id), undefined);
  assert.equal(drive.listTreeCalls, initialTreeCalls);
});

test("reconstruye el índice cuando Drive invalida el token incremental", async () => {
  const db = new MemoryDb();
  const drive = new MemoryDrive();
  const engine = new SyncEngine({ db, drive, vaultName: "NotesVault" });
  await engine.ensureVault();
  await engine.sync();
  const initialTreeCalls = drive.listTreeCalls;
  const originalListChanges = drive.listChanges.bind(drive);
  let expired = true;
  drive.listChanges = async token => {
    if (expired) {
      expired = false;
      throw new DriveApiError("Token caducado", { status: 410 });
    }
    return originalListChanges(token);
  };

  await engine.sync();
  assert.equal(drive.listTreeCalls, initialTreeCalls + 1);
});

test("conserva una edición hecha mientras se está subiendo una nota existente", async () => {
  const db = new MemoryDb();
  const drive = new MemoryDrive();
  const engine = new SyncEngine({ db, drive, vaultName: "NotesVault" });

  const root = await engine.ensureVault();
  const remote = await drive.createMarkdownFile("Diario.md", root.id, "Primera versión", { notesAppManaged: "v1" });
  await engine.pullRemoteTree(root.id);
  await engine.updateNote(remote.id, "Cambio que empieza a subir");

  const originalUpdate = drive.updateMarkdownContent.bind(drive);
  let releaseUpload;
  let notifyStarted;
  const uploadStarted = new Promise(resolve => { notifyStarted = resolve; });
  const continueUpload = new Promise(resolve => { releaseUpload = resolve; });
  let delayed = true;
  drive.updateMarkdownContent = async (...args) => {
    if (delayed) {
      delayed = false;
      notifyStarted();
      await continueUpload;
    }
    return originalUpdate(...args);
  };

  const syncing = engine.sync();
  await uploadStarted;
  await engine.updateNote(remote.id, "Texto final escrito durante la subida");
  releaseUpload();
  await syncing;

  const notes = (await engine.getLocalFiles()).filter(file => file.kind === "note");
  assert.equal(notes.length, 1);
  assert.equal(notes[0].content, "Texto final escrito durante la subida");
  assert.equal(drive.contents.get(remote.id), "Texto final escrito durante la subida");
  assert.equal((await db.getOutbox()).length, 0);
});

test("conserva una edición hecha mientras se está creando una nota remota", async () => {
  const db = new MemoryDb();
  const drive = new MemoryDrive();
  const engine = new SyncEngine({ db, drive, vaultName: "NotesVault" });

  const root = await engine.ensureVault();
  const local = await engine.createNote(root.id, "Idea", "Borrador inicial");
  const originalCreate = drive.createMarkdownFile.bind(drive);
  let releaseUpload;
  let notifyStarted;
  const uploadStarted = new Promise(resolve => { notifyStarted = resolve; });
  const continueUpload = new Promise(resolve => { releaseUpload = resolve; });
  drive.createMarkdownFile = async (...args) => {
    notifyStarted();
    await continueUpload;
    return originalCreate(...args);
  };

  const syncing = engine.sync();
  await uploadStarted;
  await engine.updateNote(local.id, "Texto final escrito durante la creación");
  releaseUpload();
  await syncing;

  const notes = (await engine.getLocalFiles()).filter(file => file.kind === "note");
  assert.equal(notes.length, 1);
  assert.equal(notes[0].content, "Texto final escrito durante la creación");
  assert.equal(drive.contents.get(notes[0].id), "Texto final escrito durante la creación");
  assert.equal((await db.getOutbox()).length, 0);
});

test("mueve una carpeta local con todo su contenido y respeta dependencias al sincronizar", async () => {
  const db = new MemoryDb();
  const drive = new MemoryDrive();
  const engine = new SyncEngine({ db, drive, vaultName: "NotesVault" });

  const root = await engine.ensureVault();
  const destination = await engine.createFolder(root.id, "Archivo");
  const source = await engine.createFolder(root.id, "Proyecto");
  const child = await engine.createFolder(source.id, "Material");
  await engine.createNote(child.id, "Plan", "# Plan");

  await engine.moveFolder(source.id, destination.id);
  const beforeSync = await engine.getLocalFiles();
  assert.equal(beforeSync.find(file => file.id === source.id).path, "Archivo/Proyecto");
  assert.equal(beforeSync.find(file => file.name === "Plan.md").path, "Archivo/Proyecto/Material/Plan.md");
  assert.equal((await db.getOutbox()).find(operation => operation.fileId === source.id).parentId, destination.id);

  await engine.sync();
  const afterSync = await engine.getLocalFiles();
  const remoteDestination = afterSync.find(file => file.kind === "folder" && file.name === "Archivo");
  const remoteSource = afterSync.find(file => file.kind === "folder" && file.name === "Proyecto");
  const remoteNote = afterSync.find(file => file.kind === "note" && file.name === "Plan.md");

  assert.equal(drive.files.get(remoteSource.id).parents[0], remoteDestination.id);
  assert.equal(remoteNote.path, "Archivo/Proyecto/Material/Plan.md");
  assert.equal(remoteNote.content, "# Plan");
  assert.equal((await db.getOutbox()).length, 0);
});

test("renombra una carpeta y actualiza las rutas de todo su contenido", async () => {
  const db = new MemoryDb();
  const drive = new MemoryDrive();
  const engine = new SyncEngine({ db, drive, vaultName: "NotesVault" });

  const root = await engine.ensureVault();
  const folder = await engine.createFolder(root.id, "Proyecto");
  const child = await engine.createFolder(folder.id, "Material");
  await engine.createNote(child.id, "Plan", "# Plan");

  const renamed = await engine.renameItem(folder.id, "Trabajo");
  const beforeSync = await engine.getLocalFiles();
  assert.equal(renamed.name, "Trabajo");
  assert.equal(beforeSync.find(file => file.id === child.id).path, "Trabajo/Material");
  assert.equal(beforeSync.find(file => file.name === "Plan.md").path, "Trabajo/Material/Plan.md");
  assert.equal((await db.getOutbox()).find(operation => operation.fileId === folder.id).name, "Trabajo");

  await engine.sync();
  const localFiles = await engine.getLocalFiles();
  const remoteFolder = localFiles.find(file => file.kind === "folder" && file.name === "Trabajo");
  assert.ok(remoteFolder);
  assert.equal(drive.files.get(remoteFolder.id).name, "Trabajo");
  assert.equal(localFiles.find(file => file.name === "Plan.md").path, "Trabajo/Material/Plan.md");
});

test("mueve en Drive una carpeta ya sincronizada", async () => {
  const db = new MemoryDb();
  const drive = new MemoryDrive();
  const engine = new SyncEngine({ db, drive, vaultName: "NotesVault" });

  const root = await engine.ensureVault();
  const source = await drive.createFolder("Proyecto", root.id, { notesAppManaged: "v1" });
  const destination = await drive.createFolder("Archivo", root.id, { notesAppManaged: "v1" });
  await drive.createMarkdownFile("Plan.md", source.id, "# Plan", { notesAppManaged: "v1" });
  await engine.pullRemoteTree(root.id);

  await engine.moveFolder(source.id, destination.id);
  const pending = await db.getOutbox();
  assert.equal(pending.length, 1);
  assert.deepEqual(
    { type: pending[0].type, previousParentId: pending[0].previousParentId, parentId: pending[0].parentId },
    { type: "move", previousParentId: root.id, parentId: destination.id }
  );
  assert.equal((await engine.getLocalFiles()).find(file => file.name === "Plan.md").path, "Archivo/Proyecto/Plan.md");

  await engine.sync();
  assert.equal(drive.files.get(source.id).parents[0], destination.id);
  assert.equal((await engine.getLocalFiles()).find(file => file.name === "Plan.md").path, "Archivo/Proyecto/Plan.md");
});

test("impide mover una carpeta dentro de uno de sus descendientes", async () => {
  const db = new MemoryDb();
  const drive = new MemoryDrive();
  const engine = new SyncEngine({ db, drive, vaultName: "NotesVault" });

  const root = await engine.ensureVault();
  const parent = await engine.createFolder(root.id, "Padre");
  const child = await engine.createFolder(parent.id, "Hija");

  await assert.rejects(() => engine.moveFolder(parent.id, child.id), /sí misma/);
  assert.equal((await db.getFile(parent.id)).parentId, root.id);
});

test("elimina localmente una carpeta nueva junto con todo su contenido", async () => {
  const db = new MemoryDb();
  const drive = new MemoryDrive();
  const engine = new SyncEngine({ db, drive, vaultName: "NotesVault" });

  const root = await engine.ensureVault();
  const folder = await engine.createFolder(root.id, "Proyecto");
  const child = await engine.createFolder(folder.id, "Material");
  const note = await engine.createNote(child.id, "Plan", "# Plan");

  await engine.trashItem(folder.id);

  assert.equal(await db.getFile(folder.id), undefined);
  assert.equal(await db.getFile(child.id), undefined);
  assert.equal(await db.getFile(note.id), undefined);
  assert.equal((await db.getOutbox()).length, 0);
});

test("mueve una carpeta sincronizada a la papelera y descarta cambios pendientes de sus descendientes", async () => {
  const db = new MemoryDb();
  const drive = new MemoryDrive();
  const engine = new SyncEngine({ db, drive, vaultName: "NotesVault" });

  const root = await engine.ensureVault();
  const folder = await drive.createFolder("Proyecto", root.id, { notesAppManaged: "v1" });
  const child = await drive.createFolder("Material", folder.id, { notesAppManaged: "v1" });
  const note = await drive.createMarkdownFile("Plan.md", child.id, "# Plan", { notesAppManaged: "v1" });
  await engine.pullRemoteTree(root.id);
  await engine.updateNote(note.id, "# Plan\n\nCambio pendiente");

  await engine.trashItem(folder.id);
  const localTree = (await engine.getLocalFiles()).filter(file => [folder.id, child.id, note.id].includes(file.id));
  const pending = await db.getOutbox();

  assert.equal(localTree.every(file => file.trashed), true);
  assert.deepEqual(pending.map(operation => ({ type: operation.type, fileId: operation.fileId })), [
    { type: "trash", fileId: folder.id }
  ]);

  await engine.sync();
  assert.equal(drive.files.get(folder.id).trashed, true);
  assert.equal(await db.getFile(folder.id), undefined);
  assert.equal(await db.getFile(child.id), undefined);
  assert.equal(await db.getFile(note.id), undefined);
});

test("sincroniza adjuntos de imagen creados offline", async () => {
  const db = new MemoryDb();
  const drive = new MemoryDrive();
  const engine = new SyncEngine({ db, drive, vaultName: "NotesVault" });

  const root = await engine.ensureVault();
  const image = new Blob(["imagen"], { type: "image/png" });
  const localAttachment = await engine.createImageAttachment(root.id, image);

  assert.equal(localAttachment.kind, "attachment");
  assert.equal(localAttachment.mimeType, "image/png");
  assert.equal((await db.getOutbox()).length, 1);

  await engine.sync();
  const attachments = (await engine.getLocalFiles()).filter(file => file.kind === "attachment");

  assert.equal((await db.getOutbox()).length, 0);
  assert.equal(attachments.length, 1);
  assert.equal(attachments[0].mimeType, "image/png");
  assert.equal(attachments[0].blob.size, image.size);
  assert.equal(drive.contents.get(attachments[0].id).size, image.size);
});

test("conserva la versión remota y crea una copia cuando hay conflicto", async () => {
  const db = new MemoryDb();
  const drive = new MemoryDrive();
  const engine = new SyncEngine({ db, drive, vaultName: "NotesVault" });

  const root = await engine.ensureVault();
  const remote = await drive.createMarkdownFile("Plan.md", root.id, "# Plan\n\nVersión A", { notesAppManaged: "v1" });
  await engine.pullRemoteTree(root.id);

  await engine.updateNote(remote.id, "# Plan\n\nCambio local");
  await drive.updateMarkdownContent(remote.id, "# Plan\n\nCambio remoto");
  await engine.sync();

  const notes = (await engine.getLocalFiles()).filter(file => file.kind === "note");
  const original = notes.find(file => file.id === remote.id);
  const conflict = notes.find(file => file.id !== remote.id && file.name.includes("conflicto local"));

  assert.equal((await db.getOutbox()).length, 0);
  assert.equal(original.content, "# Plan\n\nCambio remoto");
  assert.ok(conflict);
  assert.equal(conflict.content, "# Plan\n\nCambio local");
  assert.equal(drive.contents.get(conflict.id), "# Plan\n\nCambio local");
});

test("importa el contenido de la carpeta seleccionada sin crear una carpeta raíz extra", async () => {
  const db = new MemoryDb();
  const drive = new MemoryDrive();
  const engine = new SyncEngine({ db, drive, vaultName: "NotesVault" });

  const root = await engine.ensureVault();
  const files = [
    { name: "Inicio.md", type: "text/markdown", webkitRelativePath: "aa/Inicio.md", text: async () => "# Inicio" },
    { name: "Proyecto.md", type: "text/markdown", webkitRelativePath: "aa/Proyectos/Proyecto.md", text: async () => "# Proyecto" }
  ];

  await engine.importMarkdownFiles(files, root.id);
  const localFiles = await engine.getLocalFiles();

  assert.equal(localFiles.some(file => file.kind === "folder" && file.name === "aa"), false);
  assert.ok(localFiles.find(file => file.kind === "note" && file.path === "Inicio.md"));
  assert.ok(localFiles.find(file => file.kind === "folder" && file.path === "Proyectos"));
  assert.ok(localFiles.find(file => file.kind === "note" && file.path === "Proyectos/Proyecto.md"));
});

test("emite progreso al descargar notas remotas", async () => {
  const db = new MemoryDb();
  const drive = new MemoryDrive();
  const engine = new SyncEngine({ db, drive, vaultName: "NotesVault", maxDownloadConcurrency: 2 });
  const progress = [];

  const root = await engine.ensureVault();
  await drive.createMarkdownFile("Uno.md", root.id, "# Uno", { notesAppManaged: "v1" });
  await drive.createMarkdownFile("Dos.md", root.id, "# Dos", { notesAppManaged: "v1" });
  await drive.createMarkdownFile("Tres.md", root.id, "# Tres", { notesAppManaged: "v1" });
  engine.addEventListener("progress", event => {
    if (event.detail.phase === "download") progress.push(`${event.detail.current}/${event.detail.total}`);
  });

  await engine.pullRemoteTree(root.id);
  const notes = (await engine.getLocalFiles()).filter(file => file.kind === "note");

  assert.deepEqual(progress, ["0/3", "1/3", "2/3", "3/3"]);
  assert.equal(notes.length, 3);
  assert.equal(notes.every(note => note.content?.startsWith("# ")), true);
});

test("bloquea la sincronización al autorizar otra cuenta y conserva la cola", async () => {
  const db = new MemoryDb();
  const drive = new MemoryDrive();
  const engine = new SyncEngine({ db, drive, vaultName: "NotesVault" });

  const root = await engine.ensureVault();
  await db.setSetting("googleAccountPermissionId", "account-a");
  await engine.createNote(root.id, "Privada", "# Privada\n\nNo mezclar");
  const beforeRemoteCount = drive.files.size;

  drive.currentUser = { permissionId: "account-b", displayName: "Cuenta B", emailAddress: "b@example.test" };
  await assert.rejects(() => engine.sync(), error => error?.code === "account_mismatch");

  assert.equal((await db.getOutbox()).length, 1);
  assert.equal(drive.files.size, beforeRemoteCount);
  assert.equal((await db.getFile((await db.getOutbox())[0].fileId)).content, "# Privada\n\nNo mezclar");
});
