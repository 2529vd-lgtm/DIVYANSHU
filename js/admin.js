// Admin page: upload and edit articles and site settings.
// Content lives in the content/ folder; every save becomes a commit on GitHub.

const PATHS = {
  site: "content/site.json",
  articles: "content/articles.json",
  article: (id) => `content/articles/${id}.md`,
  chapter: (id, n) => `content/articles/${id}/chapter-${n}.md`,
};
const MAX_UPLOAD_MB = 25;
const DB = { site: {}, articles: [] };
let currentTab = ["articles", "settings", "instagram"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "articles";

const $ = (id) => document.getElementById(id);
const today = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
const makeId = (title, prefix) => `${slugify(title) || prefix}-${Date.now().toString(36)}`;
const byDate = (a, b) => String(b.date).localeCompare(String(a.date));

function status(msg, kind = "info") {
  $("status").innerHTML = msg ? `<div class="status ${kind}">${msg}</div>` : "";
  if (msg) $("status").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

const PUBLISHED = (href) =>
  `✅ Saved! It will show on the website in 1–2 minutes${href ? `: <a href="${href}" target="_blank">view</a>` : "."}`;

// Runs a save action with a busy button and a friendly error message.
async function busy(btn, label, fn) {
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = label;
  status("⏳ Saving… please don't close this page.");
  try {
    await fn();
  } catch (e) {
    console.error(e);
    const hint = e.status === 401 || e.status === 403 ? " The token is wrong or doesn't have enough permission. Log out and enter a new token." : "";
    status(`❌ Error: ${esc(e.message)}.${hint}`, "err");
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
}

// ---------- Login ----------
function savedToken() {
  try { return localStorage.getItem("ghToken") || sessionStorage.getItem("ghToken"); } catch (e) { return null; }
}

async function login(token, remember) {
  GH.token = token;
  const info = await GH.repoInfo();
  if (!info) throw new Error("This token can't see the DIVYANSHU repo. Log out and create a token with access to both DIVYANSHU and EXAM-CORNER (see the steps below).");
  if (!info.permissions || !info.permissions.push) throw new Error("This token can't write to the repo (it needs Contents: Read and write).");
  try {
    (remember ? localStorage : sessionStorage).setItem("ghToken", token);
  } catch (e) {}
  await loadAll();
  $("login").classList.add("hidden");
  $("app").classList.remove("hidden");
  status("");
  showTab(currentTab);
}

async function loadAll() {
  const [site, articles] = await Promise.all([
    GH.readJSON(PATHS.site, { socials: {} }),
    GH.readJSON(PATHS.articles, { articles: [] }),
  ]);
  DB.site = site.data;
  DB.site.socials = DB.site.socials || {};
  DB.articles = articles.data.articles || [];
}

function logout() {
  try { localStorage.removeItem("ghToken"); sessionStorage.removeItem("ghToken"); } catch (e) {}
  location.reload();
}

// ---------- Tabs ----------
function showTab(tab) {
  currentTab = tab;
  history.replaceState(null, "", tab === "articles" ? location.pathname : `#${tab}`);
  document.querySelectorAll("#admin-tabs .tab[data-tab]").forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
  ({ articles: articleList, settings: settingsForm, instagram: instagramTab })[tab]();
}

// ---------- Rich text editor (Markdown with toolbar + preview + uploads) ----------
const TOOLS = [
  ["H2", "Big heading", (s) => `\n## ${s || "Heading"}\n`],
  ["H3", "Small heading", (s) => `\n### ${s || "Sub-heading"}\n`],
  ["B", "Bold", (s) => `**${s || "bold text"}**`],
  ["I", "Italic", (s) => `*${s || "italic text"}*`],
  ["• List", "Bullet list", (s) => "\n" + (s || "point").split("\n").map((l) => `- ${l}`).join("\n") + "\n"],
  ["1. List", "Numbered list", (s) => "\n" + (s || "point").split("\n").map((l, i) => `${i + 1}. ${l}`).join("\n") + "\n"],
  ["❝ Quote", "Quote / highlight box", (s) => `\n> ${s || "Important line"}\n`],
  ["🔗 Link", "Link", (s) => `[${s || "link text"}](https://)`],
  ["▦ Table", "Table", () => `\n| Column 1 | Column 2 |\n|---|---|\n| ... | ... |\n`],
  ["― Line", "Divider line", () => `\n---\n`],
];

function editorHTML(id, value, rows = 16) {
  return `<div class="editor" data-editor="${id}">
    <div class="editor-tools">
      ${TOOLS.map((t, i) => `<button type="button" class="icon-btn" data-tool="${i}" title="${esc(t[1])}">${esc(t[0])}</button>`).join("")}
      <button type="button" class="icon-btn" data-upload="image" title="Upload one or more photos">🖼️ Photo</button>
      <button type="button" class="icon-btn" data-upload="file" title="Upload one or more PDFs or other files">📎 PDF/File</button>
      <button type="button" class="icon-btn" data-word title="Import a Word (.docx) file with its tables and pictures">📄 Word file</button>
      <button type="button" class="icon-btn" data-preview title="See how it will look">👁️ Preview</button>
    </div>
    <textarea id="${id}" rows="${rows}" placeholder="Start writing here… (use the toolbar to add headings, bold, lists and photos)">${esc(value || "")}</textarea>
    <div class="preview prose hidden" id="${id}-preview"></div>
  </div>`;
}

function previewHTML(text) {
  // Uploaded files aren't on the live site until it rebuilds, so preview them from GitHub directly.
  return renderMarkdown(text).replace(/(src|href)="(uploads\/[^"]+)"/g, (_, attr, p) => `${attr}="${GH.rawURL(p)}"`);
}

function insertAtCursor(ta, text) {
  const { selectionStart: s, selectionEnd: e, value } = ta;
  ta.value = value.slice(0, s) + text + value.slice(e);
  ta.focus();
  ta.selectionStart = ta.selectionEnd = s + text.length;
}

// Puts imported Word content into the editor and reports what came across.
function insertImported(ed, ta, { markdown, title, images, tables }, liveCharts = 0) {
  const titleInput = ed.closest(".panel")?.querySelector("#a-title");
  if (title && titleInput && !titleInput.value.trim()) titleInput.value = title;
  if (!ta.value.trim()) {
    ta.value = markdown + "\n";
    ta.focus();
  } else insertAtCursor(ta, `\n\n${markdown}\n\n`);
  const got = [`${tables} table${tables === 1 ? "" : "s"}`, `${images.uploaded} picture${images.uploaded === 1 ? "" : "s"}`].join(" and ");
  const warn = [];
  if (images.skipped)
    warn.push(`${images.skipped} picture/chart couldn't be copied (Word doesn't include it when you copy text). Use the 📄 Word file button instead, or copy just the chart and paste it on its own.`);
  if (liveCharts)
    warn.push(`${liveCharts} chart${liveCharts === 1 ? " was" : "s were"} drawn inside Word and can't be imported. In Word, right-click the chart → Save as Picture, then add it with 🖼️ Photo.`);
  status(`${warn.length ? "⚠️" : "✅"} Imported with ${got}. Check it with 👁️ Preview, then save.${warn.length ? "<br>" + warn.map(esc).join("<br>") : ""}`, warn.length ? "info" : "ok");
}

// Pasting from Word or a web page keeps headings, bold, lists, links and tables.
// Pasting a single picture (a screenshot, or a chart copied on its own) uploads it.
function setupSmartPaste(ed, ta) {
  ta.addEventListener("paste", async (e) => {
    const cd = e.clipboardData;
    if (!cd) return;
    const html = cd.getData("text/html");
    const pictures = [...cd.files].filter((f) => f.type.startsWith("image/"));
    const htmlHasText = html && new DOMParser().parseFromString(html, "text/html").body.textContent.trim();
    const btn = ed.querySelector("[data-word]");
    if (pictures.length && !htmlHasText) {
      e.preventDefault();
      await busy(btn, "Uploading…", async () => {
        for (const [i, f] of pictures.entries()) {
          const file = f.name && f.name !== "image.png" ? f : new File([f], `pasted-${Date.now().toString(36)}-${i + 1}.png`, { type: f.type });
          insertAtCursor(ta, `\n![](${await uploadFile(file)})\n`);
        }
        status(`✅ Picture pasted and uploaded. Don't forget to save.`, "ok");
      });
    } else if (html && /<(table|h[1-6]|ul|ol|li|b|strong|i|em|a|img)[\s>]|mso-|class="?Mso/i.test(html)) {
      e.preventDefault();
      const start = ta.selectionStart, end = ta.selectionEnd;
      await busy(btn, "Pasting…", async () => {
        const result = await pastedHTMLToMarkdown(html, (i, n) => status(`⏳ Uploading picture ${i} of ${n}…`));
        ta.selectionStart = start;
        ta.selectionEnd = end;
        insertImported(ed, ta, result);
      });
    }
  });
}

function setupEditors(root) {
  root.querySelectorAll("[data-editor]").forEach((ed) => {
    const ta = ed.querySelector("textarea");
    const pv = ed.querySelector(".preview");
    setupSmartPaste(ed, ta);
    ed.querySelector(".editor-tools").addEventListener("click", async (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.tool !== undefined) {
        const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
        insertAtCursor(ta, TOOLS[b.dataset.tool][2](sel));
      } else if (b.dataset.upload) {
        const files = await pickFiles(b.dataset.upload === "image" ? "image/*" : "");
        if (!files.length) return;
        await busy(b, "Uploading…", async () => {
          // One at a time: each upload is a commit, and parallel commits clash.
          for (const [i, file] of files.entries()) {
            if (files.length > 1) {
              b.textContent = `Uploading ${i + 1}/${files.length}…`;
              status(`⏳ Uploading ${i + 1} of ${files.length}: ${esc(file.name)}… please don't close this page.`);
            }
            const path = await uploadFile(file);
            const isImg = file.type.startsWith("image/");
            insertAtCursor(ta, isImg ? `\n![${file.name}](${path})\n` : `\n[📄 ${file.name} (download/open)](${path})\n`);
          }
          status(`✅ ${files.length > 1 ? files.length + " files" : "File"} uploaded. Don't forget to save.`, "ok");
        });
      } else if (b.dataset.word !== undefined) {
        const file = await pickFile(".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document");
        if (!file) return;
        if (!/\.docx$/i.test(file.name)) return status("⚠️ Please choose a .docx file. In Word, use File → Save As → Word Document (.docx).", "err");
        await busy(b, "Importing…", async () => {
          const result = await wordFileToMarkdown(file, (i, n) => status(`⏳ Uploading picture ${i} of ${n}… please don't close this page.`));
          insertImported(ed, ta, result, await countLiveCharts(file));
        });
      } else if (b.dataset.preview !== undefined) {
        const showing = !pv.classList.contains("hidden");
        pv.classList.toggle("hidden", showing);
        ta.classList.toggle("hidden", !showing);
        b.textContent = showing ? "👁️ Preview" : "✏️ Edit";
        if (!showing) pv.innerHTML = previewHTML(ta.value) || "<p class='muted'>Nothing written yet.</p>";
      }
    });
  });
}

// Lets you choose several files at once.
function pickFiles(accept) {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    if (accept) input.accept = accept;
    input.onchange = () => resolve([...input.files]);
    input.click();
  });
}

