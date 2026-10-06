// ---------- Theme toggle (remembered per browser) ----------
(function () {
  const root = document.documentElement;
  let saved = null;
  try { saved = localStorage.getItem("theme"); } catch (e) {}
  if (saved) root.setAttribute("data-theme", saved);

  document.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById("theme-toggle");
    if (!btn) return;
    const update = () => (btn.textContent = root.getAttribute("data-theme") === "dark" ? "☀️" : "🌙");
    update();
    btn.addEventListener("click", () => {
      const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try { localStorage.setItem("theme", next); } catch (e) {}
      update();
    });
  });
})();

document.addEventListener("DOMContentLoaded", () => {
  // ---------- Mobile menu ----------
  const menuBtn = document.getElementById("menu-toggle");
  const links = document.querySelector(".nav-links");
  if (menuBtn && links) menuBtn.addEventListener("click", () => links.classList.toggle("open"));

  // ---------- Footer year ----------
  const year = document.getElementById("year");
  if (year) year.textContent = new Date().getFullYear();

  // ---------- Page renderers ----------
  if (typeof PROJECTS === "undefined") return;
  renderProjects();
  renderSkills();
  renderList({ gridId: "blog-grid", items: BLOG_POSTS, key: "category", searchId: "blog-search", filterId: "blog-filters", card: blogCard });
  renderList({ gridId: "notes-grid", items: NOTES, key: "subject", searchId: "notes-search", filterId: "notes-filters", card: noteCard });
  renderLatest();
  setupContactForm();
});

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const formatDate = (d) =>
  new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

function blogCard(p) {
  return `<a class="card" href="${p.url}" style="color:inherit;text-decoration:none">
    <div class="meta">${formatDate(p.date)}</div>
    <h3>${escapeHtml(p.title)}</h3>
    <p>${escapeHtml(p.summary)}</p>
    <span class="tag">${escapeHtml(p.category)}</span>
  </a>`;
}

function noteCard(n) {
  return `<a class="card" href="${n.url}" style="color:inherit;text-decoration:none">
    <span class="tag" style="margin-top:0">${escapeHtml(n.subject)}</span>
    <h3 style="margin-top:10px">${escapeHtml(n.title)}</h3>
    <p>${escapeHtml(n.summary)}</p>
  </a>`;
}

function renderProjects() {
  const grid = document.getElementById("projects-grid");
  if (!grid) return;
  grid.innerHTML = PROJECTS.map(
    (p) => `<div class="card">
      <h3>${escapeHtml(p.title)}</h3>
      <p>${escapeHtml(p.description)}</p>
      <div>${p.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>
      ${p.link && p.link !== "#" ? `<p style="margin-top:12px"><a href="${p.link}">View →</a></p>` : ""}
    </div>`
  ).join("");
}

function renderSkills() {
  const el = document.getElementById("skills");
  if (el) el.innerHTML = SKILLS.map((s) => `<span class="tag">${escapeHtml(s)}</span>`).join("");
}

function renderLatest() {
  const blog = document.getElementById("latest-posts");
  if (blog) blog.innerHTML = [...BLOG_POSTS].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3).map(blogCard).join("");
  const notes = document.getElementById("latest-notes");
  if (notes) notes.innerHTML = NOTES.slice(0, 3).map(noteCard).join("");
}

// Generic searchable + filterable list (used by blog and notes pages)
function renderList({ gridId, items, key, searchId, filterId, card }) {
  const grid = document.getElementById(gridId);
  if (!grid) return;
  const search = document.getElementById(searchId);
  const filters = document.getElementById(filterId);
  let active = "All";

  const categories = ["All", ...new Set(items.map((i) => i[key]))];
  filters.innerHTML = categories
    .map((c) => `<button class="filter-btn${c === "All" ? " active" : ""}" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`)
    .join("");

  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const shown = items.filter(
      (i) =>
        (active === "All" || i[key] === active) &&
        (i.title + " " + i.summary).toLowerCase().includes(q)
    );
    grid.innerHTML = shown.length ? shown.map(card).join("") : `<p class="empty">Nothing found.</p>`;
  };

  filters.addEventListener("click", (e) => {
    const btn = e.target.closest(".filter-btn");
    if (!btn) return;
    active = btn.dataset.cat;
    filters.querySelectorAll(".filter-btn").forEach((b) => b.classList.toggle("active", b === btn));
    draw();
  });
  search.addEventListener("input", draw);
  draw();
}

// Contact form: opens the visitor's email app with the message pre-filled.
function setupContactForm() {
  const form = document.getElementById("contact-form");
  if (!form) return;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = form.name.value.trim();
    const msg = form.message.value.trim();
    const to = form.dataset.email;
    const subject = encodeURIComponent(`Message from ${name}`);
    const body = encodeURIComponent(`${msg}\n\n— ${name} (${form.email.value.trim()})`);
    window.location.href = `mailto:${to}?subject=${subject}&body=${body}`;
    document.getElementById("form-status").textContent = "Opening your email app…";
  });
}
