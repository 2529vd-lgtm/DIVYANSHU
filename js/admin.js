// Admin page: upload and edit articles, exams, study material and site settings.
// Content lives in the content/ folder; every save becomes a commit on GitHub.

const PATHS = {
  site: "content/site.json",
  articles: "content/articles.json",
  exams: "content/exams.json",
  items: "content/exam-items.json",
  article: (id) => `content/articles/${id}.md`,
  item: (it) => `content/exam-items/${it.id}.${it.type === "mock" ? "json" : "md"}`,
};
const MAX_UPLOAD_MB = 25;
const DB = { site: {}, articles: [], exams: [], items: [] };
let currentTab = "articles";

const $ = (id) => document.getElementById(id);
const today = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
const makeId = (title, prefix) => `${slugify(title) || prefix}-${Date.now().toString(36)}`;
const byDate = (a, b) => String(b.date).localeCompare(String(a.date));

function status(msg, kind = "info") {
  $("status").innerHTML = msg ? `<div class="status ${kind}">${msg}</div>` : "";
  if (msg) $("status").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

const PUBLISHED = (href) =>
  `✅ Save ho gaya! Website par 1–2 minute mein dikhega${href ? `: <a href="${href}" target="_blank">dekhein</a>` : "."}`;

// Runs a save action with a busy button and a friendly error message.
async function busy(btn, label, fn) {
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = label;
  status("⏳ Save ho raha hai… page band mat karein.");
  try {
    await fn();
  } catch (e) {
    console.error(e);
    const hint = e.status === 401 || e.status === 403 ? " Token galat hai ya uski permission kam hai. Logout karke naya token daalein." : "";
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
  if (!info) throw new Error("Repository nahi mili. Token banate waqt DIVYANSHU repo chuna tha?");
  if (!info.permissions || !info.permissions.push) throw new Error("Is token ke paas likhne ki permission nahi hai (Contents: Read and write chahiye).");
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
  const [site, articles, exams, items] = await Promise.all([
    GH.readJSON(PATHS.site, { socials: {} }),
    GH.readJSON(PATHS.articles, { articles: [] }),
    GH.readJSON(PATHS.exams, { exams: [] }),
    GH.readJSON(PATHS.items, { items: [] }),
  ]);
  DB.site = site.data;
  DB.site.socials = DB.site.socials || {};
  DB.articles = articles.data.articles || [];
  DB.exams = exams.data.exams || [];
  DB.items = items.data.items || [];
}

function logout() {
  try { localStorage.removeItem("ghToken"); sessionStorage.removeItem("ghToken"); } catch (e) {}
  location.reload();
}

// ---------- Tabs ----------
function showTab(tab) {
  currentTab = tab;
  document.querySelectorAll("#admin-tabs .tab[data-tab]").forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
  ({ articles: articleList, exams: examList, items: itemList, settings: settingsForm })[tab]();
}

// ---------- Rich text editor (Markdown with toolbar + preview + uploads) ----------
const TOOLS = [
  ["H2", "Bada heading", (s) => `\n## ${s || "Heading"}\n`],
  ["H3", "Chhota heading", (s) => `\n### ${s || "Sub-heading"}\n`],
  ["B", "Bold", (s) => `**${s || "bold text"}**`],
  ["I", "Italic", (s) => `*${s || "italic text"}*`],
  ["• List", "Bullet list", (s) => "\n" + (s || "point").split("\n").map((l) => `- ${l}`).join("\n") + "\n"],
  ["1. List", "Numbered list", (s) => "\n" + (s || "point").split("\n").map((l, i) => `${i + 1}. ${l}`).join("\n") + "\n"],
  ["❝ Quote", "Quote / highlight box", (s) => `\n> ${s || "Important line"}\n`],
  ["🔗 Link", "Link", (s) => `[${s || "link text"}](https://)`],
  ["▦ Table", "Table", () => `\n| Column 1 | Column 2 |\n|---|---|\n| ... | ... |\n`],
  ["🙈 Answer", "Answer jo click karne par dikhe (PYQ ke liye)", (s) => `\n<details><summary>Answer dekhein</summary>\n\n${s || "Answer yahan likhein"}\n\n</details>\n`],
  ["― Line", "Divider line", () => `\n---\n`],
];

function editorHTML(id, value, rows = 16) {
  return `<div class="editor" data-editor="${id}">
    <div class="editor-tools">
      ${TOOLS.map((t, i) => `<button type="button" class="icon-btn" data-tool="${i}" title="${esc(t[1])}">${esc(t[0])}</button>`).join("")}
      <button type="button" class="icon-btn" data-upload="image" title="Photo upload karein">🖼️ Photo</button>
      <button type="button" class="icon-btn" data-upload="file" title="PDF ya koi file upload karein">📎 PDF/File</button>
      <button type="button" class="icon-btn" data-preview title="Kaisa dikhega">👁️ Preview</button>
    </div>
    <textarea id="${id}" rows="${rows}" placeholder="Yahan likhna shuru karein… (toolbar se heading, bold, list, photo add kar sakte hain)">${esc(value || "")}</textarea>
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

function setupEditors(root) {
  root.querySelectorAll("[data-editor]").forEach((ed) => {
    const ta = ed.querySelector("textarea");
    const pv = ed.querySelector(".preview");
    ed.querySelector(".editor-tools").addEventListener("click", async (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.tool !== undefined) {
        const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
        insertAtCursor(ta, TOOLS[b.dataset.tool][2](sel));
      } else if (b.dataset.upload) {
        const file = await pickFile(b.dataset.upload === "image" ? "image/*" : "");
        if (!file) return;
        await busy(b, "Uploading…", async () => {
          const path = await uploadFile(file);
          const isImg = file.type.startsWith("image/");
          insertAtCursor(ta, isImg ? `\n![${file.name}](${path})\n` : `\n[📄 ${file.name} (download/open)](${path})\n`);
          status("✅ File upload ho gayi. Ab content save karna na bhoolein.", "ok");
        });
      } else if (b.dataset.preview !== undefined) {
        const showing = !pv.classList.contains("hidden");
        pv.classList.toggle("hidden", showing);
        ta.classList.toggle("hidden", !showing);
        b.textContent = showing ? "👁️ Preview" : "✏️ Edit";
        if (!showing) pv.innerHTML = previewHTML(ta.value) || "<p class='muted'>Kuch nahi likha.</p>";
      }
    });
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

async function uploadFile(file) {
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) throw new Error(`File ${MAX_UPLOAD_MB} MB se badi hai`);
  const base64 = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = () => reject(new Error("File padh nahi paye"));
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
      <input id="${id}" value="${esc(value || "")}" placeholder="Upload karein ya image link paste karein" />
      <button type="button" class="btn small ghost" data-image-upload="${id}">Upload</button>
    </div>
  </div>`;
}

function setupImageFields(root) {
  root.querySelectorAll("[data-image-upload]").forEach((b) =>
    b.addEventListener("click", async () => {
      const file = await pickFile("image/*");
      if (!file) return;
      await busy(b, "…", async () => {
        $(b.dataset.imageUpload).value = await uploadFile(file);
        status("✅ Photo upload ho gayi. Ab Save/Publish dabayein.", "ok");
      });
    })
  );
}

// =====================================================================
// Articles
// =====================================================================
function articleList() {
  const list = [...DB.articles].sort(byDate);
  $("view").innerHTML = `<div class="panel">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px">
      <h2 style="margin:0">Articles (${list.length})</h2>
      <button class="btn" id="new-article">+ Naya article</button>
    </div>
    <p class="help">Blog, Story, Editorial ya Report: sab yahan se upload karein.</p>
    <ul class="admin-list">
      ${list.map((a) => `<li><div><b>${esc(a.title)}</b><div class="meta">${esc(a.category)} · ${fmtDate(a.date)}</div></div>
        <span class="actions">
          <a class="btn small ghost" href="article.html?id=${encodeURIComponent(a.id)}" target="_blank">View</a>
          <button class="btn small ghost" data-edit="${esc(a.id)}">Edit</button>
          <button class="btn small outline" data-del="${esc(a.id)}">Delete</button>
        </span></li>`).join("") || `<li class="muted">Abhi koi article nahi hai.</li>`}
    </ul>
  </div>`;
  $("new-article").onclick = () => articleForm(null);
  $("view").querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => articleForm(DB.articles.find((a) => a.id === b.dataset.edit))));
  $("view").querySelectorAll("[data-del]").forEach((b) =>
    (b.onclick = () => {
      const a = DB.articles.find((x) => x.id === b.dataset.del);
      if (!confirm(`"${a.title}" delete karein? Ye wapas nahi aayega.`)) return;
      busy(b, "…", async () => {
        await GH.remove(PATHS.article(a.id), `Delete article: ${a.title}`);
        const data = await GH.updateJSON(PATHS.articles, { articles: [] }, (d) => {
          d.articles = d.articles.filter((x) => x.id !== a.id);
        }, `Remove article from index: ${a.title}`);
        DB.articles = data.articles;
        articleList();
        status("🗑️ Article delete ho gaya.", "ok");
      });
    })
  );
}

