import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { NINJUTSU_PROGRAM as currentProgram } from "../app/src/ninjutsu-program.js";

const markdownPath = process.argv[2];
const shouldWrite = process.argv.includes("--write");

if (!markdownPath) {
  throw new Error("Uso: node scripts/ingest-ninjutsu-program.mjs <programacion.md> [--write]");
}

const markdown = await readFile(resolve(markdownPath), "utf8");
if (!markdown.trim()) {
  throw new Error("El Markdown de entrada está vacío.");
}

const lines = markdown.replaceAll("\r\n", "\n").split("\n");
const currentSessions = new Map(
  currentProgram.trimesters.flatMap(trimester => trimester.weeks)
    .flatMap(week => week.sessions)
    .map(session => [session.code, session])
);

const trimesterDefinitions = new Map([
  ["### Primer trimestre", { id: "t1", name: "Primer trimestre" }],
  ["### Segundo trimestre", { id: "t2", name: "Segundo trimestre" }],
  ["### Tercer trimestre", { id: "t3", name: "Tercer trimestre" }]
]);
const monthNumbers = new Map([
  ["ene", "01"],
  ["feb", "02"],
  ["mar", "03"],
  ["abr", "04"],
  ["may", "05"],
  ["jun", "06"],
  ["jul", "07"],
  ["ago", "08"],
  ["sep", "09"],
  ["oct", "10"],
  ["nov", "11"],
  ["dic", "12"]
]);

const parsedTrimesters = [];
let activeTrimester = null;

function nextNonEmptyLine(start) {
  for (let index = start; index < lines.length; index += 1) {
    if (lines[index].trim()) return lines[index].trim();
  }
  return "";
}

function isSessionStart(line) {
  return /^(Lunes|Miércoles)\s+.+[LX]\d+$/.test(line);
}

function sessionEndIndex(start) {
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (isSessionStart(line) || trimesterDefinitions.has(line) || line.startsWith("## Mapa de repasos")) {
      return index;
    }
  }
  return lines.length;
}

function cancelledReason(code) {
  if (code === "L42") return "festivo del 12 de octubre.";
  if (code === "L45") return "festivo del 2 de noviembre.";
  return "festivo.";
}

