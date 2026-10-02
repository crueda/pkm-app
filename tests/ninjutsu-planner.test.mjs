import test from "node:test";
import assert from "node:assert/strict";

import {
  addedItems,
  createSessionEdit,
  currentOrNextSession,
  effectiveSession,
  findExportedSessionNote,
  findProgramSession,
  isSessionEdited,
  itemsFromText,
  NINJUTSU_PROGRAM,
  PROGRAM_EXPORT_FOLDER_NAME,
  programSessions,
  sessionExportBaseName,
  sessionToMarkdown
} from "../app/src/ninjutsu-planner.js";

test("incluye las 60 sesiones de la programación con fechas de lunes y miércoles", () => {
  const sessions = programSessions();
  assert.equal(sessions.length, 60);
  assert.equal(NINJUTSU_PROGRAM.trimesters.length, 3);
  assert.deepEqual(sessions.slice(0, 2).map(session => [session.code, session.date, session.day]), [
    ["L40", "2026-09-28", "lunes"],
    ["X40", "2026-09-30", "miercoles"]
  ]);
  assert.deepEqual([sessions.at(-1).code, sessions.at(-1).date], ["X21", "2027-05-26"]);
  for (const session of sessions) {
    const weekday = new Date(`${session.date}T12:00:00Z`).getUTCDay();
    assert.equal(weekday, session.day === "lunes" ? 1 : 3, session.code);
    assert.ok(session.parts.length >= 4, session.code);
  }
});

test("conserva instructor, días no lectivos y repasos", () => {
  const l42 = findProgramSession("L42");
  assert.equal(l42.instructor, "Julio");
  assert.equal(l42.nonTeaching, true);
  assert.equal(findProgramSession("L2").provisional, true);
  assert.ok(findProgramSession("L41").reviews.some(review => review.topic.startsWith("Kamae")));
  assert.equal(findProgramSession("nada"), null);
});

test("elige la próxima sesión a partir de la fecha", () => {
  assert.equal(currentOrNextSession("2026-10-03").code, "L41");
  assert.equal(currentOrNextSession("2026-10-05").code, "L41");
  assert.equal(currentOrNextSession("2026-12-20").code, "L2");
  assert.equal(currentOrNextSession("2027-07-01").code, "X21");
});

test("convierte texto en elementos y detecta lo añadido", () => {
  assert.deepEqual(itemsFromText("- uno\n\n2. dos\r\n  tres  \n* cuatro"), ["uno", "dos", "tres", "cuatro"]);
  const session = findProgramSession("L41");
  const edit = createSessionEdit(session);
  assert.equal(isSessionEdited(session, edit), false);
  edit.parts[0].items.push("Juego de reflejos");
  assert.equal(isSessionEdited(session, edit), true);
  assert.deepEqual([...addedItems(session.parts[0], edit.parts[0].items)], ["Juego de reflejos"]);
  assert.equal(findProgramSession("L41").parts[0].items.includes("Juego de reflejos"), false);
  const notesOnly = { ...createSessionEdit(session), notes: "Asistentes: 8" };
  assert.equal(isSessionEdited(session, notesOnly), true);
  assert.equal(effectiveSession(session, notesOnly).notes, "Asistentes: 8");
});

test("exporta la sesión editada como nota de entrenamiento", () => {
  const session = findProgramSession("L41");
  const edit = createSessionEdit(session);
  edit.parts[1].items.push("Ukemi extra");
  edit.notes = "- Asistentes: 8";
  const markdown = sessionToMarkdown(session, edit);
  assert.match(markdown, /^---\ntipo: entrenamiento\n/);
  assert.match(markdown, /sesion: L41/);
  assert.match(markdown, /fecha: 2026-10-05/);
  assert.match(markdown, /instructor: Carlos/);
  assert.match(markdown, /# L41 · Kihon happo I: Ichimonji no kata/);
  assert.match(markdown, /## Taihen jutsu \(15′\)\n(- .+\n)*- Ukemi extra\n/);
  assert.match(markdown, /## Niveles\n- \*\*10º–7º:\*\*/);
  assert.match(markdown, /## Notas del entrenamiento\n- Asistentes: 8\n/);
  assert.match(sessionToMarkdown(findProgramSession("L42")), /Día no lectivo/);
  assert.equal(sessionExportBaseName(session), "2026-10-05 - L41 - Kihon happo I: Ichimonji no kata");
  assert.equal(PROGRAM_EXPORT_FOLDER_NAME, "Programación 2026-2027");
});

test("localiza una exportación previa por id o por prefijo de nombre", () => {
  const session = findProgramSession("L41");
  const folder = { id: "export", kind: "folder", name: PROGRAM_EXPORT_FOLDER_NAME };
  const files = [
    folder,
    { id: "a", kind: "note", parentId: "export", name: "2026-10-05 - L41 - Kihon happo I- Ichimonji no kata.md" },
    { id: "b", kind: "note", parentId: "otra", name: "suelta.md" },
    { id: "c", kind: "note", parentId: "export", name: "2026-10-05 - L41 - antigua.md", trashed: true }
  ];
  assert.equal(findExportedSessionNote(files, folder, session)?.id, "a");
  assert.equal(findExportedSessionNote(files, folder, session, { exportedFileId: "b" })?.id, "b");
  assert.equal(findExportedSessionNote(files, folder, findProgramSession("X41")), null);
  assert.equal(findExportedSessionNote(files, null, session), null);
});
