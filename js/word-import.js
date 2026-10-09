// Turns Word content into the Markdown the editor uses, keeping headings, bold/italic,
// lists, links, tables and pictures (charts saved as pictures included).
// Two ways in: choosing a .docx file, or pasting copied text into the editor.
// The converter libraries are only downloaded when one of these is used.

function loadVendor(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-vendor="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = `js/vendor/${src}`;
    s.dataset.vendor = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(s);
  });
}

async function loadTurndown() {
  await loadVendor("turndown.js");
  await loadVendor("turndown-plugin-gfm.js");
}

// ---------- HTML clean-up ----------

// Word's copied HTML writes bullet lists as <p> tags with a fake bullet. Rebuild real lists.
function rebuildWordLists(doc) {
  const isListPara = (el) =>
    el && el.tagName === "P" && (/mso-list/i.test(el.getAttribute("style") || "") || /MsoListParagraph/i.test(el.className));
  for (const p of [...doc.body.querySelectorAll("p")]) {
    if (!p.isConnected || !isListPara(p) || isListPara(p.previousElementSibling)) continue;
    const items = [];
    for (let el = p; isListPara(el); el = el.nextElementSibling) items.push(el);
    const marker = (items[0].querySelector("[style*='mso-list:Ignore'], [style*='mso-list: Ignore']")?.textContent || "").trim();
    const list = doc.createElement(/^(\d+|[a-z]|[ivx]+)[.)]$/i.test(marker) ? "ol" : "ul");
    for (const it of items) {
      it.querySelectorAll("[style*='mso-list:Ignore'], [style*='mso-list: Ignore']").forEach((n) => n.remove());
      const li = doc.createElement("li");
      li.innerHTML = it.innerHTML.replace(/^(\s|&nbsp;|[·•▪o§-])+/, "");
      list.appendChild(li);
    }
    items[0].before(list);
    items.forEach((it) => it.remove());
  }
}

// Tables become Markdown tables only when they have a header row, so use the first row as one,
// and keep each cell on a single line.
function prepareTables(doc) {
  doc.body.querySelectorAll("table").forEach((table) => {
    const rows = [...table.querySelectorAll("tr")];
    if (!rows.length) return;
    rows.forEach((tr) =>
      tr.querySelectorAll("td, th").forEach((cell) => {
        const parts = [...cell.querySelectorAll("p, div, li")].map((p) => p.innerHTML.trim()).filter(Boolean);
        if (parts.length) cell.innerHTML = parts.join(" ");
        cell.querySelectorAll("br").forEach((br) => br.replaceWith(" "));
      })
    );
    const first = rows[0];
    if (!first.querySelector("th")) {
      [...first.children].forEach((td) => {
        const th = doc.createElement("th");
        th.innerHTML = td.innerHTML.replace(/<\/?(b|strong)>/gi, "");
        td.replaceWith(th);
      });
    }
    if (!table.querySelector("thead")) {
      const thead = doc.createElement("thead");
      thead.appendChild(first);
      table.prepend(thead);
    }
  });
}

// The article already shows its title as the main heading, so document headings move down a level.
function demoteHeadings(doc) {
  for (let level = 5; level >= 1; level--) {
    doc.body.querySelectorAll(`h${level}`).forEach((h) => {
      const n = doc.createElement(`h${level + 1}`);
      n.innerHTML = h.innerHTML;
      h.replaceWith(n);
    });
  }
}

function dataURLToFile(url, name) {
  const [head, b64] = url.split(",");
  const type = (head.match(/data:([^;]+)/) || [])[1] || "image/png";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], `${name}.${(type.split("/")[1] || "png").replace("jpeg", "jpg").replace(/\+.*/, "")}`, { type });
}