async function articleForm(a) {
  let body = "";
  if (a) {
    status("⏳ Article load ho raha hai…");
    const f = await GH.read(PATHS.article(a.id));
    body = f ? f.text : "";
    status("");
  }
  $("view").innerHTML = `<div class="panel">
    <h2>${a ? "Article edit karein" : "Naya article"}</h2>
    <div class="field"><label for="a-title">Title (heading) *</label><input id="a-title" value="${esc(a?.title)}" /></div>
    <div class="row">
      <div class="field"><label for="a-cat">Type</label>
        <select id="a-cat">${CATEGORIES.map((c) => `<option ${a?.category === c ? "selected" : ""}>${c}</option>`).join("")}</select></div>
      <div class="field"><label for="a-date">Date</label><input type="date" id="a-date" value="${esc(a?.date || today())}" /></div>
      <div class="field"><label for="a-author">Author</label><input id="a-author" value="${esc(a?.author ?? DB.site.author ?? "")}" /></div>
    </div>
    <div class="field"><label for="a-summary">Short summary (1–2 lines, home page par dikhega)</label><textarea id="a-summary" rows="2" style="min-height:0">${esc(a?.summary)}</textarea></div>
    ${imageFieldHTML("a-cover", "Cover photo (optional)", a?.cover)}
    <div class="field"><label>Article *</label>${editorHTML("a-body", body, 20)}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn" id="a-save">${a ? "Update karein" : "🚀 Publish karein"}</button>
      <button class="btn ghost" id="a-cancel">Cancel</button>
    </div>
  </div>`;
  setupEditors($("view"));
  setupImageFields($("view"));
  $("a-cancel").onclick = articleList;
  $("a-save").onclick = () => {
    const meta = {
      id: a?.id || makeId($("a-title").value, "article"),
      title: $("a-title").value.trim(),
      category: $("a-cat").value,
      date: $("a-date").value || today(),
      author: $("a-author").value.trim(),
      summary: $("a-summary").value.trim(),
      cover: $("a-cover").value.trim(),
    };
    const text = $("a-body").value;
    if (!meta.title || !text.trim()) return status("⚠️ Title aur article dono likhna zaroori hai.", "err");
    busy($("a-save"), "Saving…", async () => {
      await GH.put(PATHS.article(meta.id), text, `${a ? "Update" : "Publish"} ${meta.category.toLowerCase()}: ${meta.title}`);
      const data = await GH.updateJSON(PATHS.articles, { articles: [] }, (d) => {
        d.articles = [meta, ...d.articles.filter((x) => x.id !== meta.id)].sort(byDate);
      }, `Update article index: ${meta.title}`);
      DB.articles = data.articles;
      articleList();
      status(PUBLISHED(`article.html?id=${encodeURIComponent(meta.id)}`), "ok");
    });
  };
}

