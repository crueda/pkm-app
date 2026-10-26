const ATTENDANCE_STATUSES = new Set(["present", "absent"]);

export const NINJUTSU_GRADES = Object.freeze([
  { value: "sin-grado", label: "Sin grado", rank: 11 },
  ...Array.from({ length: 10 }, (_, index) => {
    const rank = 10 - index;
    return {
      value: `${rank}-kyu`,
      label: rank === 1 ? "1.er kyu" : `${rank}.º kyu`,
      rank
    };
  }),
  { value: "dan", label: "Dan", rank: 0 }
]);

const GRADE_BY_VALUE = new Map(NINJUTSU_GRADES.map(grade => [grade.value, grade]));

export function gradeLabel(value) {
  return GRADE_BY_VALUE.get(value)?.label ?? NINJUTSU_GRADES[0].label;
}

export function normalizeStudentName(value = "") {
  return String(value).trim().replace(/\s+/g, " ").slice(0, 120);
}

export function createStudent({ name, grade = "sin-grado", id, now = new Date().toISOString() }) {
  const normalizedName = normalizeStudentName(name);
  if (!normalizedName) throw new Error("Escribe el nombre del alumno");
  if (!id) throw new Error("El alumno necesita un identificador");
  return {
    id: String(id),
    name: normalizedName,
    grade: GRADE_BY_VALUE.has(grade) ? grade : "sin-grado",
    active: true,
    createdAt: now,
    updatedAt: now
  };
}
export function normalizeRoster(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.flatMap(student => {
    const id = String(student?.id ?? "").trim();
    const name = normalizeStudentName(student?.name);
    if (!id || !name || seen.has(id)) return [];
    seen.add(id);
    return [{
      id,
      name,
      grade: GRADE_BY_VALUE.has(student.grade) ? student.grade : "sin-grado",
      active: student.active !== false,
      createdAt: student.createdAt ?? null,
      updatedAt: student.updatedAt ?? null
    }];
  }).sort((left, right) => left.name.localeCompare(right.name, "es", { sensitivity: "base" }));
}

export function normalizeAttendance(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const [sessionCode, records] of Object.entries(value)) {
    if (!records || typeof records !== "object" || Array.isArray(records)) continue;
    const valid = Object.fromEntries(Object.entries(records)
      .filter(([studentId, status]) => studentId && ATTENDANCE_STATUSES.has(status)));
    if (Object.keys(valid).length) result[sessionCode] = valid;
  }
  return result;
}

export function updateAttendance(attendance, sessionCode, studentId, status) {
  const next = { ...normalizeAttendance(attendance) };
  const session = { ...(next[sessionCode] ?? {}) };
  if (ATTENDANCE_STATUSES.has(status)) session[studentId] = status;
  else delete session[studentId];
  if (Object.keys(session).length) next[sessionCode] = session;
  else delete next[sessionCode];
  return next;
}

export function attendanceRows(roster, attendance, sessionCode) {
  const records = normalizeAttendance(attendance)[sessionCode] ?? {};
  return normalizeRoster(roster)
    .filter(student => student.active)
    .map(student => ({ ...student, status: records[student.id] ?? "pending" }));
}

export function sessionAttendanceSummary(roster, attendance, sessionCode) {
  const rows = attendanceRows(roster, attendance, sessionCode);
  const present = rows.filter(row => row.status === "present");
  const absent = rows.filter(row => row.status === "absent");
  return { rows, present, absent, pending: rows.filter(row => row.status === "pending") };
}

export function attendanceHistory(roster, sessions, attendance, { today = new Date().toLocaleDateString("sv-SE") } = {}) {
  const records = normalizeAttendance(attendance);
  const offered = offeredSessions(sessions, today);
  const rows = normalizeRoster(roster).filter(student => student.active).map(student => {
    const cells = offered.map(session => records[session.code]?.[student.id] ?? "pending");
    const present = cells.filter(status => status === "present").length;
    const absent = cells.filter(status => status === "absent").length;
    return { student, cells, present, absent, rate: present + absent ? Math.round((present / (present + absent)) * 100) : 0 };
  });
  return {
    sessions: offered.map((session, index) => ({
      ...session,
      present: rows.filter(row => row.cells[index] === "present").length,
      absent: rows.filter(row => row.cells[index] === "absent").length
    })),
    rows
  };
}