function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    if (accept) input.accept = accept;
    input.onchange = () => resolve(input.files[0] || null);
    input.click();
  });
}

// Big photos (phone or AI pictures are often 5–10 MB) upload slowly and load slowly for readers,
// so resize them to at most 1600px and save as JPEG before uploading.
async function shrinkImage(file) {
  if (!/^image\/(jpeg|png|webp|bmp)$/.test(file.type) || file.size < 400 * 1024) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; // transparent PNG areas become white, not black
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch (e) {
    console.warn("Could not shrink image", e);
    return file;
  }
}

let uploadsRunning = 0;

async function uploadFile(file) {
  uploadsRunning++;
  try {
    return await uploadOne(await shrinkImage(file));
  } finally {
    uploadsRunning--;
  }
}

async function uploadOne(file) {
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) throw new Error(`File is larger than ${MAX_UPLOAD_MB} MB`);
  const base64 = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = () => reject(new Error("Could not read the file"));
    r.readAsDataURL(file);
  });
  const d = today();
  const dot = file.name.lastIndexOf(".");
  const ext = dot > 0 ? file.name.slice(dot).toLowerCase().replace(/[^.a-z0-9]/g, "") : "";
  const name = (slugify(dot > 0 ? file.name.slice(0, dot) : file.name) || "file") + ext;
  const path = `uploads/${d.slice(0, 4)}/${d.slice(5, 7)}/${Date.now().toString(36)}-${name}`;
  await GH.writeBase64(path, base64, `Upload ${file.name}`);
  return path;
}