// =====================================================================
// Exams
// =====================================================================
function examList() {
  const list = [...DB.exams].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  $("view").innerHTML = `<div class="panel">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px">
      <h2 style="margin:0">Exams (${list.length})</h2>
      <button class="btn" id="new-exam">+ Naya exam</button>
    </div>
    <p class="help">Exam ka naam, date (countdown ke liye), syllabus aur subjects yahan set karein. Notes/PYQ/Mock "Study Material" tab se daalein.</p>
    <ul class="admin-list">
      ${list.map((e) => `<li><div><b>${esc(e.name)}</b><div class="meta">${fmtDate(e.date)} · ${(e.subjects || []).length} subjects · ${DB.items.filter((i) => i.exam === e.id).length} items</div></div>
        <span class="actions">
          <a class="btn small ghost" href="exam.html?id=${encodeURIComponent(e.id)}" target="_blank">View</a>
          <button class="btn small ghost" data-edit="${esc(e.id)}">Edit</button>
          <button class="btn small outline" data-del="${esc(e.id)}">Delete</button>
        </span></li>`).join("") || `<li class="muted">Abhi koi exam nahi hai.</li>`}
    </ul>
  </div>`;
  $("new-exam").onclick = () => examForm(null);
  $("view").querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => examForm(DB.exams.find((e) => e.id === b.dataset.edit))));
  $("view").querySelectorAll("[data-del]").forEach((b) =>
    (b.onclick = () => {
      const ex = DB.exams.find((e) => e.id === b.dataset.del);
      const count = DB.items.filter((i) => i.exam === ex.id).length;
      if (count) return status(`⚠️ "${esc(ex.name)}" mein ${count} notes/tests hain. Pehle unhe Study Material tab se delete karein.`, "err");
      if (!confirm(`"${ex.name}" delete karein?`)) return;
      busy(b, "…", async () => {
        const data = await GH.updateJSON(PATHS.exams, { exams: [] }, (d) => {
          d.exams = d.exams.filter((x) => x.id !== ex.id);
        }, `Delete exam: ${ex.name}`);
        DB.exams = data.exams;
        examList();
        status("🗑️ Exam delete ho gaya.", "ok");
      });
    })
  );
}

