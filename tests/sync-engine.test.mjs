import test from "node:test";
import assert from "node:assert/strict";

import { SyncEngine } from "../app/src/sync-engine.js";
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
    return structuredClone(next);
  }

  async downloadText(id) { return this.contents.get(id) ?? ""; }

  async listTree(rootId) {
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
