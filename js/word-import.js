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