// Uploads embedded pictures, and drops ones that only point at the author's own computer
// (Word does that when copying a chart together with text).
async function uploadImages(doc, onProgress) {
  let uploaded = 0, skipped = 0;
  const imgs = [...doc.body.querySelectorAll("img")];
  for (const img of imgs) {
    const src = img.getAttribute("src") || "";
    if (src.startsWith("data:")) {
      onProgress && onProgress(uploaded + 1, imgs.length);
      img.setAttribute("src", await uploadFile(dataURLToFile(src, `picture-${uploaded + 1}`)));
      uploaded++;
    } else if (!/^https?:\/\//.test(src) && !src.startsWith("uploads/")) {
      img.remove();
      skipped++;
    }
  }
  return { uploaded, skipped };
}

function toMarkdown(doc) {
  const td = new TurndownService({ headingStyle: "atx", bulletListMarker: "-", emDelimiter: "*", codeBlockStyle: "fenced" });
  td.use(turndownPluginGfm.gfm);
  td.remove(["style", "script", "meta", "title", "xml"]);
  td.addRule("wordJunk", { filter: (n) => /^O:P$/i.test(n.nodeName) || n.nodeName.includes(":"), replacement: () => "" });
  td.addRule("imgAlt", {
    filter: "img",
    replacement: (_, n) => `\n\n![${(n.getAttribute("alt") || "").replace(/[\[\]\n]/g, " ").trim()}](${n.getAttribute("src")})\n\n`,
  });
  return td
    .turndown(doc.body)
    .replace(/ /g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function summarize(doc) {
  return { tables: doc.body.querySelectorAll("table").length };
}

// ---------- Pasted HTML ----------
async function pastedHTMLToMarkdown(html, onProgress) {
  await loadTurndown();
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("style, script, meta, link, title").forEach((n) => n.remove());
  let title = "";
  const t = doc.body.querySelector("p.MsoTitle, h1.MsoTitle");
  if (t) { title = t.textContent.replace(/\s+/g, " ").trim(); t.remove(); }
  rebuildWordLists(doc);
  demoteHeadings(doc);
  prepareTables(doc);
  const images = await uploadImages(doc, onProgress);
  return { markdown: toMarkdown(doc), title, images, ...summarize(doc) };
}

// ---------- .docx file ----------
async function wordFileToMarkdown(file, onProgress) {
  await loadVendor("mammoth.browser.min.js");
  await loadTurndown();
  const { value: html } = await mammoth.convertToHtml(
    { arrayBuffer: await file.arrayBuffer() },
    {
      styleMap: [
        "p[style-name='Title'] => h1.doc-title:fresh",
        "p[style-name='Subtitle'] => p:fresh",
        "p[style-name='Heading 1'] => h2:fresh",
        "p[style-name='Heading 2'] => h3:fresh",
        "p[style-name='Heading 3'] => h4:fresh",
        "p[style-name='Heading 4'] => h5:fresh",
        "p[style-name='Quote'] => blockquote:fresh",
        "p[style-name='Intense Quote'] => blockquote:fresh",
      ],
    }
  );
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  let title = "";
  const t = doc.body.querySelector("h1.doc-title");
  if (t) { title = t.textContent.trim(); t.remove(); }
  prepareTables(doc);
  const images = await uploadImages(doc, onProgress);
  return { markdown: toMarkdown(doc), title, images, ...summarize(doc) };
}

// Charts drawn inside Word (not saved as pictures) can't be read by any converter, so warn about them.
async function countLiveCharts(file) {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const text = new TextDecoder("latin1").decode(bytes);
    return (text.match(/word\/charts\/chart\d+\.xml/g) || []).filter((v, i, a) => a.indexOf(v) === i).length;
  } catch (e) {
    return 0;
  }
}

// ---------- PDF file ----------
// A PDF has no paragraphs or headings, only positioned pieces of text. Rebuild them:
// lines from pieces at the same height, paragraphs from lines close together,
// headings from text bigger (or bolder) than the body text. Pictures are cut out of the page.
async function loadPdfJs() {
  await loadVendor("pdf.min.js");
  pdfjsLib.GlobalWorkerOptions.workerSrc = "js/vendor/pdf.worker.min.js";
}

const PDF_BULLET = /^([•●▪■◦○◆►▶✓✔\-–—*]|\d{1,2}[.)]|[a-z][.)]|\([a-z0-9]{1,3}\))\s+/i;

