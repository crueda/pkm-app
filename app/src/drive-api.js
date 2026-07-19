import { MIME_FOLDER, MIME_MARKDOWN, isMarkdownFile } from "./utils.js";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const FILE_FIELDS = "id,name,mimeType,parents,createdTime,modifiedTime,version,size,md5Checksum,trashed,appProperties,description";

export class DriveApiError extends Error {
  constructor(message, { status = 0, code = "drive_error", details = null } = {}) {
    super(message);
    this.name = "DriveApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class AuthExpiredError extends DriveApiError {
  constructor(message = "La autorización de Google ha caducado") {
    super(message, { status: 401, code: "auth_expired" });
    this.name = "AuthExpiredError";
  }
}

export function escapeDriveQuery(value = "") {
  return String(value).replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}

function fileKind(metadata) {
  if (metadata.mimeType === MIME_FOLDER) return "folder";
  if (isMarkdownFile(metadata)) return "note";
  return "attachment";
}

export function normalizeDriveFile(metadata, extra = {}) {
  return {
    id: metadata.id,
    name: metadata.name,
    mimeType: metadata.mimeType,
    kind: fileKind(metadata),
    parentId: metadata.parents?.[0] ?? null,
    createdTime: metadata.createdTime ?? null,
    modifiedTime: metadata.modifiedTime ?? null,
    remoteVersion: metadata.version != null ? String(metadata.version) : null,
    size: Number(metadata.size ?? 0),
    md5Checksum: metadata.md5Checksum ?? null,
    appProperties: metadata.appProperties ?? {},
    description: metadata.description ?? "",
    trashed: Boolean(metadata.trashed),
    isLocalOnly: false,
    ...extra
  };
}

export class GoogleDriveApi {
  constructor(accessTokenProvider) {
    this.accessTokenProvider = accessTokenProvider;
  }

  async request(url, options = {}) {
    const token = this.accessTokenProvider();
    if (!token) throw new AuthExpiredError("Conecta Google Drive para continuar");

    const headers = new Headers(options.headers ?? {});
    headers.set("Authorization", `Bearer ${token}`);
    const response = await fetch(url, { ...options, headers });

    if (response.status === 401) throw new AuthExpiredError();
    if (!response.ok) {
      let details = null;
      try {
        details = await response.json();
      } catch {
        details = await response.text().catch(() => null);
      }
      const apiMessage = details?.error?.message || details?.message;
      throw new DriveApiError(apiMessage || `Google Drive respondió con ${response.status}`, {
        status: response.status,
        code: details?.error?.status || details?.error?.errors?.[0]?.reason || "drive_error",
        details
      });
    }

    if (response.status === 204) return null;
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) return response.json();
    return response;
  }

  async getCurrentUser() {
    const parameters = new URLSearchParams({
      fields: "user(permissionId,displayName,emailAddress,photoLink)"
    });
    const result = await this.request(`${DRIVE_API}/about?${parameters}`);
    return result.user ?? null;
  }

  async listFiles(query, { orderBy = "folder,name_natural", pageSize = 1000 } = {}) {
    const files = [];
    let pageToken = "";
    do {
      const parameters = new URLSearchParams({
        q: query,
        spaces: "drive",
        fields: `nextPageToken,files(${FILE_FIELDS})`,
        pageSize: String(pageSize),
        orderBy
      });
      if (pageToken) parameters.set("pageToken", pageToken);
      const result = await this.request(`${DRIVE_API}/files?${parameters}`);
      files.push(...(result.files ?? []));
      pageToken = result.nextPageToken ?? "";
    } while (pageToken);
    return files;
  }

  async findVaultRoots(vaultName) {
    const markerQuery = [
      "trashed = false",
      `mimeType = '${MIME_FOLDER}'`,
      "appProperties has { key='notesVaultRoot' and value='v1' }"
    ].join(" and ");
    const marked = await this.listFiles(markerQuery, { orderBy: "createdTime" });
    if (marked.length) return marked;

    const fallbackQuery = [
      "trashed = false",
      `mimeType = '${MIME_FOLDER}'`,
      `'root' in parents`,
      `name = '${escapeDriveQuery(vaultName)}'`
    ].join(" and ");
    return this.listFiles(fallbackQuery, { orderBy: "createdTime" });
  }

  async listChildren(parentId) {
    return this.listFiles(`trashed = false and '${escapeDriveQuery(parentId)}' in parents`);
  }

  async listTree(rootId) {
    const all = [];
    const queue = [rootId];
    while (queue.length) {
      const parentId = queue.shift();
      const children = await this.listChildren(parentId);
      for (const child of children) {
        all.push(child);
        if (child.mimeType === MIME_FOLDER) queue.push(child.id);
      }
    }
    return all;
  }

  async getMetadata(fileId) {
    const parameters = new URLSearchParams({ fields: FILE_FIELDS });
    return this.request(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?${parameters}`);
  }

  async createFolder(name, parentId = null, appProperties = {}) {
    const metadata = {
      name,
      mimeType: MIME_FOLDER,
      appProperties
    };
    if (parentId) metadata.parents = [parentId];
    const parameters = new URLSearchParams({ fields: FILE_FIELDS });
    return this.request(`${DRIVE_API}/files?${parameters}`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify(metadata)
    });
  }

  async createMarkdownFile(name, parentId, content, appProperties = {}) {
    return this.createFile(name, parentId, new Blob([String(content)], { type: `${MIME_MARKDOWN}; charset=UTF-8` }), MIME_MARKDOWN, appProperties);
  }

  async createFile(name, parentId, blob, mimeType = "application/octet-stream", appProperties = {}) {
    const boundary = `notes_${crypto.randomUUID()}`;
    const metadata = {
      name,
      mimeType,
      parents: parentId ? [parentId] : undefined,
      appProperties
    };
    const body = new Blob([
      `--${boundary}\r\n`,
      "Content-Type: application/json; charset=UTF-8\r\n\r\n",
      JSON.stringify(metadata),
      `\r\n--${boundary}\r\n`,
      `Content-Type: ${mimeType}\r\n\r\n`,
      blob,
      `\r\n--${boundary}--`
    ], { type: `multipart/related; boundary=${boundary}` });
    const parameters = new URLSearchParams({ uploadType: "multipart", fields: FILE_FIELDS });
    return this.request(`${DRIVE_UPLOAD_API}/files?${parameters}`, {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body
    });
  }

  async downloadText(fileId) {
    const response = await this.request(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`);
    return response.text();
  }

  async downloadBlob(fileId) {
    const response = await this.request(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`);
    return response.blob();
  }

  async updateMarkdownContent(fileId, content) {
    const parameters = new URLSearchParams({ uploadType: "media", fields: FILE_FIELDS });
    return this.request(`${DRIVE_UPLOAD_API}/files/${encodeURIComponent(fileId)}?${parameters}`, {
      method: "PATCH",
      headers: { "Content-Type": `${MIME_MARKDOWN}; charset=UTF-8` },
      body: String(content)
    });
  }

  async updateMetadata(fileId, metadata) {
    const parameters = new URLSearchParams({ fields: FILE_FIELDS });
    return this.request(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?${parameters}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify(metadata)
    });
  }

  async trash(fileId) {
    return this.updateMetadata(fileId, { trashed: true });
  }
}