function subjectRowHTML(s = {}) {
  return `<div class="subject-row" data-id="${esc(s.id || "")}">
    <input class="subject-name" value="${esc(s.name || "")}" placeholder="Subject ka naam, jaise History" />
    <button type="button" class="btn small outline" data-remove-subject>✕</button>
  </div>`;
}

function examForm(ex) {
  $("view").innerHTML = `<div class="panel">
    <h2>${ex ? "Exam edit karein" : "Naya exam"}</h2>
    <div class="row">
      <div class="field"><label for="e-name">Exam ka naam *</label><input id="e-name" value="${esc(ex?.name)}" placeholder="BPSC 72nd Prelims" /></div>
      <div class="field"><label for="e-full">Poora naam (optional)</label><input id="e-full" value="${esc(ex?.fullName)}" placeholder="Bihar Public Service Commission…" /></div>
    </div>
    <div class="row">
      <div class="field"><label for="e-date">Exam date *</label><input type="date" id="e-date" value="${esc(ex?.date)}" /></div>
      <div class="field"><label for="e-time">Time (optional)</label><input type="time" id="e-time" value="${esc(ex?.time)}" /></div>
    </div>
    <div class="field"><label for="e-desc">Short info (pattern, marks, etc.)</label><textarea id="e-desc" rows="4" style="min-height:0">${esc(ex?.description)}</textarea></div>
    <div class="field"><label>Syllabus</label>${editorHTML("e-syllabus", ex?.syllabus, 14)}</div>
    <div class="field"><label>Subjects</label>
      <div id="subjects">${(ex?.subjects?.length ? ex.subjects : [{}]).map(subjectRowHTML).join("")}</div>
      <button type="button" class="btn small ghost" id="add-subject">+ Subject jodein</button>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn" id="e-save">${ex ? "Update karein" : "💾 Save karein"}</button>
      <button class="btn ghost" id="e-cancel">Cancel</button>
    </div>
  </div>`;
  setupEditors($("view"));
  $("e-cancel").onclick = examList;
  $("add-subject").onclick = () => $("subjects").insertAdjacentHTML("beforeend", subjectRowHTML());
  $("subjects").addEventListener("click", (e) => {
    const b = e.target.closest("[data-remove-subject]");
    if (!b) return;
    const row = b.closest(".subject-row");
    const used = ex && row.dataset.id && DB.items.some((i) => i.exam === ex.id && i.subject === row.dataset.id);
    if (used && !confirm("Is subject mein notes/tests hain. Hatane par wo 'General' mein dikhenge. Hatayein?")) return;
    row.remove();
  });
  $("e-save").onclick = () => {
    const taken = new Set();
    const subjects = [...document.querySelectorAll(".subject-row")]
      .map((row, i) => {
        const name = row.querySelector(".subject-name").value.trim();
        if (!name) return null;
        let id = row.dataset.id || slugify(name) || `subject-${i + 1}`;
        while (taken.has(id)) id += "-2";
        taken.add(id);
        return { id, name };
      })
      .filter(Boolean);
    const exam = {
      id: ex?.id || makeId($("e-name").value, "exam"),
      name: $("e-name").value.trim(),
      fullName: $("e-full").value.trim(),
      date: $("e-date").value,
      time: $("e-time").value,
      description: $("e-desc").value.trim(),
      syllabus: $("e-syllabus").value,
      subjects,
    };
    if (!exam.name || !exam.date) return status("⚠️ Exam ka naam aur date zaroori hai.", "err");
    busy($("e-save"), "Saving…", async () => {
      const data = await GH.updateJSON(PATHS.exams, { exams: [] }, (d) => {
        const i = d.exams.findIndex((x) => x.id === exam.id);
        if (i >= 0) d.exams[i] = exam;
        else d.exams.push(exam);
      }, `${ex ? "Update" : "Add"} exam: ${exam.name}`);
      DB.exams = data.exams;
      examList();
      status(PUBLISHED(`exam.html?id=${encodeURIComponent(exam.id)}`), "ok");
    });
  };
}

