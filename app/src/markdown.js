import { escapeAttribute, escapeHtml, normalizeLineEndings, safeImageUrl, safeUrl } from "./utils.js";

function tokenStore() {
  const values = [];
  return {
    put(html) {
      const index = values.push(html) - 1;
      return `\u0001${index}\u0002`;
    },
    restore(text) {
      return text.replace(/\u0001(\d+)\u0002/g, (_, index) => values[Number(index)] ?? "");
    }
  };
}

export function renderInlineMarkdown(input = "", options = {}) {
  const tokens = tokenStore();
  let text = String(input);

  text = text.replace(/`([^`\n]+)`/g, (_, code) => tokens.put(`<code>${escapeHtml(code)}</code>`));

  text = text.replace(/!\[\[([^\]]+)\]\]/g, (_, rawTarget) => {
    const [target, label] = rawTarget.split("|").map(part => part.trim());
    const visible = label || target;
    return tokens.put(
      `<button type="button" class="wiki-embed" data-wiki-target="${escapeAttribute(target)}" title="Abrir adjunto o nota incrustada">` +
        `<span aria-hidden="true">▣</span> ${escapeHtml(visible)}` +
      `</button>`
    );
  });

  text = text.replace(/\[\[([^\]]+)\]\]/g, (_, rawTarget) => {
    const [target, label] = rawTarget.split("|").map(part => part.trim());
    const visible = label || target;
    return tokens.put(
      `<button type="button" class="wiki-link" data-wiki-target="${escapeAttribute(target)}">${escapeHtml(visible)}</button>`
    );
  });

  text = text.replace(/!\[([^\]\n]*)\]\(([^\s)]+)(?:\s+"([^"]*)")?\)/g, (_, label, rawSrc, title) => {
    const resolved = typeof options.resolveImageUrl === "function" ? options.resolveImageUrl(rawSrc) : rawSrc;
    const src = safeImageUrl(resolved ?? "");
    if (!src) return `${label} (${rawSrc})`;
    const titleAttribute = title ? ` title="${escapeAttribute(title)}"` : "";
    return tokens.put(
      `<img class="markdown-image" src="${escapeAttribute(src)}" alt="${escapeAttribute(label)}" loading="lazy" decoding="async"${titleAttribute}>`
    );
  });

  text = text.replace(/\[([^\]]+)\]\(([^\s)]+)(?:\s+"([^"]*)")?\)/g, (_, label, rawHref, title) => {
    const href = safeUrl(rawHref);
    if (!href) return `${label} (${rawHref})`;
    const titleAttribute = title ? ` title="${escapeAttribute(title)}"` : "";
    return tokens.put(
      `<a href="${escapeAttribute(href)}" target="_blank" rel="noopener noreferrer"${titleAttribute}>${escapeHtml(label)}</a>`
    );
  });

  text = text.replace(/<(https?:\/\/[^>\s]+)>/g, (_, rawHref) => {
    const href = safeUrl(rawHref);
    return href
      ? tokens.put(`<a href="${escapeAttribute(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(rawHref)}</a>`)
      : rawHref;
  });

  text = escapeHtml(text);
  text = text.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/__([^_\n]+)__/g, "<strong>$1</strong>");
  text = text.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
  text = text.replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  text = text.replace(/(^|[\s(])_([^_\n]+)_/g, "$1<em>$2</em>");
  text = text.replace(/(^|[\s(])#([\p{L}\p{N}_/-]+)/gu, '$1<span class="md-tag">#$2</span>');
  text = text.replace(/  \n/g, "<br>\n");
  return tokens.restore(text);
}

function isTableSeparator(line = "") {
  const cells = line.trim().replace(/^\||\|$/g, "").split("|");
  return cells.length > 0 && cells.every(cell => /^\s*:?-{3,}:?\s*$/.test(cell));
}

function splitTableRow(line = "") {
  return line.trim().replace(/^\||\|$/g, "").split("|").map(cell => cell.trim());
}

function startsBlock(lines, index) {
  const line = lines[index] ?? "";
  const next = lines[index + 1] ?? "";
  return (
    /^\s*```/.test(line) ||
    /^\s{0,3}#{1,6}\s+/.test(line) ||
    /^\s{0,3}>\s?/.test(line) ||
    /^\s{0,3}(?:[-+*]|\d+\.)\s+/.test(line) ||
    /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line) ||
    (line.includes("|") && isTableSeparator(next))
  );
}

export function renderMarkdown(markdown = "", options = {}) {
  const normalized = normalizeLineEndings(markdown);
  const lines = normalized.split("\n");
  const output = [];
  let index = 0;

  if (lines[0]?.trim() === "---") {
    const end = lines.slice(1).findIndex(line => line.trim() === "---");
    if (end >= 0) {
      const frontmatterLines = lines.slice(1, end + 1);
      output.push(
        `<details class="frontmatter"><summary>Propiedades</summary><pre><code>${escapeHtml(frontmatterLines.join("\n"))}</code></pre></details>`
      );
      index = end + 2;
    }
  }

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^\s*```\s*([\w+-]*)\s*$/);
    if (fence) {
      const language = fence[1] || "texto";
      const code = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      output.push(
        `<pre class="code-block"><span class="code-language">${escapeHtml(language)}</span><code>${escapeHtml(code.join("\n"))}</code></pre>`
      );
      continue;
    }

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const level = heading[1].length;
      output.push(`<h${level}>${renderInlineMarkdown(heading[2], options)}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      output.push("<hr>");
      index += 1;
      continue;
    }

    if (line.includes("|") && isTableSeparator(lines[index + 1])) {
      const headers = splitTableRow(line);
      const alignments = splitTableRow(lines[index + 1]).map(cell => {
        const left = cell.trim().startsWith(":");
        const right = cell.trim().endsWith(":");
        if (left && right) return "center";
        if (right) return "right";
        return "left";
      });
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      output.push(
        `<div class="table-scroll"><table><thead><tr>${headers
          .map((cell, column) => `<th class="align-${alignments[column] || "left"}">${renderInlineMarkdown(cell, options)}</th>`)
          .join("")}</tr></thead><tbody>${rows
          .map(row => `<tr>${headers.map((_, column) => `<td class="align-${alignments[column] || "left"}">${renderInlineMarkdown(row[column] || "", options)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table></div>`
      );
      continue;
    }

    if (/^\s{0,3}>\s?/.test(line)) {
      const quoted = [];
      while (index < lines.length && /^\s{0,3}>\s?/.test(lines[index])) {
        quoted.push(lines[index].replace(/^\s{0,3}>\s?/, ""));
        index += 1;
      }
      output.push(`<blockquote>${renderMarkdown(quoted.join("\n"), options)}</blockquote>`);
      continue;
    }

    const listMatch = line.match(/^\s{0,3}([-+*]|\d+\.)\s+(.+)$/);
    if (listMatch) {
      const ordered = /\d+\./.test(listMatch[1]);
      const tag = ordered ? "ol" : "ul";
      const items = [];
      while (index < lines.length) {
        const match = lines[index].match(/^\s{0,3}([-+*]|\d+\.)\s+(.+)$/);
        if (!match || /\d+\./.test(match[1]) !== ordered) break;
        let body = match[2];
        const checkbox = body.match(/^\[([ xX])\]\s*(.*)$/);
        if (checkbox) {
          const checked = checkbox[1].toLocaleLowerCase("es") === "x";
          body = `<label class="task-item"><input type="checkbox" disabled ${checked ? "checked" : ""}> <span>${renderInlineMarkdown(checkbox[2], options)}</span></label>`;
        } else {
          body = renderInlineMarkdown(body, options);
        }
        items.push(`<li>${body}</li>`);
        index += 1;
      }
      output.push(`<${tag}>${items.join("")}</${tag}>`);
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim() && !startsBlock(lines, index)) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    output.push(`<p>${renderInlineMarkdown(paragraph.join("\n"), options)}</p>`);
  }

  return output.join("\n") || '<p class="empty-preview">Esta nota está vacía.</p>';
}

export function markdownToPlainText(markdown = "") {
  return normalizeLineEndings(markdown)
    .replace(/^---\n[\s\S]*?\n---\n?/, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/!\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, label) => label || target)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~|-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