// Image field with an Upload button (cover photo, profile photo).
function imageFieldHTML(id, label, value) {
  return `<div class="field">
    <label for="${id}">${label}</label>
    <div style="display:flex;gap:8px">
      <input id="${id}" value="${esc(value || "")}" placeholder="Upload, or paste an image link" />
      <button type="button" class="btn small ghost" data-image-upload="${id}">Upload</button>
    </div>
    <img id="${id}-preview" class="field-preview${value ? "" : " hidden"}" src="${esc(value || "")}" alt="" />
  </div>`;
}

function setupImageFields(root) {
  root.querySelectorAll("[data-image-upload]").forEach((b) => {
    const input = $(b.dataset.imageUpload);
    const preview = $(`${input.id}-preview`);
    const showPreview = (src) => {
      preview.classList.toggle("hidden", !src);
      if (src) preview.src = src;
    };
    input.addEventListener("change", () => showPreview(input.value.trim()));
    b.addEventListener("click", async () => {
      const file = await pickFile("image/*");
      if (!file) return;
      const local = URL.createObjectURL(file);
      showPreview(local);
      await busy(b, "Uploading…", async () => {
        status("⏳ Uploading photo… please wait for the ✅ message before you Publish.");
        input.value = await uploadFile(file);
        status("✅ Photo uploaded. Now click Save/Publish.", "ok");
      });
      if (!input.value) showPreview("");
    });
  });
}