// =====================================================================
// Study material (long/short notes, mind map, PYQ, mock test)
// =====================================================================
let itemFilter = "";

function itemList() {
  if (!DB.exams.length) {
    $("view").innerHTML = `<div class="panel"><p>Pehle <b>Exams</b> tab mein ek exam banayein, phir uske notes yahan daalein.</p></div>`;
    return;
  }
  const typeLabel = (t) => (ITEM_TYPES.find((x) => x.id === t) || {}).label || t;
  const list = DB.items.filter((i) => !itemFilter || i.exam === itemFilter).sort(byDate);
  $("view").innerHTML = `<div class="panel">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap">
      <h2 style="margin:0">Study Material (${list.length})</h2>
      <button class="btn" id="new-item">+ Naya notes / PYQ / mock</button>
    </div>
    <div class="field"><select id="item-filter"><option value="">Sab exams</option>
      ${DB.exams.map((e) => `<option value="${esc(e.id)}" ${e.id === itemFilter ? "selected" : ""}>${esc(e.name)}</option>`).join("")}</select></div>
    <ul class="admin-list">
      ${list.map((i) => {
        const ex = DB.exams.find((e) => e.id === i.exam);
        const sub = ex?.subjects?.find((s) => s.id === i.subject);
        const href = i.type === "mock" ? `mock.html?id=${encodeURIComponent(i.id)}` : `item.html?id=${encodeURIComponent(i.id)}`;
        return `<li><div><b>${esc(i.title)}</b><div class="meta">${esc(typeLabel(i.type))} · ${esc(ex?.name || "?")} · ${esc(sub?.name || "General")}</div></div>
          <span class="actions">
            <a class="btn small ghost" href="${href}" target="_blank">View</a>
            <button class="btn small ghost" data-edit="${esc(i.id)}">Edit</button>
            <button class="btn small outline" data-del="${esc(i.id)}">Delete</button>
          </span></li>`;
      }).join("") || `<li class="muted">Abhi kuch nahi hai.</li>`}
    </ul>
  </div>`;
  $("item-filter").onchange = (e) => { itemFilter = e.target.value; itemList(); };
  $("new-item").onclick = () => itemForm(null);
  $("view").querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => itemForm(DB.items.find((i) => i.id === b.dataset.edit))));
  $("view").querySelectorAll("[data-del]").forEach((b) =>
    (b.onclick = () => {
      const it = DB.items.find((x) => x.id === b.dataset.del);
      if (!confirm(`"${it.title}" delete karein?`)) return;
      busy(b, "…", async () => {
        await GH.remove(PATHS.item(it), `Delete ${it.type}: ${it.title}`);
        const data = await GH.updateJSON(PATHS.items, { items: [] }, (d) => {
          d.items = d.items.filter((x) => x.id !== it.id);
        }, `Remove from study material index: ${it.title}`);
        DB.items = data.items;
        itemList();
        status("🗑️ Delete ho gaya.", "ok");
      });
    })
  );
}

const TYPE_HELP = {
  long: "Detail notes likhein. Heading, list, table, photo sab use kar sakte hain.",
  short: "Revision ke liye chhote points likhein.",
  mindmap: "Mind map ke liye: sabse upar <code># Topic</code>, phir <code>## Branch</code> aur unke neeche <code>- point</code> likhein. Ye apne aap mind map ban jayega. Ya sirf 🖼️ Photo button se mind map ki image upload kar dein.",
  pyq: "Question likhein, aur answer ko <b>🙈 Answer</b> button se chhupa dein taaki padhne wala pehle khud soche. PDF bhi 📎 se upload kar sakte hain.",
};

const MINDMAP_TEMPLATE = `# Topic ka naam
## Branch 1
- Point 1
- Point 2
## Branch 2
- Point 1
  - Sub point
## Branch 3
- Point 1
`;

let mockQs = [];