function pdfFontName(page, item) {
  try { return page.commonObjs.get(item.fontName).name || ""; } catch (e) { return ""; }
}

// Pieces of text → lines with their size, position and boldness.
function pdfLines(page, items) {
  const lines = [];
  let cur = null;
  for (const it of items) {
    if (!it.str && !it.hasEOL) continue;
    const size = Math.round(Math.hypot(it.transform[2], it.transform[3]) * 10) / 10 || it.height || 10;
    const x = it.transform[4], y = it.transform[5];
    const bold = /bold|black|heavy|semibold|demi/i.test(pdfFontName(page, it));
    if (it.str) {
      if (cur && Math.abs(y - cur.y) <= Math.max(size, cur.size) * 0.45) {
        const gap = x - cur.endX;
        const needSpace = gap > size * 0.15 && !/\s$/.test(cur.text) && !/^\s/.test(it.str);
        // A wide gap inside a line separates table columns.
        // (Some PDFs fill that gap with one wide space instead.)
        if (it.str.trim() && (gap > size * 1.5 || cur.wideSpace)) cur.cells.push("");
        cur.wideSpace = !it.str.trim() ? cur.wideSpace || (it.width || 0) > size * 1.5 : false;
        cur.parts.push({ text: (needSpace ? " " : "") + it.str, bold });
        cur.text += (needSpace ? " " : "") + it.str;
        cur.cells[cur.cells.length - 1] += it.str;
        cur.size = Math.max(cur.size, size);
      } else {
        if (cur) lines.push(cur);
        cur = { y, x, size, text: it.str, parts: [{ text: it.str, bold }], cells: [it.str] };
      }
      cur.endX = x + (it.width || 0);
    }
  }
  if (cur) lines.push(cur);
  for (const l of lines) {
    l.text = l.text.replace(/\s+/g, " ").trim();
    l.cells = l.cells.map((c) => c.replace(/\s+/g, " ").trim()).filter(Boolean);
    const letters = l.parts.filter((p) => p.text.trim());
    l.bold = letters.length > 0 && letters.every((p) => p.bold);
  }
  return lines.filter((l) => l.text);
}

// Line text with **bold** runs (only when part of the line is bold).
function pdfLineMarkdown(line) {
  if (line.bold) return line.text;
  let out = "";
  for (const p of line.parts) {
    const t = p.text;
    if (p.bold && t.trim()) {
      const lead = t.match(/^\s*/)[0], trail = t.match(/\s*$/)[0];
      out += `${lead}**${t.trim()}**${trail}`;
    } else out += t;
  }
  return out.replace(/\*\*\s*\*\*/g, " ").replace(/\s+/g, " ").trim();
}

// Where pictures are drawn on a page, in PDF units, by following the drawing commands.
async function pdfImageBoxes(page) {
  const ops = await page.getOperatorList();
  const O = pdfjsLib.OPS;
  const mul = (m, n) => [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [], boxes = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i], args = ops.argsArray[i];
    if (fn === O.save) stack.push(ctm);
    else if (fn === O.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === O.transform) ctm = mul(ctm, args);
    else if (fn === O.paintFormXObjectBegin && args[0]) { stack.push(ctm); ctm = mul(ctm, args[0]); }
    else if (fn === O.paintFormXObjectEnd) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === O.paintImageXObject || fn === O.paintInlineImageXObject || fn === O.paintJpegXObject) {
      const xs = [ctm[4], ctm[4] + ctm[0], ctm[4] + ctm[2], ctm[4] + ctm[0] + ctm[2]];
      const ys = [ctm[5], ctm[5] + ctm[1], ctm[5] + ctm[3], ctm[5] + ctm[1] + ctm[3]];
      const box = { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
      // Skip tiny pictures (logos, bullets, lines) and full-page backgrounds of scanned pages.
      if (box.x2 - box.x1 > 60 && box.y2 - box.y1 > 40) boxes.push(box);
    }
  }
  return boxes;
}