// Saving while a photo is still uploading would save the article without it.
function uploadsPending() {
  if (!uploadsRunning) return false;
  status("⏳ A photo is still uploading. Wait for the ✅ message, then click Save/Publish again.", "err");
  return true;
}

// =====================================================================
// Articles
// =====================================================================
function articleList() {
  const list = [...DB.articles].sort(byDate);
  $("view").innerHTML = `<div class="panel">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px">
      <h2 style="margin:0">Articles (${list.length})</h2>
      <button class="btn" id="new-article">+ New article</button>
    </div>
    <p class="help">Upload a Blog, Story, Editorial or Report here. For a novel, create a Story, tick "This is a novel", then add chapters one by one.</p>
    <ul class="admin-list">
      ${list.map((a) => `<li><div><b>${esc(a.title)}</b><div class="meta">${esc(a.category)}${a.novel ? ` · 📖 Novel, ${(a.chapters || []).length} chapters` : ""} · ${fmtDate(a.date)}</div></div>
        <span class="actions">
          ${a.novel ? `<button class="btn small" data-chapters="${esc(a.id)}">Chapters</button>` : ""}
          <a class="btn small ghost" href="article.html?id=${encodeURIComponent(a.id)}" target="_blank">View</a>
          <button class="btn small ghost" data-edit="${esc(a.id)}">Edit</button>
          <button class="btn small outline" data-del="${esc(a.id)}">Delete</button>
        </span></li>`).join("") || `<li class="muted">No articles yet.</li>`}
    </ul>
  </div>`;
  const find = (id) => DB.articles.find((a) => a.id === id);
  $("new-article").onclick = () => articleForm(null);
  $("view").querySelectorAll("[data-chapters]").forEach((b) => (b.onclick = () => chapterList(find(b.dataset.chapters))));
  $("view").querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => articleForm(find(b.dataset.edit))));
  $("view").querySelectorAll("[data-del]").forEach((b) =>
    (b.onclick = () => {
      const a = find(b.dataset.del);
      const extra = a.novel ? " All of its chapters will be deleted too." : "";
      if (!confirm(`Delete "${a.title}"?${extra} This cannot be undone.`)) return;
      busy(b, "…", async () => {
        for (const ch of a.chapters || []) await GH.remove(PATHS.chapter(a.id, ch.n), `Delete chapter ${ch.n}: ${a.title}`);
        await GH.remove(PATHS.article(a.id), `Delete article: ${a.title}`);
        const data = await GH.updateJSON(PATHS.articles, { articles: [] }, (d) => {
          d.articles = d.articles.filter((x) => x.id !== a.id);
        }, `Remove article from index: ${a.title}`);
        DB.articles = data.articles;
        articleList();
        status("🗑️ Article deleted.", "ok");
      });
    })
  );
}

