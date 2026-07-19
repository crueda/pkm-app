export const MIME_FOLDER = "application/vnd.google-apps.folder";
export const MIME_MARKDOWN = "text/markdown";

export function createId(prefix = "local") {
  const uuid = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}:${uuid}`;
}

export function debounce(fn, waitMs = 300) {
  let timer = null;
  const wrapped = (...args) => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, waitMs);
  };
  wrapped.flush = (...args) => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    return fn(...args);
  };
  wrapped.cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  return wrapped;
}

export function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export const escapeAttribute = escapeHtml;

export function normalizeLineEndings(value = "") {
  return String(value).replace(/\r\n?/g, "\n");
}

export function basenameWithoutExtension(name = "") {
  return String(name).replace(/\.md$/i, "");
}

export function isMarkdownFile(fileOrName) {
  const name = typeof fileOrName === "string" ? fileOrName : fileOrName?.name ?? "";
  const mimeType = typeof fileOrName === "object" ? fileOrName?.mimeType ?? fileOrName?.type : "";
  return /\.md$/i.test(name) || mimeType === MIME_MARKDOWN || mimeType === "text/plain";
}

export function formatDateTime(value) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("es", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

export function formatRelativeTime(value, now = Date.now()) {
  if (!value) return "";
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return "";
  const seconds = Math.round((timestamp - now) / 1000);
  const abs = Math.abs(seconds);
  const formatter = new Intl.RelativeTimeFormat("es", { numeric: "auto" });
  if (abs < 60) return formatter.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return formatter.format(days, "day");
  const months = Math.round(days / 30);
  if (Math.abs(months) < 12) return formatter.format(months, "month");
  return formatter.format(Math.round(months / 12), "year");
}

export function safeUrl(rawUrl = "") {
  const value = String(rawUrl).trim();
  if (!value) return null;
  if (value.startsWith("#") || value.startsWith("/")) return value;
  try {
    const parsed = new URL(value, "https://local.invalid/");
    if (["https:", "http:", "mailto:"].includes(parsed.protocol)) return value;
  } catch {
    return null;
  }
  return null;
}

export function textToUint8Array(text) {
  return new TextEncoder().encode(String(text));
}

export function uint8ArrayToText(value) {
  return new TextDecoder().decode(value);
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function humanFileSize(bytes) {
  const amount = Number(bytes);
  if (!Number.isFinite(amount) || amount <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(amount) / Math.log(1024)), units.length - 1);
  const number = amount / 1024 ** index;
  return `${number.toFixed(number >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}
