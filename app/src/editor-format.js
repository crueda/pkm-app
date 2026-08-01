const INLINE_FORMATS = Object.freeze({
  bold: { before: "**", after: "**", placeholder: "texto en negrita" },
  italic: { before: "_", after: "_", placeholder: "texto en cursiva" },
  "inline-code": { before: "`", after: "`", placeholder: "código" }
});

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

function replaceRange(value, start, end, replacement, selectionStart, selectionEnd = selectionStart) {
  return {
    value: `${value.slice(0, start)}${replacement}${value.slice(end)}`,
    selectionStart,
    selectionEnd
  };
}

function wrapInline(value, start, end, { before, after, placeholder }) {
  const selected = value.slice(start, end);
  if (selected && selected.startsWith(before) && selected.endsWith(after)) {
    const inner = selected.slice(before.length, selected.length - after.length);
    return replaceRange(value, start, end, inner, start, start + inner.length);
  }
  if (
    start >= before.length &&
    value.slice(start - before.length, start) === before &&
    value.slice(end, end + after.length) === after
  ) {
    return replaceRange(
      value,
      start - before.length,
      end + after.length,
      selected,
      start - before.length,
      end - before.length
    );
  }

  const content = selected || placeholder;
  const replacement = `${before}${content}${after}`;
  const contentStart = start + before.length;
  return replaceRange(value, start, end, replacement, contentStart, contentStart + content.length);
}

function selectedLineRange(value, start, end) {
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const effectiveEnd = end > start && value[end - 1] === "\n" ? end - 1 : end;
  const nextBreak = value.indexOf("\n", effectiveEnd);
  return { lineStart, lineEnd: nextBreak === -1 ? value.length : nextBreak };
}

function removeListPrefix(line) {
  return line.replace(/^(\s*)(?:(?:[-+*]\s+(?:\[[ xX]\]\s*)?)|(?:\d+\.\s+))/, "$1");
}

function transformLines(value, start, end, action) {
  const { lineStart, lineEnd } = selectedLineRange(value, start, end);
  const original = value.slice(lineStart, lineEnd);
  const lines = original.split("\n");
  const nonEmptyLines = lines.filter(line => line.trim());
  const formatEmptyLine = start === end && lines.length === 1 && !lines[0].trim();
  let transformed;

  if (action === "heading-1" || action === "heading-2" || action === "heading-3") {
    const level = Number(action.at(-1));
    const prefix = `${"#".repeat(level)} `;
    const exactPattern = new RegExp(`^\\s{0,3}#{${level}}\\s+`);
    const remove = nonEmptyLines.length > 0 && nonEmptyLines.every(line => exactPattern.test(line));
    transformed = lines.map(line => {
      if (!line.trim()) return formatEmptyLine ? prefix : line;
      const plain = line.replace(/^\s{0,3}#{1,6}\s+/, "");
      return remove ? plain : `${prefix}${plain}`;
    });
  } else if (action === "bulleted-list") {
    const remove = nonEmptyLines.length > 0 && nonEmptyLines.every(line => /^\s*[-+*]\s+(?!\[[ xX]\])/.test(line));
    transformed = lines.map(line => !line.trim() ? (formatEmptyLine ? "- " : line) : remove ? removeListPrefix(line) : `- ${removeListPrefix(line)}`);
  } else if (action === "numbered-list") {
    const remove = nonEmptyLines.length > 0 && nonEmptyLines.every(line => /^\s*\d+\.\s+/.test(line));
    let number = 0;
    transformed = lines.map(line => {
      if (!line.trim()) return formatEmptyLine ? "1. " : line;
      number += 1;
      return remove ? removeListPrefix(line) : `${number}. ${removeListPrefix(line)}`;
    });
  } else if (action === "task-list") {
    const remove = nonEmptyLines.length > 0 && nonEmptyLines.every(line => /^\s*[-+*]\s+\[[ xX]\]\s+/.test(line));
    transformed = lines.map(line => !line.trim() ? (formatEmptyLine ? "- [ ] " : line) : remove ? removeListPrefix(line) : `- [ ] ${removeListPrefix(line)}`);
  } else if (action === "quote") {
    const remove = nonEmptyLines.length > 0 && nonEmptyLines.every(line => /^\s*>\s?/.test(line));
    transformed = lines.map(line => !line.trim() ? (formatEmptyLine ? "> " : line) : remove ? line.replace(/^\s*>\s?/, "") : `> ${line}`);
  } else {
    return { value, selectionStart: start, selectionEnd: end };
  }

  const replacement = transformed.join("\n");
  if (start === end) {
    const firstLineDelta = transformed[0].length - lines[0].length;
    const cursor = clamp(start + firstLineDelta, lineStart, lineStart + transformed[0].length);
    return replaceRange(value, lineStart, lineEnd, replacement, cursor);
  }
  return replaceRange(value, lineStart, lineEnd, replacement, lineStart, lineStart + replacement.length);
}

function insertLink(value, start, end) {
  const selected = value.slice(start, end);
  const label = selected || "texto del enlace";
  const replacement = `[${label}](https://)`;
  if (selected) {
    const urlStart = start + label.length + 3;
    return replaceRange(value, start, end, replacement, urlStart, urlStart + 8);
  }
  return replaceRange(value, start, end, replacement, start + 1, start + 1 + label.length);
}

function insertCodeBlock(value, start, end) {
  const selected = value.slice(start, end) || "código";
  const prefix = start > 0 && value[start - 1] !== "\n" ? "\n" : "";
  const suffix = end < value.length && value[end] !== "\n" ? "\n" : "";
  const replacement = `${prefix}\`\`\`\n${selected}\n\`\`\`${suffix}`;
  const contentStart = start + prefix.length + 4;
  return replaceRange(value, start, end, replacement, contentStart, contentStart + selected.length);
}

export function formatMarkdown(value = "", selectionStart = 0, selectionEnd = selectionStart, action = "") {
  const text = String(value);
  const start = clamp(selectionStart, 0, text.length);
  const end = clamp(selectionEnd, start, text.length);
  if (INLINE_FORMATS[action]) return wrapInline(text, start, end, INLINE_FORMATS[action]);
  if (["heading-1", "heading-2", "heading-3", "bulleted-list", "numbered-list", "task-list", "quote"].includes(action)) {
    return transformLines(text, start, end, action);
  }
  if (action === "link") return insertLink(text, start, end);
  if (action === "code-block") return insertCodeBlock(text, start, end);
  return { value: text, selectionStart: start, selectionEnd: end };
}