async function articleForm(a) {
  let body = "";
  if (a) {
    status("⏳ Loading article…");
    const f = await GH.read(PATHS.article(a.id));
    body = f ? f.text : "";
    status("");
  }
  $("view").innerHTML = `<div class="panel">
    <h2>${a ? "Edit article" : "New article"}</h2>
    <div class="field"><label for="a-title">Title (heading) *</label><input id="a-title" value="${esc(a?.title)}" /></div>
    <div class="row">
      <div class="field"><label for="a-cat">Type</label>
        <select id="a-cat">${CATEGORIES.map((c) => `<option ${a?.category === c ? "selected" : ""}>${c}</option>`).join("")}</select></div>
      <div class="field"><label for="a-date">Date</label><input type="date" id="a-date" value="${esc(a?.date || today())}" /></div>
      <div class="field"><label for="a-author">Author</label><input id="a-author" value="${esc(a?.author ?? DB.site.author ?? "")}" /></div>
    </div>
    <label id="a-novel-wrap" style="font-weight:600;display:flex;gap:8px;align-items:center;margin-bottom:14px">
      <input type="checkbox" id="a-novel" style="width:auto" ${a?.novel ? "checked" : ""} /> 📖 This is a novel (I will upload chapters one by one)
    </label>
    <div class="field"><label for="a-summary">Short summary (1–2 lines, shown on the home page)</label><textarea id="a-summary" rows="2" style="min-height:0">${esc(a?.summary)}</textarea></div>
    ${imageFieldHTML("a-cover", "Cover photo (optional)", a?.cover)}
    ${a ? "" : IG.account
      ? `<label style="font-weight:600;display:flex;gap:8px;align-items:center;margin-bottom:14px"><input type="checkbox" id="a-ig" style="width:auto" checked /> 📸 Also post on Instagram (@${esc(IG.account.username || "your account")})</label>`
      : `<p class="help" style="margin-bottom:14px">📸 Want this on Instagram too? Connect it once in the <a href="#instagram" data-goto="instagram">Instagram tab</a>.</p>`}
    <div class="field"><label id="a-body-label">Article *</label>${editorHTML("a-body", body, 20)}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn" id="a-save">${a ? "Update" : "🚀 Publish"}</button>
      <button class="btn ghost" id="a-cancel">Cancel</button>
    </div>
  </div>`;
  setupEditors($("view"));
  setupImageFields($("view"));
  const isNovel = () => $("a-cat").value === "Story" && $("a-novel").checked;
  const syncNovel = () => {
    $("a-novel-wrap").classList.toggle("hidden", $("a-cat").value !== "Story");
    $("a-body-label").textContent = isNovel() ? "Introduction / synopsis (optional, shown before the chapters)" : "Article *";
  };
  $("a-cat").onchange = syncNovel;
  $("a-novel").onchange = syncNovel;
  syncNovel();
  $("a-cancel").onclick = articleList;
  $("view").querySelectorAll("[data-goto]").forEach((l) => (l.onclick = (e) => { e.preventDefault(); showTab(l.dataset.goto); }));
  $("a-save").onclick = () => {
    if (uploadsPending()) return;
    const meta = {
      id: a?.id || makeId($("a-title").value, "article"),
      title: $("a-title").value.trim(),
      category: $("a-cat").value,
      date: $("a-date").value || today(),
      author: $("a-author").value.trim(),
      summary: $("a-summary").value.trim(),
      cover: $("a-cover").value.trim(),
    };
    if (isNovel()) {
      meta.novel = true;
      meta.chapters = a?.chapters || [];
    } else if (a?.chapters?.length) {
      return status("⚠️ This novel has chapters. Delete its chapters first before turning it into a normal article.", "err");
    }
    const text = $("a-body").value;
    if (!meta.title) return status("⚠️ Please write a title.", "err");
    if (!meta.novel && !text.trim()) return status("⚠️ Please write both the title and the article.", "err");
    const toInstagram = !!$("a-ig")?.checked;
    busy($("a-save"), "Saving…", async () => {
      await GH.put(PATHS.article(meta.id), text, `${a ? "Update" : "Publish"} ${meta.category.toLowerCase()}: ${meta.title}`);
      const data = await GH.updateJSON(PATHS.articles, { articles: [] }, (d) => {
        const old = d.articles.find((x) => x.id === meta.id);
        if (meta.novel && old?.chapters) meta.chapters = old.chapters;
        d.articles = [meta, ...d.articles.filter((x) => x.id !== meta.id)].sort(byDate);
      }, `Update article index: ${meta.title}`);
      DB.articles = data.articles;
      if (meta.novel && !a) {
        chapterList(meta);
        status("✅ Novel created. Now add Chapter 1.", "ok");
      } else {
        articleList();
        status(PUBLISHED(`article.html?id=${encodeURIComponent(meta.id)}`), "ok");
        if (toInstagram) await postNewArticleToInstagram(meta);
      }
    });
  };
}