async function pdfCropImages(page, boxes) {
  if (!boxes.length) return [];
  const scale = 2;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  const out = [];
  for (const b of boxes) {
    const [x1, y1, x2, y2] = viewport.convertToViewportRectangle([b.x1, b.y1, b.x2, b.y2]);
    const left = Math.max(0, Math.min(x1, x2)), top = Math.max(0, Math.min(y1, y2));
    const w = Math.min(canvas.width, Math.max(x1, x2)) - left, h = Math.min(canvas.height, Math.max(y1, y2)) - top;
    if (w < 20 || h < 20) continue;
    const c = document.createElement("canvas");
    c.width = Math.round(w); c.height = Math.round(h);
    c.getContext("2d").drawImage(canvas, left, top, w, h, 0, 0, w, h);
    out.push({ y: b.y2, dataURL: c.toDataURL("image/jpeg", 0.9) });
  }
  return out;
}

async function pdfFileToMarkdown(file, onProgress) {
  await loadPdfJs();
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    onProgress && onProgress(`Reading page ${n} of ${pdf.numPages}…`);
    const page = await pdf.getPage(n);
    const boxes = await pdfImageBoxes(page); // also loads the fonts, needed to spot bold text
    const text = await page.getTextContent();
    const lines = pdfLines(page, text.items);
    const height = page.getViewport({ scale: 1 }).height;
    // A scanned page is one big picture with no text: keep it as a picture.
    const pics = await pdfCropImages(page, lines.length ? boxes : boxes.slice(0, 1));
    pages.push({ lines, pics, height });
  }

  // Page headers/footers repeat on most pages, and page numbers stand alone: drop them.
  const key = (l) => l.text.replace(/\d+/g, "#");
  const seen = {};
  for (const p of pages) for (const k of new Set(p.lines.filter((l) => l.y > p.height * 0.9 || l.y < p.height * 0.1).map(key))) seen[k] = (seen[k] || 0) + 1;
  for (const p of pages) {
    p.lines = p.lines.filter((l) => {
      const edge = l.y > p.height * 0.9 || l.y < p.height * 0.1;
      if (edge && /^(page\s*)?\d+(\s*(of|\/)\s*\d+)?$/i.test(l.text)) return false;
      return !(edge && pages.length > 2 && seen[key(l)] > pages.length / 2);
    });
  }

  // Body text size: the size most characters use.
  const bySize = {};
  for (const p of pages) for (const l of p.lines) bySize[l.size] = (bySize[l.size] || 0) + l.text.length;
  const body = Number(Object.entries(bySize).sort((a, b) => b[1] - a[1])[0]?.[0] || 11);
  const biggest = Math.max(body, ...pages.flatMap((p) => p.lines.map((l) => l.size)));

  let title = "";
  const blocks = [];
  let para = null, prev = null;
  const flush = () => { if (para) { blocks.push(para); para = null; } };
  let picCount = 0;

  for (const p of pages) {
    const flow = [...p.lines.map((l) => ({ kind: "line", y: l.y, l })), ...p.pics.map((pic) => ({ kind: "pic", y: pic.y, pic }))]
      .sort((a, b) => b.y - a.y);
    prev = null;
    let pageStart = true;
    for (const f of flow) {
      if (f.kind === "pic") {
        flush();
        blocks.push({ type: "img", dataURL: f.pic.dataURL, alt: `Picture ${++picCount}` });
        prev = null;
        continue;
      }
      const l = f.l;
      if (l.cells.length >= 2) {
        const last = blocks[blocks.length - 1];
        if (!para && last?.type === "table" && last.rows[0].length === l.cells.length) last.rows.push(l.cells);
        else { flush(); blocks.push({ type: "table", rows: [l.cells] }); }
        prev = l;
        continue;
      }
      const big = l.size >= body * 1.15;
      const boldHeading = l.bold && l.size >= body * 0.95 && l.text.length < 90 && !/[.,;:]$/.test(l.text);
      if (blocks.length === 0 && !para && l.size >= biggest * 0.98 && l.size > body * 1.3 && (!title || (prev && prev.y - l.y < l.size * 1.8))) {
        title = title ? `${title} ${l.text}` : l.text;
        prev = l;
        continue;
      }
      if (big || boldHeading) {
        const lastHeading = blocks[blocks.length - 1];
        // A heading split over two lines.
        if (!para && lastHeading?.type === "h" && prev && Math.abs(prev.size - l.size) < 0.5 && prev.y - l.y < l.size * 1.8) {
          lastHeading.text += " " + l.text;
        } else {
          flush();
          blocks.push({ type: "h", level: l.size >= body * 1.45 ? 2 : 3, text: l.text });
        }
        prev = l;
        continue;
      }
      const gap = prev ? prev.y - l.y : Infinity;
      const symbolBullet = /^[•●▪■◦○◆►▶✓✔]/.test(l.text);
      const bullet = PDF_BULLET.test(l.text) && (symbolBullet || !para || /[.:;?!)]$/.test(para.text) || gap >= l.size * 1.75);
      // A paragraph that runs on from the previous page: it hadn't finished its sentence.
      const runsOn = pageStart && para && !prev && !/[.!?:"”')]$/.test(para.text);
      const continues = para && !bullet && (runsOn || (gap > 0 && gap < l.size * 1.75 && Math.abs(prev.size - l.size) < 1));
      pageStart = false;
      const md = pdfLineMarkdown(l);
      if (continues) {
        para.text = /[A-Za-z]-$/.test(para.text) ? para.text + md : `${para.text} ${md}`;
      } else {
        flush();
        para = bullet
          ? { type: "li", ordered: /^\(?[0-9a-z]{1,3}[.)]/i.test(l.text) && !/^[-–—*]/.test(l.text), text: md.replace(PDF_BULLET, "") }
          : { type: "p", text: md };
      }
      prev = l;
    }
  }
  flush();

  blocks.forEach((b, i) => { if (b.type === "table" && b.rows.length < 2) blocks[i] = { type: "p", text: b.rows[0].join(" ") }; });

  // Upload pictures, then write Markdown.
  const imgs = blocks.filter((b) => b.type === "img");
  let uploaded = 0;
  for (const b of imgs) {
    onProgress && onProgress(`Uploading picture ${uploaded + 1} of ${imgs.length}…`);
    b.src = await uploadFile(dataURLToFile(b.dataURL, `pdf-picture-${uploaded + 1}`));
    uploaded++;
  }
  const md = [];
  blocks.forEach((b, i) => {
    const nextIsItem = blocks[i + 1]?.type === "li";
    if (b.type === "h") md.push(`${"#".repeat(b.level)} ${b.text}`, "");
    else if (b.type === "img") md.push(`![${b.alt}](${b.src})`, "");
    else if (b.type === "table") {
      const cell = (c) => c.replace(/\|/g, "\\|");
      const [head, ...rows] = b.rows;
      md.push(`| ${head.map(cell).join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`), "");
    }
    else if (b.type === "li") md.push(`${b.ordered ? "1." : "-"} ${b.text}`, ...(nextIsItem ? [] : [""]));
    else md.push(b.text, "");
  });
  const textChars = pages.reduce((s, p) => s + p.lines.reduce((t, l) => t + l.text.length, 0), 0);
  return {
    markdown: md.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
    title,
    images: { uploaded, skipped: 0 },
    tables: blocks.filter((b) => b.type === "table" && b.rows.length > 1).length,
    scanned: textChars < 20 * pdf.numPages,
    hindi: pages.some((p) => p.lines.some((l) => /[\u0900-\u097F]/.test(l.text))),
  };
}
