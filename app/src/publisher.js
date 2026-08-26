import { MIME_FOLDER } from "./utils.js";

const SOURCE_PROPERTY = "publishedSourceId";
const ROOT_PROPERTY = "publishedRootSourceId";

function publicationName(source) {
  if (source.kind === "folder") return `${source.name} — publicado`;
  const base = source.name.replace(/\.md$/i, "");
  return `${base} — publicada.md`;
}

function publicationProperties(sourceId, rootSourceId, kind) {
  return {
    [SOURCE_PROPERTY]: sourceId,
    [ROOT_PROPERTY]: rootSourceId,
    publicationKind: kind,
    managedByNotesDrive: "v1"
  };
}

function descendantsOf(folder, files) {
  const descendants = [];
  const pendingParents = [folder.id];
  while (pendingParents.length) {
    const parentId = pendingParents.shift();
    for (const file of files.filter(candidate => !candidate.trashed && candidate.parentId === parentId)) {
      descendants.push(file);
      if (file.kind === "folder") pendingParents.push(file.id);
    }
  }
  return descendants;
}

export class DrivePublisher {
  constructor(drive) {
    this.drive = drive;
  }

  async findPublication(sourceId) {
    const escaped = String(sourceId).replaceAll("\\", "\\\\").replaceAll("'", "\\'");
    const files = await this.drive.listFiles(
      `trashed = false and appProperties has { key='${SOURCE_PROPERTY}' and value='${escaped}' }`,
      { orderBy: "modifiedTime desc" }
    );
    return files[0] ?? null;
  }

  async publishNote(note) {
    const properties = publicationProperties(note.id, note.id, "note");
    const name = publicationName(note);
    let published = await this.findPublication(note.id);
    if (published) {
      published = await this.drive.updateMetadata(published.id, { name, appProperties: properties });
      published = await this.drive.updateMarkdownContent(published.id, note.content ?? "");
    } else {
      published = await this.drive.createMarkdownFile(name, null, note.content ?? "", properties);
    }
    const url = await this.drive.allowAnyoneWithLink(published.id);
    return { id: published.id, url, name, kind: "note", updated: true };
  }

  async publishFolder(folder, files) {
    const properties = publicationProperties(folder.id, folder.id, "folder");
    const name = publicationName(folder);
    let publishedRoot = await this.findPublication(folder.id);
    if (publishedRoot?.mimeType !== MIME_FOLDER) publishedRoot = null;
    if (publishedRoot) {
      publishedRoot = await this.drive.updateMetadata(publishedRoot.id, { name, appProperties: properties });
    } else {
      publishedRoot = await this.drive.createFolder(name, null, properties);
    }

    const sourceItems = descendantsOf(folder, files);
    const existingItems = await this.drive.listTree(publishedRoot.id);
    const existingBySource = new Map(existingItems
      .filter(item => item.appProperties?.[ROOT_PROPERTY] === folder.id)
      .map(item => [item.appProperties?.[SOURCE_PROPERTY], item]));
    const publishedBySource = new Map([[folder.id, publishedRoot]]);
    let publishedCount = 0;

    for (const source of sourceItems) {
      const parent = publishedBySource.get(source.parentId);
      if (!parent) continue;
      const itemProperties = publicationProperties(source.id, folder.id, source.kind);
      let target = existingBySource.get(source.id);
      if (source.kind === "folder") {
        if (target?.mimeType === MIME_FOLDER) {
          target = await this.drive.updateMetadata(target.id, { name: source.name, appProperties: itemProperties });
          if (target.parents?.[0] !== parent.id) target = await this.drive.moveFile(target.id, target.parents?.[0], parent.id);
        } else {
          if (target) await this.drive.trash(target.id);
          target = await this.drive.createFolder(source.name, parent.id, itemProperties);
        }
        publishedBySource.set(source.id, target);
      } else if (source.kind === "note") {
        if (target && target.mimeType !== MIME_FOLDER) {
          target = await this.drive.updateMetadata(target.id, { name: source.name, appProperties: itemProperties });
          if (target.parents?.[0] !== parent.id) target = await this.drive.moveFile(target.id, target.parents?.[0], parent.id);
          await this.drive.updateMarkdownContent(target.id, source.content ?? "");
        } else {
          if (target) await this.drive.trash(target.id);
          target = await this.drive.createMarkdownFile(source.name, parent.id, source.content ?? "", itemProperties);
        }
        publishedCount += 1;
      } else {
        const blob = source.blob ?? await this.drive.downloadBlob(source.id);
        if (target && target.mimeType !== MIME_FOLDER) {
          target = await this.drive.updateMetadata(target.id, { name: source.name, appProperties: itemProperties });
          if (target.parents?.[0] !== parent.id) target = await this.drive.moveFile(target.id, target.parents?.[0], parent.id);
          await this.drive.updateFileContent(target.id, blob, source.mimeType);
        } else {
          if (target) await this.drive.trash(target.id);
          target = await this.drive.createFile(source.name, parent.id, blob, source.mimeType, itemProperties);
        }
        publishedCount += 1;
      }
    }

    const liveSourceIds = new Set(sourceItems.map(item => item.id));
    for (const existing of existingItems) {
      const sourceId = existing.appProperties?.[SOURCE_PROPERTY];
      if (existing.appProperties?.[ROOT_PROPERTY] === folder.id && sourceId && !liveSourceIds.has(sourceId)) {
        await this.drive.trash(existing.id);
      }
    }

    const url = await this.drive.allowAnyoneWithLink(publishedRoot.id);
    return { id: publishedRoot.id, url, name, kind: "folder", publishedCount, updated: true };
  }
}

export { descendantsOf, publicationName };