// The article is already saved, so an Instagram problem is reported but never undoes it.
async function postNewArticleToInstagram(meta) {
  const saved = `✅ Article published: <a href="article.html?id=${encodeURIComponent(meta.id)}" target="_blank">view</a>.`;
  try {
    const r = await igPost(meta, (m) => status(`${saved} ⏳ Instagram: ${m} please don't close this page.`, "ok"));
    status(`${saved} 📸 Posted on Instagram${r.link ? `: <a href="${esc(r.link)}" target="_blank" rel="noopener">see post</a>` : ""}.${r.note}`, r.note ? "err" : "ok");
  } catch (e) {
    console.error(e);
    status(`${saved} ❌ Instagram post failed: ${esc(e.message)}. Try again from the 📸 Instagram tab.`, "err");
  }
}

// ---------- Novel chapters ----------
function chapterList(novel) {
  const chapters = [...(novel.chapters || [])].sort((x, y) => x.n - y.n);
  const next = chapters.length ? chapters[chapters.length - 1].n + 1 : 1;
  $("view").innerHTML = `<div class="panel">
    <p><a href="#" id="ch-back">← All articles</a></p>
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px">
      <h2 style="margin:0">📖 ${esc(novel.title)}: Chapters (${chapters.length})</h2>
      <button class="btn" id="ch-new">+ Add Chapter ${next}</button>
    </div>
    <p class="help">Upload chapters one by one. Readers can read chapter by chapter, or the full novel on one page.</p>
    <ul class="admin-list">
      ${chapters.map((c) => `<li><div><b>Chapter ${c.n}${c.title ? `: ${esc(c.title)}` : ""}</b><div class="meta">${fmtDate(c.date)}</div></div>
        <span class="actions">
          <a class="btn small ghost" href="article.html?id=${encodeURIComponent(novel.id)}&ch=${c.n}" target="_blank">View</a>
          <button class="btn small ghost" data-edit="${c.n}">Edit</button>
          <button class="btn small outline" data-del="${c.n}">Delete</button>
        </span></li>`).join("") || `<li class="muted">No chapters yet. Click "Add Chapter 1".</li>`}
    </ul>
  </div>`;
  $("ch-back").onclick = (e) => { e.preventDefault(); status(""); articleList(); };
  $("ch-new").onclick = () => chapterForm(novel, null, next);
  $("view").querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => chapterForm(novel, chapters.find((c) => c.n === Number(b.dataset.edit)))));
  $("view").querySelectorAll("[data-del]").forEach((b) =>
    (b.onclick = () => {
      const n = Number(b.dataset.del);
      if (!confirm(`Delete Chapter ${n}? This cannot be undone.`)) return;
      busy(b, "…", async () => {
        await GH.remove(PATHS.chapter(novel.id, n), `Delete chapter ${n}: ${novel.title}`);
        const updated = await saveChapterIndex(novel.id, (list) => list.filter((c) => c.n !== n), `Remove chapter ${n}: ${novel.title}`);
        chapterList(updated);
        status("🗑️ Chapter deleted.", "ok");
      });
    })
  );
}

