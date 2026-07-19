const DATABASE_NAME = "notas-drive-pwa";
const DATABASE_VERSION = 1;

function requestAsPromise(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error ?? new Error("Error de IndexedDB")), { once: true });
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener("abort", () => reject(transaction.error ?? new Error("Transacción cancelada")), { once: true });
    transaction.addEventListener("error", () => reject(transaction.error ?? new Error("Error de transacción")), { once: true });
  });
}

export class LocalDatabase {
  #databasePromise = null;

  async open() {
    if (this.#databasePromise) return this.#databasePromise;
    this.#databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.addEventListener("upgradeneeded", () => {
        const database = request.result;
        if (!database.objectStoreNames.contains("files")) {
          const files = database.createObjectStore("files", { keyPath: "id" });
          files.createIndex("parentId", "parentId", { unique: false });
          files.createIndex("kind", "kind", { unique: false });
          files.createIndex("path", "path", { unique: false });
          files.createIndex("dirty", "dirty", { unique: false });
        }
        if (!database.objectStoreNames.contains("settings")) {
          database.createObjectStore("settings", { keyPath: "key" });
        }
        if (!database.objectStoreNames.contains("outbox")) {
          const outbox = database.createObjectStore("outbox", { keyPath: "opId" });
          outbox.createIndex("createdAt", "createdAt", { unique: false });
          outbox.createIndex("fileId", "fileId", { unique: false });
          outbox.createIndex("type", "type", { unique: false });
        }
      });
      request.addEventListener("success", () => {
        const database = request.result;
        database.addEventListener("versionchange", () => database.close());
        resolve(database);
      }, { once: true });
      request.addEventListener("error", () => reject(request.error ?? new Error("No se pudo abrir IndexedDB")), { once: true });
      request.addEventListener("blocked", () => reject(new Error("IndexedDB está bloqueado por otra pestaña")), { once: true });
    });
    return this.#databasePromise;
  }

  async getAllFiles() {
    const database = await this.open();
    const transaction = database.transaction("files", "readonly");
    return requestAsPromise(transaction.objectStore("files").getAll());
  }

  async getFile(id) {
    const database = await this.open();
    const transaction = database.transaction("files", "readonly");
    return requestAsPromise(transaction.objectStore("files").get(id));
  }

  async getChildren(parentId) {
    const database = await this.open();
    const transaction = database.transaction("files", "readonly");
    return requestAsPromise(transaction.objectStore("files").index("parentId").getAll(parentId));
  }

  async putFile(file) {
    const database = await this.open();
    const transaction = database.transaction("files", "readwrite");
    transaction.objectStore("files").put(file);
    await transactionDone(transaction);
    return file;
  }

  async putFiles(files) {
    if (!files.length) return;
    const database = await this.open();
    const transaction = database.transaction("files", "readwrite");
    const store = transaction.objectStore("files");
    for (const file of files) store.put(file);
    await transactionDone(transaction);
  }

  async deleteFile(id) {
    const database = await this.open();
    const transaction = database.transaction("files", "readwrite");
    transaction.objectStore("files").delete(id);
    await transactionDone(transaction);
  }

  async deleteFiles(ids) {
    if (!ids.length) return;
    const database = await this.open();
    const transaction = database.transaction("files", "readwrite");
    const store = transaction.objectStore("files");
    for (const id of ids) store.delete(id);
    await transactionDone(transaction);
  }

  async getSetting(key, fallback = null) {
    const database = await this.open();
    const transaction = database.transaction("settings", "readonly");
    const record = await requestAsPromise(transaction.objectStore("settings").get(key));
    return record ? record.value : fallback;
  }

  async setSetting(key, value) {
    const database = await this.open();
    const transaction = database.transaction("settings", "readwrite");
    transaction.objectStore("settings").put({ key, value, updatedAt: new Date().toISOString() });
    await transactionDone(transaction);
    return value;
  }

  async deleteSetting(key) {
    const database = await this.open();
    const transaction = database.transaction("settings", "readwrite");
    transaction.objectStore("settings").delete(key);
    await transactionDone(transaction);
  }

  async getOutbox() {
    const database = await this.open();
    const transaction = database.transaction("outbox", "readonly");
    const records = await requestAsPromise(transaction.objectStore("outbox").getAll());
    return records.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  }

  async putOutbox(operation) {
    const database = await this.open();
    const transaction = database.transaction("outbox", "readwrite");
    transaction.objectStore("outbox").put(operation);
    await transactionDone(transaction);
    return operation;
  }

  async deleteOutbox(opId) {
    const database = await this.open();
    const transaction = database.transaction("outbox", "readwrite");
    transaction.objectStore("outbox").delete(opId);
    await transactionDone(transaction);
  }

  async deleteOutboxMany(opIds) {
    if (!opIds.length) return;
    const database = await this.open();
    const transaction = database.transaction("outbox", "readwrite");
    const store = transaction.objectStore("outbox");
    for (const opId of opIds) store.delete(opId);
    await transactionDone(transaction);
  }

  async clearOutboxForFile(fileId) {
    const operations = await this.getOutbox();
    await this.deleteOutboxMany(operations.filter(operation => operation.fileId === fileId).map(operation => operation.opId));
  }

  async replaceLocalId(localId, remoteFile) {
    const files = await this.getAllFiles();
    const operations = await this.getOutbox();
    const current = files.find(file => file.id === localId);
    if (!current) return;

    const updatedFiles = files
      .filter(file => file.id !== localId)
      .map(file => file.parentId === localId ? { ...file, parentId: remoteFile.id } : file);
    updatedFiles.push({
      ...current,
      ...remoteFile,
      id: remoteFile.id,
      parentId: remoteFile.parentId ?? current.parentId,
      dirty: false,
      isLocalOnly: false
    });

    const updatedOperations = operations.map(operation => ({
      ...operation,
      fileId: operation.fileId === localId ? remoteFile.id : operation.fileId,
      parentId: operation.parentId === localId ? remoteFile.id : operation.parentId
    }));

    const database = await this.open();
    const transaction = database.transaction(["files", "outbox"], "readwrite");
    const filesStore = transaction.objectStore("files");
    const outboxStore = transaction.objectStore("outbox");
    filesStore.delete(localId);
    for (const file of updatedFiles) filesStore.put(file);
    for (const operation of updatedOperations) outboxStore.put(operation);
    await transactionDone(transaction);
  }

  async resetAll() {
    const database = await this.open();
    const transaction = database.transaction(["files", "settings", "outbox"], "readwrite");
    transaction.objectStore("files").clear();
    transaction.objectStore("settings").clear();
    transaction.objectStore("outbox").clear();
    await transactionDone(transaction);
  }
}
