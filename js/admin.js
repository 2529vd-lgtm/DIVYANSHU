// Admin page: upload and edit articles and site settings.
// Content lives in the content/ folder; every save becomes a commit on GitHub.

const PATHS = {
  site: "content/site.json",
  articles: "content/articles.json",
  article: (id) => `content/articles/${id}.md`,
};
const MAX_UPLOAD_MB = 25;
const DB = { site: {}, articles: [] };
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
  document.querySelectorAll("#admin-tabs .tab[data-tab]").forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
  ({ articles: articleList, settings: settingsForm })[tab]();
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