function gradeRank(value) {
  return GRADE_BY_VALUE.get(value)?.rank ?? 11;
}

export function gradeMatchesRange(grade, range = "") {
  const rank = gradeRank(grade);
  const label = String(range).toLocaleLowerCase("es");
  if (/todos|general|cualquier/.test(label)) return true;
  if (rank === 11) return false;
  if (rank === 0) return /dan|1\s*[ºÂ°]\s*\+/.test(label);
  const values = [...label.matchAll(/(\d+)\s*[ºÂ°]/g)].map(match => Number(match[1]));
  if (!values.length) return false;
  if (values.length === 1) return values[0] === rank || (label.includes("+") && rank <= values[0]);
  return rank <= Math.max(...values) && rank >= Math.min(...values);
}

function canonicalBlockName(value = "") {
  return String(value).replace(/\s*\((?:repaso|revisi[oó]n)\)\s*$/i, "").trim();
}

function offeredSessions(sessions, today) {
  return sessions.filter(session => !session.cancelled && session.date <= today);
}

export function studentProgress(student, sessions, attendance, { today = new Date().toLocaleDateString("sv-SE") } = {}) {
  const records = normalizeAttendance(attendance);
  const offered = offeredSessions(sessions, today);
  const marked = offered.filter(session => ATTENDANCE_STATUSES.has(records[session.code]?.[student.id]));
  const presentSessions = marked.filter(session => records[session.code][student.id] === "present");
  const absentSessions = marked.filter(session => records[session.code][student.id] === "absent");
  const availableBlocks = new Set(offered.flatMap(session => session.parts.map(part => canonicalBlockName(part.name))).filter(Boolean));
  const blockMap = new Map();
  for (const session of presentSessions) {
    for (const part of session.parts) {
      const name = canonicalBlockName(part.name);
      if (!name) continue;
      const block = blockMap.get(name) ?? { name, sessions: [], items: new Set(), minutes: 0, lastDate: session.date };
      block.sessions.push(session.code);
      block.minutes += Number(part.minutes) || 0;
      block.lastDate = block.lastDate > session.date ? block.lastDate : session.date;
      part.items.forEach(item => block.items.add(item));
      blockMap.set(name, block);
    }
  }
  const gradeSessions = offered.filter(session => session.levels?.some(level => gradeMatchesRange(student.grade, level.grades)));
  const gradePresent = gradeSessions.filter(session => records[session.code]?.[student.id] === "present");
  const gradeFocus = gradePresent.flatMap(session => session.levels
    .filter(level => gradeMatchesRange(student.grade, level.grades))
    .map(level => ({ sessionCode: session.code, date: session.date, text: level.text })));
  const blocks = [...blockMap.values()]
    .map(block => ({ ...block, items: [...block.items] }))
    .sort((left, right) => right.lastDate.localeCompare(left.lastDate) || left.name.localeCompare(right.name, "es"));
  const denominator = presentSessions.length + absentSessions.length;
  return {
    offered: offered.length,
    marked: marked.length,
    present: presentSessions.length,
    absent: absentSessions.length,
    pending: Math.max(0, offered.length - marked.length),
    attendanceRate: denominator ? Math.round((presentSessions.length / denominator) * 100) : 0,
    availableBlocks: availableBlocks.size,
    attendedBlocks: blocks.length,
    blockCoverage: availableBlocks.size ? Math.round((blocks.length / availableBlocks.size) * 100) : 0,
    blocks,
    gradeSessions: gradeSessions.length,
    gradePresent: gradePresent.length,
    gradeFocus,
    history: marked.map(session => ({
      code: session.code,
      date: session.date,
      title: session.title,
      status: records[session.code][student.id]
    })).sort((left, right) => right.date.localeCompare(left.date))
  };
}
