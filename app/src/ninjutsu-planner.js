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
    return part.name !== base.name || Number(part.minutes) !== Number(base.minutes) || part.items.length !== base.items.length || part.items.some((item, itemIndex) => item !== base.items[itemIndex]);
  });
}

export function addedItems(basePart, items = []) {
  const original = new Set(basePart?.items ?? []);
  return new Set(items.filter(item => !original.has(item)));
}

export function parseMinutes(value, fallback = 0) {
  const minutes = Math.round(Number(String(value).replace(",", ".")));
  return Number.isFinite(minutes) && minutes >= 0 && minutes <= 600 ? minutes : fallback;
}

export function sessionTotalMinutes(parts = []) {
  return parts.reduce((total, part) => total + (Number(part.minutes) || 0), 0);
}

// Sitúa el tiempo transcurrido dentro de los bloques de la sesión.
export function trainingTimerState(parts = [], elapsedMs = 0) {
  const elapsed = Math.max(0, Number(elapsedMs) || 0);
  const totalMs = sessionTotalMinutes(parts) * 60000;
  let start = 0;
  for (let index = 0; index < parts.length; index += 1) {
    const durationMs = (Number(parts[index].minutes) || 0) * 60000;
    if (durationMs > 0 && elapsed < start + durationMs) {
      return {
        index,
        part: parts[index],
        next: parts.slice(index + 1).find(part => Number(part.minutes) > 0) ?? null,
        partElapsedMs: elapsed - start,
        partRemainingMs: start + durationMs - elapsed,
        partDurationMs: durationMs,
        partStartMs: start,
        elapsedMs: elapsed,
        totalMs,
        remainingMs: totalMs - elapsed,
        finished: false
      };
    }
    start += durationMs;
  }
  return { index: parts.length, part: null, next: null, partElapsedMs: 0, partRemainingMs: 0, partDurationMs: 0, partStartMs: totalMs, elapsedMs: elapsed, totalMs, remainingMs: 0, overtimeMs: elapsed - totalMs, finished: true };
}

export function timerElapsedMs(timer, now = Date.now()) {
  if (!timer) return 0;
  const running = timer.pausedAt ? timer.pausedAt : now;
  return Math.max(0, running - timer.startedAt - (timer.pausedMs || 0));
}

export function formatClock(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = value => String(value).padStart(2, "0");
  return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
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
