import { NINJUTSU_PROGRAM } from "./ninjutsu-program.js";

export const PROGRAM_EXPORT_FOLDER_NAME = `Programación ${NINJUTSU_PROGRAM.id}`;

const WEEKDAY_LABELS = { lunes: "Lunes", miercoles: "Miércoles" };

function parseIsoDate(value) {
  const [year, month, day] = String(value).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function formatSessionDate(session, { long = false } = {}) {
  const date = parseIsoDate(session.date);
  return date.toLocaleDateString("es-ES", long
    ? { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }
    : { day: "numeric", month: "short", timeZone: "UTC" });
}

export function programSessions(program = NINJUTSU_PROGRAM) {
  return program.trimesters.flatMap(trimester => trimester.weeks.flatMap(week => week.sessions.map(session => ({
    ...session,
    trimesterId: trimester.id,
    trimesterName: trimester.name,
    dayLabel: WEEKDAY_LABELS[session.day] ?? session.day
  }))));
}

export function findProgramSession(code, program = NINJUTSU_PROGRAM) {
  return programSessions(program).find(session => session.code === code) ?? null;
}

export function currentOrNextSession(today = new Date().toLocaleDateString("sv-SE"), program = NINJUTSU_PROGRAM) {
  const sessions = programSessions(program);
  return sessions.find(session => session.date >= today) ?? sessions.at(-1) ?? null;
}

export function itemsFromText(text = "") {
  return String(text)
    .replaceAll("\r\n", "\n")
    .split("\n")
    .map(line => line.replace(/^\s*(?:[-*+•]|\d+[.)])\s+/, "").trim())
    .filter(Boolean);
}

function cloneParts(parts = []) {
  return parts.map(part => ({ name: part.name, minutes: part.minutes, items: [...part.items] }));
}

export function createSessionEdit(session) {
  return { parts: cloneParts(session.parts), notes: "", updatedAt: null };
}

export function effectiveSession(session, edit = null) {
  if (!edit) return { ...session, parts: cloneParts(session.parts), notes: "" };
  return { ...session, parts: cloneParts(edit.parts?.length ? edit.parts : session.parts), notes: String(edit.notes ?? "") };
}

export function isSessionEdited(session, edit = null) {
  if (!edit) return false;
  if (String(edit.notes ?? "").trim()) return true;
  const parts = edit.parts ?? session.parts;
  if (parts.length !== session.parts.length) return true;
  return parts.some((part, index) => {
    const base = session.parts[index];
    return part.name !== base.name || part.items.length !== base.items.length || part.items.some((item, itemIndex) => item !== base.items[itemIndex]);
  });
}

export function addedItems(basePart, items = []) {
  const original = new Set(basePart?.items ?? []);
  return new Set(items.filter(item => !original.has(item)));
}

export function sessionExportBaseName(session) {
  return `${session.date} - ${session.code} - ${session.title}`;
}

export function findExportedSessionNote(files = [], folder, session, edit = null) {
  const live = files.filter(file => file.kind === "note" && !file.trashed);
  const byId = edit?.exportedFileId ? live.find(file => file.id === edit.exportedFileId) : null;
  if (byId) return byId;
  if (!folder) return null;
  const prefix = `${session.date} - ${session.code} -`;
  return live.find(file => file.parentId === folder.id && String(file.name).startsWith(prefix)) ?? null;
}

export function sessionToMarkdown(session, edit = null, program = NINJUTSU_PROGRAM) {
  const effective = effectiveSession(session, edit);
  const dayLabel = WEEKDAY_LABELS[session.day] ?? session.day;
  const lines = [
    "---",
    "tipo: entrenamiento",
    "area: ninjutsu",
    `programa: ${program.id}`,
    `sesion: ${session.code}`,
    `semana: ${session.week}`,
    `fecha: ${session.date}`,
    `dia: ${session.day}`,
    `instructor: ${session.instructor}${session.provisional ? " (provisional)" : ""}`,
    "---",
    `# ${session.code} · ${session.title}`,
    "",
    `${dayLabel}, ${formatSessionDate(session, { long: true }).replace(/^[^,]+,\s*/, "")} · 21:00–22:30 · Imparte ${session.instructor}${session.provisional ? " (provisional)" : ""}`,
    ""
  ];
  if (session.nonTeaching) lines.push("> Día no lectivo en la UVa: confirmar si hay clase o trasladar la sesión.", "");
  for (const part of effective.parts) {
    lines.push(`## ${part.name}${part.minutes ? ` (${part.minutes}′)` : ""}`);
    lines.push(...(part.items.length ? part.items.map(item => `- ${item}`) : ["- "]));
    lines.push("");
  }
  if (session.levels?.length) {
    lines.push("## Niveles");
    lines.push(...session.levels.map(level => `- **${level.grades}:** ${level.text}`));
    lines.push("");
  }
  if (session.reviews?.length) {
    lines.push("## Repaso espaciado");
    lines.push(...session.reviews.map(review => `- ${review.topic}: último trabajo hace ${review.gap}`));
    lines.push("");
  }
  if (session.note) lines.push(`> ${session.note}`, "");
  lines.push("## Notas del entrenamiento");
  lines.push(effective.notes.trim() || "- ");
  lines.push("");
  return lines.join("\n");
}

export { NINJUTSU_PROGRAM };
