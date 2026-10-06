// Shared helpers used by every page: theme, header/footer, data loading, markdown.

// ---------- Theme (applied immediately to avoid a flash) ----------
(function () {
  let saved = null;
  try { saved = localStorage.getItem("theme"); } catch (e) {}
  if (saved) document.documentElement.setAttribute("data-theme", saved);
})();

// ---------- Small utilities ----------
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const param = (name) => new URLSearchParams(location.search).get(name);

function fmtDate(d, opts) {
  if (!d) return "";
  const date = new Date(String(d).length === 10 ? d + "T00:00:00" : d);
  if (isNaN(date)) return "";
  return date.toLocaleDateString("en-IN", opts || { day: "numeric", month: "short", year: "numeric" });
}

function readingTime(text) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200)) + " min read";
}

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

// ---------- Data loading (cache-busted so new uploads show quickly) ----------
async function loadJSON(path, fallback) {
  try {
    const res = await fetch(`${path}?t=${Date.now()}`);
    if (!res.ok) throw new Error(res.status);
    return await res.json();
  } catch (e) {
    if (fallback !== undefined) return fallback;
    throw e;
  }
}

async function loadText(path) {
  const res = await fetch(`${path}?t=${Date.now()}`);
  if (!res.ok) throw new Error(`Could not load ${path}`);
  return res.text();
}

let _site;
async function getSite() {
  if (!_site) _site = await loadJSON("content/site.json", { name: "My Website", socials: {} });
  return _site;
}

// ---------- Markdown ----------
function renderMarkdown(text) {
  const html = marked.parse(String(text || ""));
  return DOMPurify.sanitize(html, { ADD_ATTR: ["target"] });
}

// ---------- Social links ----------
function socialHref(id, value) {
  const v = String(value || "").trim();
  if (!v) return "";
  if (id === "email") return v.startsWith("mailto:") ? v : `mailto:${v}`;
  if (id === "whatsapp" && /^[+\d\s-]+$/.test(v)) return `https://wa.me/${v.replace(/\D/g, "")}`;
  return /^https?:\/\//.test(v) ? v : `https://${v}`;
}

function socialLinksHTML(site, extraClass = "") {
  const socials = site.socials || {};
  return SOCIALS.filter((s) => socials[s.id])
    .map(
      (s) => `<a class="social ${extraClass}" href="${esc(socialHref(s.id, socials[s.id]))}" target="_blank" rel="noopener"
        style="--brand:${s.color}" title="${esc(s.label)}" aria-label="${esc(s.label)}">${ICONS[s.id]}</a>`
    )
    .join("");
}

// ---------- Header & footer ----------
async function renderChrome(active) {
  const site = await getSite();
  const nav = [
    ["index.html", "Home", "home"],
    ["articles.html", "Articles", "articles"],
    ["index.html#about", "About", "about"],
  ];
  const header = document.getElementById("site-header");
  if (header) {
    header.innerHTML = `<header class="topbar">
      <nav class="container nav">
        <a href="index.html" class="logo">${esc(site.name)}<span>.</span></a>
        <ul class="nav-links" id="nav-links">
          ${nav.map(([href, label, key]) => `<li><a href="${href}" class="${key === active ? "active" : ""}">${label}</a></li>`).join("")}
          <li><button class="icon-btn" id="theme-toggle" aria-label="Toggle dark mode"></button></li>
        </ul>
        <button class="icon-btn menu-toggle" id="menu-toggle" aria-label="Open menu">☰</button>
      </nav>
    </header>`;
    const root = document.documentElement;
    const btn = document.getElementById("theme-toggle");
    const paint = () => (btn.textContent = root.getAttribute("data-theme") === "dark" ? "☀️" : "🌙");
    paint();
    btn.addEventListener("click", () => {
      const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try { localStorage.setItem("theme", next); } catch (e) {}
      paint();
    });
    document.getElementById("menu-toggle").addEventListener("click", () =>
      document.getElementById("nav-links").classList.toggle("open")
    );
  }

  const footer = document.getElementById("site-footer");
  if (footer) {
    const socials = socialLinksHTML(site);
    footer.innerHTML = `<footer>
      <div class="container">
        ${socials ? `<div class="socials center">${socials}</div>` : ""}
        <p>© ${new Date().getFullYear()} ${esc(site.name)} · <a href="admin.html">Admin</a></p>
      </div>
    </footer>`;
  }
  if (site.name && !document.title.includes(site.name)) document.title += ` | ${site.name}`;
  return site;
}

// ---------- Reading font size (articles) ----------
function setupFontControls(container) {
  const el = document.getElementById("font-controls");
  if (!el) return;
  let size = 1.08;
  try { size = parseFloat(localStorage.getItem("readSize")) || size; } catch (e) {}
  const apply = () => {
    container.style.fontSize = size + "rem";
    try { localStorage.setItem("readSize", size); } catch (e) {}
  };
  el.innerHTML = `<button class="icon-btn" data-d="-1" aria-label="Smaller text">A−</button>
    <button class="icon-btn" data-d="1" aria-label="Larger text">A+</button>`;
  el.addEventListener("click", (e) => {
    const d = e.target.closest("button")?.dataset.d;
    if (!d) return;
    size = Math.min(1.5, Math.max(0.9, size + d * 0.08));
    apply();
  });
  apply();
}

function showError(el, msg) {
  el.innerHTML = `<p class="empty">${esc(msg)}</p>`;
}
