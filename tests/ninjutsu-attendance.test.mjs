import test from "node:test";
import assert from "node:assert/strict";

import {
  attendanceRows,
  createStudent,
  gradeLabel,
  gradeMatchesRange,
  normalizeAttendance,
  normalizeRoster,
  sessionAttendanceSummary,
  studentProgress,
  updateAttendance
} from "../app/src/ninjutsu-attendance.js";
import { programSessions } from "../app/src/ninjutsu-planner.js";

const students = [
  createStudent({ id: "ana", name: "  Ana   Pérez ", grade: "9-kyu", now: "2026-09-01T00:00:00.000Z" }),
  createStudent({ id: "luis", name: "Luis", grade: "5-kyu", now: "2026-09-01T00:00:00.000Z" })
];

test("normaliza el grupo sin DNI y conserva el grado", () => {
  assert.equal(students[0].name, "Ana Pérez");
  assert.equal(gradeLabel(students[0].grade), "9.º kyu");
  const normalized = normalizeRoster([students[1], students[0], { ...students[0], name: "Duplicada" }, null]);
  assert.deepEqual(normalized.map(student => student.id), ["ana", "luis"]);
  assert.equal("dni" in normalized[0], false);
});

test("marca presente, ausente o pendiente por sesión", () => {
  let attendance = updateAttendance({}, "L40", "ana", "present");
  attendance = updateAttendance(attendance, "L40", "luis", "absent");
  assert.deepEqual(attendanceRows(students, attendance, "L40").map(row => [row.id, row.status]), [
    ["ana", "present"],
    ["luis", "absent"]
  ]);
  const summary = sessionAttendanceSummary(students, attendance, "L40");
  assert.equal(summary.present.length, 1);
  assert.equal(summary.absent.length, 1);
  attendance = updateAttendance(attendance, "L40", "luis", null);
  assert.equal(sessionAttendanceSummary(students, attendance, "L40").pending.length, 1);
  assert.deepEqual(normalizeAttendance({ L40: { ana: "present", luis: "desconocido" } }), { L40: { ana: "present" } });
});

test("interpreta los rangos de grado de la programación", () => {
  assert.equal(gradeMatchesRange("9-kyu", "10º–7º"), true);
  assert.equal(gradeMatchesRange("5-kyu", "10º–7º"), false);
  assert.equal(gradeMatchesRange("5-kyu", "6º–5º"), true);
  assert.equal(gradeMatchesRange("2-kyu", "4º–2º"), true);
  assert.equal(gradeMatchesRange("dan", "1º+"), true);
  assert.equal(gradeMatchesRange("sin-grado", "10º–7º"), false);
});

test("calcula asistencia, bloques trabajados e indicaciones del grado", () => {
  const attendance = {
    L40: { ana: "present" },
    X40: { ana: "absent" },
    L41: { ana: "present" }
  };
  const progress = studentProgress(students[0], programSessions(), attendance, { today: "2026-10-05" });
  assert.equal(progress.offered, 3);
  assert.equal(progress.marked, 3);
  assert.equal(progress.present, 2);
  assert.equal(progress.absent, 1);
  assert.equal(progress.attendanceRate, 67);
  assert.ok(progress.attendedBlocks > 0);
  assert.ok(progress.availableBlocks >= progress.attendedBlocks);
  assert.ok(progress.blocks.some(block => block.sessions.includes("L40")));
  assert.ok(progress.gradeSessions > 0);
  assert.ok(progress.gradeFocus.some(focus => focus.sessionCode === "L41"));
  assert.deepEqual(progress.history.map(record => record.code), ["L41", "X40", "L40"]);
});