// Changes one novel's chapter list in articles.json and returns the updated novel.
async function saveChapterIndex(novelId, change, message) {
  const data = await GH.updateJSON(PATHS.articles, { articles: [] }, (d) => {
    const novel = d.articles.find((x) => x.id === novelId);
    if (!novel) throw new Error("This novel no longer exists");
    novel.chapters = change(novel.chapters || []).sort((x, y) => x.n - y.n);
  }, message);
  DB.articles = data.articles;
  return DB.articles.find((x) => x.id === novelId);
}

async function chapterForm(novel, ch, nextN) {
  const n = ch ? ch.n : nextN;
  let body = "";
  if (ch) {
    status("⏳ Loading chapter…");
    const f = await GH.read(PATHS.chapter(novel.id, n));
    body = f ? f.text : "";
    status("");
  }
  $("view").innerHTML = `<div class="panel">
    <h2>📖 ${esc(novel.title)}: ${ch ? "Edit" : "New"} Chapter ${n}</h2>
    <div class="row">
      <div class="field"><label for="c-title">Chapter title (optional)</label><input id="c-title" value="${esc(ch?.title)}" placeholder="e.g. The Beginning" /></div>
      <div class="field"><label for="c-date">Date</label><input type="date" id="c-date" value="${esc(ch?.date || today())}" /></div>
    </div>
    <div class="field"><label>Chapter ${n} *</label>${editorHTML("c-body", body, 22)}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn" id="c-save">${ch ? "Update chapter" : `🚀 Publish Chapter ${n}`}</button>
      <button class="btn ghost" id="c-cancel">Cancel</button>
    </div>
  </div>`;
  setupEditors($("view"));
  $("c-cancel").onclick = () => chapterList(novel);
  $("c-save").onclick = () => {
    if (uploadsPending()) return;
    const text = $("c-body").value;
    if (!text.trim()) return status("⚠️ Please write the chapter.", "err");
    const entry = { n, title: $("c-title").value.trim(), date: $("c-date").value || today() };
    busy($("c-save"), "Saving…", async () => {
      await GH.put(PATHS.chapter(novel.id, n), text, `${ch ? "Update" : "Publish"} chapter ${n}: ${novel.title}`);
      const updated = await saveChapterIndex(novel.id, (list) => [...list.filter((c) => c.n !== n), entry], `Update chapters: ${novel.title}`);
      chapterList(updated);
      status(PUBLISHED(`article.html?id=${encodeURIComponent(novel.id)}&ch=${n}`), "ok");
    });
  };
}