function parseSession(start, trimesterId) {
  const startLine = lines[start].trim();
  const startMatch = startLine.match(/^(Lunes|Miércoles)\s+(\d{1,2})\s+([a-záéíóú]+)([LX]\d+)$/i);
  const code = startMatch?.[4];
  if (!code || !monthNumbers.has(startMatch[3].toLowerCase())) {
    throw new Error(`No se pudo relacionar la sesión de la línea ${start + 1}: ${startLine}`);
  }

  const week = Number(code.slice(1));
  const year = week >= 40 ? 2026 : 2027;
  const month = monthNumbers.get(startMatch[3].toLowerCase());
  const date = `${year}-${month}-${startMatch[2].padStart(2, "0")}`;
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const expectedWeekday = code.startsWith("L") ? 1 : 3;
  if (weekday !== expectedWeekday) {
    throw new Error(`La fecha ${date} de ${code} no cae en el día esperado.`);
  }

  const end = sessionEndIndex(start);
  let titleIndex = start + 1;
  while (titleIndex < end && !lines[titleIndex].trim().startsWith("#### ")) titleIndex += 1;
  if (titleIndex >= end) throw new Error(`La sesión ${code} no tiene título.`);

  const session = {
    code,
    week,
    day: code.startsWith("L") ? "lunes" : "miercoles",
    date,
    title: lines[titleIndex].trim().slice(5),
    instructor: undefined,
    provisional: trimesterId !== "t1",
    parts: []
  };

  const notes = [];
  let activePart = null;
  let readingReviews = false;
  let pendingLevel = null;

  for (let index = titleIndex + 1; index < end; index += 1) {
    const line = lines[index].trim();
    if (!line || line.startsWith("Semana ")) continue;

    if (line.startsWith("Imparte ")) {
      session.instructor = line.slice("Imparte ".length);
      activePart = null;
      readingReviews = false;
      continue;
    }
    if (line === "Impartida") {
      session.done = true;
      continue;
    }
    if (line === "Reparto provisional") {
      session.provisional = true;
      continue;
    }
    if (line === "Sin entrenamiento") {
      session.cancelled = true;
      continue;
    }
    if (line.startsWith("Día no lectivo en la UVa")) {
      session.nonTeaching = true;
      continue;
    }
    if (/festivo\..*No hay clase\.$/.test(line)) {
      session.cancelled = true;
      session.cancelledReason = cancelledReason(code);
      continue;
    }

    const partMatch = line.match(/^##### (.+?)(?:(\d+)′|—)$/);
    if (partMatch) {
      activePart = {
        name: partMatch[1],
        minutes: partMatch[2] ? Number(partMatch[2]) : 0,
        items: []
      };
      session.parts.push(activePart);
      readingReviews = false;
      pendingLevel = null;
      continue;
    }

    const levelMatch = line.match(/^(10º–7º|6º–5º|4º–2º)$/);
    if (levelMatch) {
      session.levels ??= [];
      pendingLevel = levelMatch[1];
      activePart = null;
      readingReviews = false;
      continue;
    }
    if (pendingLevel && line.startsWith(":   ")) {
      session.levels.push({ grades: pendingLevel, text: line.slice(4) });
      pendingLevel = null;
      continue;
    }

    if (line === "Repaso espaciado · último trabajo hace") {
      session.reviews = [];
      activePart = null;
      readingReviews = true;
      pendingLevel = null;
      continue;
    }

    if (line.startsWith("* ")) {
      const item = line.slice(2);
      if (activePart) {
        activePart.items.push(item);
        continue;
      }
      if (readingReviews) {
        const reviewMatch = item.match(/^(.+?)(\d+ sem\.|misma semana)$/);
        if (!reviewMatch) throw new Error(`Repaso no reconocido en ${code}: ${line}`);
        session.reviews.push({ topic: reviewMatch[1], gap: reviewMatch[2] });
        continue;
      }
      throw new Error(`Elemento fuera de un bloque en ${code}: ${line}`);
    }

    if (line.startsWith("#### ") || line.startsWith("### ") || line.startsWith("## ")) continue;
    notes.push(line);
    activePart = null;
    readingReviews = false;
    pendingLevel = null;
  }

  if (session.cancelled && !session.cancelledReason) {
    session.cancelledReason = cancelledReason(code);
  }
  if (notes.length) session.note = notes.join("\n\n");
  if (!session.levels?.length) delete session.levels;
  if (!session.reviews?.length) delete session.reviews;

  return { session, end };
}

for (let index = 0; index < lines.length; index += 1) {
  const line = lines[index].trim();
  const trimesterDefinition = trimesterDefinitions.get(line);
  if (trimesterDefinition) {
    activeTrimester = {
      ...trimesterDefinition,
      summary: nextNonEmptyLine(index + 1),
      sessions: []
    };
    parsedTrimesters.push(activeTrimester);
    continue;
  }
  if (!activeTrimester || !isSessionStart(line)) continue;
  const parsed = parseSession(index, activeTrimester.id);
  activeTrimester.sessions.push(parsed.session);
  index = parsed.end - 1;
}

const trimesters = parsedTrimesters.map(trimester => {
  const weeks = [];
  for (const session of trimester.sessions) {
    let week = weeks.at(-1);
    if (!week || week.week !== session.week) {
      week = { week: session.week, sessions: [] };
      weeks.push(week);
    }
    week.sessions.push(session);
  }
  return {
    id: trimester.id,
    name: trimester.name,
    summary: trimester.summary,
    weeks
  };
});

for (const trimester of trimesters) {
  for (const week of trimester.weeks) {
    const instructor = week.sessions.find(session => session.instructor)?.instructor;
    if (!instructor) throw new Error(`No se encontró instructor para la semana ${week.week}.`);
    for (const session of week.sessions) session.instructor ??= instructor;
  }
}

const program = {
  id: currentProgram.id,
  title: "Programación anual 2026–2027",
  subtitle: "Nin Jutsu Budo Taijutsu · 10º a 2º Kyu · lunes y miércoles de 21:00 a 22:30",
  source: "Programa de Grados BCD, edición 2024",
  trimesters
};

const sessions = trimesters.flatMap(trimester => trimester.weeks).flatMap(week => week.sessions);
const weeks = trimesters.flatMap(trimester => trimester.weeks);
const codes = sessions.map(session => session.code);
const duplicateCodes = codes.filter((code, index) => codes.indexOf(code) !== index);
const invalidParts = sessions.filter(session => !session.parts.length || session.parts.some(part => !part.name || !Array.isArray(part.items)));
if (trimesters.length !== 3 || weeks.length !== 30 || sessions.length !== 60 || duplicateCodes.length || invalidParts.length) {
  throw new Error(JSON.stringify({ trimesters: trimesters.length, weeks: weeks.length, sessions: sessions.length, duplicateCodes, invalidParts: invalidParts.map(session => session.code) }));
}

const changedSessions = sessions.filter(session => JSON.stringify(session) !== JSON.stringify(currentSessions.get(session.code)));
const notes = sessions.filter(session => session.note).map(session => ({ code: session.code, note: session.note }));
const report = {
  markdown: resolve(markdownPath),
  trimesters: trimesters.length,
  weeks: weeks.length,
  sessions: sessions.length,
  changedSessions: changedSessions.length,
  cancelled: sessions.filter(session => session.cancelled).map(session => session.code),
  nonTeaching: sessions.filter(session => session.nonTeaching).map(session => session.code),
  notes
};

if (shouldWrite) {
  const destination = resolve("app/src/ninjutsu-program.js");
  const source = `// Generado a partir de «Programación anual 2026–2027 · Nin Jutsu Budo Taijutsu v4.html», convertido y validado como Markdown.\n// Contenido base de solo lectura: las modificaciones del usuario se guardan aparte.\nexport const NINJUTSU_PROGRAM = Object.freeze(${JSON.stringify(program, null, 2)});\n`;
  await writeFile(destination, source, "utf8");
  report.written = destination;
}

console.log(JSON.stringify(report, null, 2));