async function itemForm(it) {
  let body = "";
  let test = { duration: 10, negative: 0, questions: [] };
  if (it) {
    status("⏳ Load ho raha hai…");
    const f = await GH.read(PATHS.item(it));
    status("");
    if (f) {
      if (it.type === "mock") test = JSON.parse(f.text);
      else body = f.text;
    }
  }
  mockQs = (test.questions || []).map((q) => ({ ...q, options: [...q.options, "", "", "", ""].slice(0, Math.max(4, q.options.length)) }));
  const examId = it?.exam || itemFilter || DB.exams[0].id;

  $("view").innerHTML = `<div class="panel">
    <h2>${it ? "Edit karein" : "Naya study material"}</h2>
    <div class="row">
      <div class="field"><label for="i-exam">Exam *</label><select id="i-exam">
        ${DB.exams.map((e) => `<option value="${esc(e.id)}" ${e.id === examId ? "selected" : ""}>${esc(e.name)}</option>`).join("")}</select></div>
      <div class="field"><label for="i-subject">Subject</label><select id="i-subject"></select></div>
      <div class="field"><label for="i-type">Type *</label><select id="i-type" ${it ? "disabled" : ""}>
        ${ITEM_TYPES.map((t) => `<option value="${t.id}" ${it?.type === t.id ? "selected" : ""}>${t.label}</option>`).join("")}</select></div>
    </div>
    <div class="row">
      <div class="field" style="grid-column: span 2"><label for="i-title">Title *</label><input id="i-title" value="${esc(it?.title)}" placeholder="Jaise: Fundamental Rights" /></div>
      <div class="field"><label for="i-date">Date</label><input type="date" id="i-date" value="${esc(it?.date || today())}" /></div>
    </div>
    <div class="field"><label for="i-summary">Short description (optional)</label><input id="i-summary" value="${esc(it?.summary)}" /></div>

    <div id="notes-box">
      <p class="help" id="type-help" style="margin-bottom:8px"></p>
      ${editorHTML("i-body", body, 20)}
    </div>

    <div id="mock-box">
      <div class="row">
        <div class="field"><label for="m-duration">Time (minutes)</label><input type="number" min="1" id="m-duration" value="${esc(test.duration)}" /></div>
        <div class="field"><label for="m-negative">Negative marking (galat answer par kitna katega)</label><input type="number" min="0" step="0.01" id="m-negative" value="${esc(test.negative)}" /></div>
      </div>
      <details class="qbuild" style="margin-bottom:14px">
        <summary><b>⚡ Bahut saare questions ek saath paste karein</b></summary>
        <p class="help">Is format mein likhein (Word/WhatsApp se copy-paste bhi chalega):</p>
        <pre class="help" style="background:var(--surface);padding:8px;border-radius:6px;overflow-x:auto">1. Question ka text?
A) Option 1
B) Option 2
C) Option 3
D) Option 4
Answer: B
Explanation: Kyunki…</pre>
        <textarea id="bulk" rows="8" placeholder="Questions yahan paste karein…"></textarea>
        <button type="button" class="btn small" id="bulk-add" style="margin-top:8px">Questions jodein</button>
      </details>
      <div id="qlist"></div>
      <button type="button" class="btn small ghost" id="add-q">+ Ek question jodein</button>
    </div>

    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px">
      <button class="btn" id="i-save">${it ? "Update karein" : "🚀 Publish karein"}</button>
      <button class="btn ghost" id="i-cancel">Cancel</button>
    </div>
  </div>`;
  setupEditors($("view"));
  $("i-cancel").onclick = itemList;

  const fillSubjects = () => {
    const ex = DB.exams.find((e) => e.id === $("i-exam").value);
    $("i-subject").innerHTML = `<option value="">General</option>` +
      (ex?.subjects || []).map((s) => `<option value="${esc(s.id)}" ${it?.subject === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("");
  };
  const typeChanged = () => {
    const t = $("i-type").value;
    $("notes-box").classList.toggle("hidden", t === "mock");
    $("mock-box").classList.toggle("hidden", t !== "mock");
    $("type-help").innerHTML = TYPE_HELP[t] || "";
    if (t === "mindmap" && !$("i-body").value.trim()) $("i-body").value = MINDMAP_TEMPLATE;
    if (t !== "mindmap" && $("i-body").value === MINDMAP_TEMPLATE) $("i-body").value = "";
  };
  $("i-exam").onchange = fillSubjects;
  $("i-type").onchange = typeChanged;
  fillSubjects();
  typeChanged();

  // Mock question builder
  drawQuestions();
  $("add-q").onclick = () => { mockQs.push({ q: "", options: ["", "", "", ""], answer: null, explanation: "" }); drawQuestions(); };
  $("bulk-add").onclick = () => {
    const parsed = parseQuestions($("bulk").value);
    if (!parsed.length) return status("⚠️ Koi question samajh nahi aaya. Upar diya format check karein.", "err");
    mockQs.push(...parsed);
    $("bulk").value = "";
    drawQuestions();
    const noAns = parsed.filter((q) => q.answer === null).length;
    status(`✅ ${parsed.length} questions jud gaye.${noAns ? ` ⚠️ ${noAns} mein answer nahi mila, neeche sahi option chunein.` : ""}`, noAns ? "info" : "ok");
  };

  $("i-save").onclick = () => {
    const type = $("i-type").value;
    const meta = {
      id: it?.id || makeId($("i-title").value, type),
      exam: $("i-exam").value,
      subject: $("i-subject").value,
      type,
      title: $("i-title").value.trim(),
      summary: $("i-summary").value.trim(),
      date: $("i-date").value || today(),
    };
    if (!meta.title) return status("⚠️ Title zaroori hai.", "err");
    let content;
    if (type === "mock") {
      const questions = [];
      for (const [n, q] of mockQs.entries()) {
        const opts = q.options.map((o, i) => ({ o: o.trim(), i })).filter((x) => x.o);
        const ans = opts.findIndex((x) => x.i === q.answer);
        if (!q.q.trim() || opts.length < 2 || ans < 0)
          return status(`⚠️ Question ${n + 1} adhoora hai: question, kam se kam 2 options aur sahi answer chunna zaroori hai.`, "err");
        questions.push({ q: q.q.trim(), options: opts.map((x) => x.o), answer: ans, explanation: (q.explanation || "").trim() });
      }
      if (!questions.length) return status("⚠️ Kam se kam ek question jodein.", "err");
      const duration = Math.max(1, Number($("m-duration").value) || questions.length);
      const negative = Math.max(0, Number($("m-negative").value) || 0);
      content = JSON.stringify({ duration, negative, questions }, null, 2) + "\n";
      Object.assign(meta, { questions: questions.length, duration });
    } else {
      content = $("i-body").value;
      if (!content.trim()) return status("⚠️ Kuch content likhein.", "err");
    }
    busy($("i-save"), "Saving…", async () => {
      await GH.put(PATHS.item(meta), content, `${it ? "Update" : "Publish"} ${type}: ${meta.title}`);
      const data = await GH.updateJSON(PATHS.items, { items: [] }, (d) => {
        d.items = [meta, ...d.items.filter((x) => x.id !== meta.id)];
      }, `Update study material index: ${meta.title}`);
      DB.items = data.items;
      itemFilter = meta.exam;
      itemList();
      status(PUBLISHED(type === "mock" ? `mock.html?id=${encodeURIComponent(meta.id)}` : `item.html?id=${encodeURIComponent(meta.id)}`), "ok");
    });
  };
}

function drawQuestions() {
  const box = $("qlist");
  box.innerHTML = mockQs
    .map(
      (q, n) => `<div class="qbuild" data-n="${n}">
        <div style="display:flex;justify-content:space-between;align-items:center"><b>Question ${n + 1}</b>
          <button type="button" class="btn small outline" data-remove-q>✕ Hatayein</button></div>
        <textarea data-f="q" rows="2" style="min-height:0;margin-top:6px" placeholder="Question likhein">${esc(q.q)}</textarea>
        <div class="opts">
          ${q.options.map((o, i) => `<input type="radio" name="ans-${n}" data-ans="${i}" ${q.answer === i ? "checked" : ""} title="Sahi answer" />
            <input data-opt="${i}" value="${esc(o)}" placeholder="Option ${"ABCDEF"[i]}" />`).join("")}
        </div>
        <p class="help">⬅️ Sahi answer ke aage wala gola chunein.</p>
        <input data-f="explanation" value="${esc(q.explanation)}" placeholder="Explanation (optional)" style="margin-top:6px" />
      </div>`
    )
    .join("");
  box.oninput = (e) => {
    const card = e.target.closest("[data-n]");
    if (!card) return;
    const q = mockQs[card.dataset.n];
    if (e.target.dataset.f) q[e.target.dataset.f] = e.target.value;
    if (e.target.dataset.opt !== undefined) q.options[e.target.dataset.opt] = e.target.value;
  };
  box.onchange = (e) => {
    const card = e.target.closest("[data-n]");
    if (card && e.target.dataset.ans !== undefined) mockQs[card.dataset.n].answer = Number(e.target.dataset.ans);
  };
  box.onclick = (e) => {
    const card = e.target.closest("[data-n]");
    if (card && e.target.closest("[data-remove-q]")) {
      mockQs.splice(Number(card.dataset.n), 1);
      drawQuestions();
    }
  };
}

// Parses pasted questions in the "1. … / A) … / Answer: B / Explanation: …" format.
function parseQuestions(text) {
  const out = [];
  let q = null;
  let stage = "q";
  const finish = () => {
    if (q && q.q.trim() && q.options.length >= 2) {
      while (q.options.length < 4) q.options.push("");
      out.push(q);
    }
  };
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let m;
    // A numbered line starts a new question, unless we're still inside a question's text
    // (UPSC-style "1. Statement" lines belong to the current question).
    const numbered = (!q || stage !== "q") && line.match(/^(?:q(?:ues(?:tion)?)?\s*)?(\d+)\s*[.):-]\s*(.*)$/i);
    if ((m = numbered) || (m = line.match(/^(?:q|ques|question|प्रश्न)\s*[.:-]\s*(.*)$/i))) {
      finish();
      q = { q: (m[2] ?? m[1]) || "", options: [], answer: null, explanation: "" };
      stage = "q";
    } else if (q && (m = line.match(/^(?:ans(?:wer)?|correct(?: answer)?|उत्तर)\s*[.:-]?\s*\(?([a-f])\)?\b/i))) {
      q.answer = m[1].toUpperCase().charCodeAt(0) - 65;
      stage = "a";
    } else if (q && (m = line.match(/^(?:exp(?:lanation)?|sol(?:ution)?|व्याख्या)\s*[.:-]\s*(.*)$/i))) {
      q.explanation = m[1];
      stage = "e";
    } else if (q && stage !== "a" && stage !== "e" && (m = line.match(/^\(?([a-f])\s*[).:]\s*(.+)$/i))) {
      q.options.push(m[2].trim());
      stage = "o";
    } else if (q && stage === "q") {
      q.q += (q.q ? "\n" : "") + line;
    } else if (q && stage === "e") {
      q.explanation += " " + line;
    } else if (!q) {
      q = { q: line, options: [], answer: null, explanation: "" };
    }
  }
  finish();
  return out;
}

// =====================================================================
// Settings: site name, about, social media links
// =====================================================================
const SOCIAL_HINTS = {
  instagram: "https://instagram.com/aapka_username",
  youtube: "https://youtube.com/@aapka_channel",
  facebook: "https://facebook.com/aapka_page",
  x: "https://x.com/aapka_username",
  telegram: "https://t.me/aapka_channel",
  whatsapp: "Number (91XXXXXXXXXX) ya channel link",
  linkedin: "https://linkedin.com/in/aapka_naam",
  threads: "https://threads.net/@aapka_username",
  github: "https://github.com/aapka_username",
  email: "aapka@email.com",
};

function settingsForm() {
  const s = DB.site;
  $("view").innerHTML = `<div class="panel">
    <h2>🔗 Social media links</h2>
    <p class="help" style="margin-bottom:12px">Jo link daalenge, uska logo website par dikhega (home page, har article ke neeche aur footer mein). Khali chhodne par wo logo nahi dikhega.</p>
    ${SOCIALS.map((p) => `<div class="field" style="display:grid;grid-template-columns:44px 1fr;gap:10px;align-items:center">
      <span class="social" style="--brand:${p.color}">${ICONS[p.id]}</span>
      <div><label for="s-${p.id}" style="margin:0">${p.label}</label>
      <input id="s-${p.id}" value="${esc(s.socials[p.id])}" placeholder="${esc(SOCIAL_HINTS[p.id])}" /></div>
    </div>`).join("")}
  </div>
  <div class="panel">
    <h2>Website settings</h2>
    <div class="row">
      <div class="field"><label for="s-name">Website ka naam</label><input id="s-name" value="${esc(s.name)}" /></div>
      <div class="field"><label for="s-author">Aapka naam (author)</label><input id="s-author" value="${esc(s.author)}" /></div>
    </div>
    <div class="field"><label for="s-tagline">Tagline (naam ke neeche)</label><input id="s-tagline" value="${esc(s.tagline)}" /></div>
    ${imageFieldHTML("s-photo", "Aapki photo (About section)", s.photo)}
    <div class="field"><label for="s-about">About me</label><textarea id="s-about" rows="5">${esc(s.about)}</textarea></div>
  </div>
  <button class="btn" id="s-save">💾 Save karein</button>`;
  setupImageFields($("view"));
  $("s-save").onclick = () =>
    busy($("s-save"), "Saving…", async () => {
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
      if (!token) throw new Error("Token khali hai");
      await login(token, $("remember").checked);
    });
  const saved = savedToken();
  if (saved) {
    status("⏳ Login ho raha hai…");
    let remembered = false;
    try { remembered = !!localStorage.getItem("ghToken"); } catch (e) {}
    try { await login(saved, remembered); }
    catch (e) { status(`Purana token kaam nahi kar raha (${esc(e.message)}). Naya token daalein.`, "err"); }
  }
});
