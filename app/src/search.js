import { basenameWithoutExtension, normalizeLineEndings } from "./utils.js";

function fold(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es");
}

export function extractTitle(content = "", fallbackName = "") {
  const normalized = normalizeLineEndings(content);
  const match = normalized.match(/^\s*#\s+(.+?)\s*$/m);
  return (match?.[1] || basenameWithoutExtension(fallbackName) || "Sin título").trim();
}

export function extractTags(content = "") {
  const tags = new Set();
  const withoutCode = String(content)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ");
  for (const match of withoutCode.matchAll(/(^|[\s(])#([\p{L}\p{N}_/-]+)/gu)) {
    if (match[2]) tags.add(match[2]);
  }
  return [...tags].sort((a, b) => a.localeCompare(b, "es"));
}

export function enrichNoteRecord(file) {
  if (!file || typeof file !== "object") return file;
  const content = file.content ?? "";
  return {
    ...file,
    title: extractTitle(content, file.name),
    tags: extractTags(content),
    searchText: fold(`${file.name ?? ""}\n${file.path ?? ""}\n${content}`)
  };
}

export function parseSearchQuery(query = "") {
  const phrases = [];
  const text = String(query).trim();
  const phraseRegex = /"([^"]+)"/g;
  let remaining = text.replace(phraseRegex, (_, phrase) => {
    phrases.push(fold(phrase));
    return " ";
  });

  const tags = [];
  const paths = [];
  const terms = [];
  for (const raw of remaining.split(/\s+/).filter(Boolean)) {
    if (raw.startsWith("#") && raw.length > 1) tags.push(fold(raw.slice(1)));
    else if (raw.toLocaleLowerCase("es").startsWith("path:") && raw.length > 5) paths.push(fold(raw.slice(5)));
    else terms.push(fold(raw));
  }
  return { terms, phrases, tags, paths };
}

export function searchNotes(files, query, limit = 100) {
  const parsed = parseSearchQuery(query);
  const hasQuery = parsed.terms.length || parsed.phrases.length || parsed.tags.length || parsed.paths.length;
  const notes = files.filter(file => !file.trashed && file.kind === "note");
  if (!hasQuery) {
    return [...notes]
      .sort((a, b) => new Date(b.localUpdatedAt || b.modifiedTime || 0) - new Date(a.localUpdatedAt || a.modifiedTime || 0))
      .slice(0, limit)
      .map(file => ({ file, score: 0, matches: [] }));
  }

  const results = [];
  for (const original of notes) {
    const file = original.searchText ? original : enrichNoteRecord(original);
    const title = fold(file.title || file.name);
    const path = fold(file.path || "");
    const content = fold(file.content || "");
    const tags = (file.tags || []).map(fold);
    let score = 0;
    const matches = [];
    let excluded = false;

    for (const tag of parsed.tags) {
      if (!tags.some(value => value === tag || value.startsWith(`${tag}/`))) {
        excluded = true;
        break;
      }
      score += 35;
      matches.push(`#${tag}`);
    }
    if (excluded) continue;

    for (const expectedPath of parsed.paths) {
      if (!path.includes(expectedPath)) {
        excluded = true;
        break;
      }
      score += 25;
      matches.push(`path:${expectedPath}`);
    }
    if (excluded) continue;

    for (const phrase of parsed.phrases) {
      if (title.includes(phrase)) score += 90;
      else if (path.includes(phrase)) score += 40;
      else if (content.includes(phrase)) score += 20;
      else {
        excluded = true;
        break;
      }
      matches.push(phrase);
    }
    if (excluded) continue;

    for (const term of parsed.terms) {
      if (title === term) score += 120;
      else if (title.startsWith(term)) score += 85;
      else if (title.includes(term)) score += 60;
      else if (path.includes(term)) score += 30;
      else {
        const count = content.split(term).length - 1;
        if (!count) {
          excluded = true;
          break;
        }
        score += Math.min(25, 5 + count * 3);
      }
      matches.push(term);
    }
    if (excluded) continue;

    const timestamp = new Date(file.localUpdatedAt || file.modifiedTime || 0).getTime();
    if (Number.isFinite(timestamp)) score += Math.max(0, 10 - (Date.now() - timestamp) / 86_400_000 / 30);
    results.push({ file, score, matches });
  }

  return results
    .sort((a, b) => b.score - a.score || String(a.file.title).localeCompare(String(b.file.title), "es"))
    .slice(0, limit);
}

export function createSnippet(content = "", query = "", maxLength = 150) {
  const plain = normalizeLineEndings(content)
    .replace(/^---[\s\S]*?---\s*/m, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`~\[\]()!-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return "Nota vacía";
  const terms = parseSearchQuery(query).terms;
  const folded = fold(plain);
  const firstTerm = terms.find(term => folded.includes(term));
  const index = firstTerm ? folded.indexOf(firstTerm) : 0;
  const start = Math.max(0, index - Math.floor(maxLength / 3));
  const snippet = plain.slice(start, start + maxLength);
  return `${start > 0 ? "…" : ""}${snippet}${start + maxLength < plain.length ? "…" : ""}`;
}