// =====================================================================
// Settings: site name, about, social media links
// =====================================================================
const SOCIAL_HINTS = {
  instagram: "https://instagram.com/your_username",
  youtube: "https://youtube.com/@your_channel",
  facebook: "https://facebook.com/your_page",
  x: "https://x.com/your_username",
  telegram: "https://t.me/your_channel",
  whatsapp: "Number (91XXXXXXXXXX) or channel link",
  linkedin: "https://linkedin.com/in/your_name",
  threads: "https://threads.net/@your_username",
  github: "https://github.com/your_username",
  email: "you@email.com",
};

function settingsForm() {
  const s = DB.site;
  $("view").innerHTML = `<div class="panel">
    <h2>🔗 Social media links</h2>
    <p class="help" style="margin-bottom:12px">Each link you add shows its logo on the website (home page, below every article and in the footer). Leave a box empty to hide that logo.</p>
    ${SOCIALS.map((p) => `<div class="field" style="display:grid;grid-template-columns:44px 1fr;gap:10px;align-items:center">
      <span class="social" style="--brand:${p.color}">${ICONS[p.id]}</span>
      <div><label for="s-${p.id}" style="margin:0">${p.label}</label>
      <input id="s-${p.id}" value="${esc(s.socials[p.id])}" placeholder="${esc(SOCIAL_HINTS[p.id])}" /></div>
    </div>`).join("")}
  </div>
  <div class="panel">
    <h2>Website settings</h2>
    <div class="row">
      <div class="field"><label for="s-name">Website name</label><input id="s-name" value="${esc(s.name)}" /></div>
      <div class="field"><label for="s-author">Your name (author)</label><input id="s-author" value="${esc(s.author)}" /></div>
    </div>
    <div class="field"><label for="s-tagline">Tagline (below the name)</label><input id="s-tagline" value="${esc(s.tagline)}" /></div>
    ${imageFieldHTML("s-photo", "Your photo (About section)", s.photo)}
    <div class="field"><label for="s-about">About me</label><textarea id="s-about" rows="5">${esc(s.about)}</textarea></div>
  </div>
  <button class="btn" id="s-save">💾 Save</button>`;
  setupImageFields($("view"));
  $("s-save").onclick = () =>
    !uploadsPending() && busy($("s-save"), "Saving…", async () => {
      const socials = {};
      SOCIALS.forEach((p) => {
        const v = $(`s-${p.id}`).value.trim();
        if (v) socials[p.id] = v;
      });
      const next = {
        ...DB.site,
        name: $("s-name").value.trim() || "My Website",
        author: $("s-author").value.trim(),
        tagline: $("s-tagline").value.trim(),
        photo: $("s-photo").value.trim(),
        about: $("s-about").value.trim(),
        socials,
      };
      await GH.put(PATHS.site, JSON.stringify(next, null, 2) + "\n", "Update site settings");
      DB.site = next;
      status(PUBLISHED("index.html#about"), "ok");
    });
}

// ---------- Boot ----------
document.addEventListener("DOMContentLoaded", async () => {
  await renderChrome("");
  $("admin-tabs").addEventListener("click", (e) => {
    const t = e.target.closest(".tab[data-tab]");
    if (t) { status(""); showTab(t.dataset.tab); }
  });
  $("logout").onclick = logout;
  $("login-btn").onclick = () =>
    busy($("login-btn"), "Checking…", async () => {
      const token = $("token").value.trim();
      if (!token) throw new Error("Token is empty");
      await login(token, $("remember").checked);
    });
  const saved = savedToken();
  if (saved) {
    status("⏳ Logging in…");
    let remembered = false;
    try { remembered = !!localStorage.getItem("ghToken"); } catch (e) {}
    try { await login(saved, remembered); }
    catch (e) { status(`The saved token isn't working (${esc(e.message)}). Please enter a new token.`, "err"); }
  }
});
