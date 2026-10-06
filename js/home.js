function articleThumb(a) {
  return a.cover ? `<img class="thumb" src="${esc(a.cover)}" alt="" loading="lazy" />` : "";
}

function storyHTML(a, { thumb = true, summary = true } = {}) {
  return `<a class="story" href="article.html?id=${encodeURIComponent(a.id)}">
    ${thumb ? articleThumb(a) : ""}
    <span class="kicker">${esc(a.category)}</span>
    <h3>${esc(a.title)}</h3>
    ${summary && a.summary ? `<p>${esc(a.summary)}</p>` : ""}
    <div class="meta">${fmtDate(a.date)}</div>
  </a>`;
}

document.addEventListener("DOMContentLoaded", async () => {
  const site = await renderChrome("home");
  const articlesData = await loadJSON("content/articles.json", { articles: [] });
  const articles = [...articlesData.articles].sort((a, b) => String(b.date).localeCompare(String(a.date)));

  // Masthead
  document.getElementById("masthead").innerHTML = `
    <div class="date">${new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</div>
    <h1>${esc(site.name)}</h1>
    <p>${esc(site.tagline || "")}</p>`;

  // Lead story + headlines
  const lead = document.getElementById("lead");
  if (!articles.length) {
    lead.innerHTML = `<p class="empty">Abhi koi article nahi hai. Admin page se upload karein.</p>`;
  } else {
    const [top, ...rest] = articles;
    lead.innerHTML = `
      <a class="story" href="article.html?id=${encodeURIComponent(top.id)}">
        ${articleThumb(top)}
        <span class="kicker">${esc(top.category)}</span>
        <h2>${esc(top.title)}</h2>
        ${top.summary ? `<p>${esc(top.summary)}</p>` : ""}
        <div class="meta">${esc(top.author || site.author || "")} · ${fmtDate(top.date)}</div>
      </a>
      <div class="headlines">
        ${rest.slice(0, 5).map((a) => storyHTML(a, { thumb: false, summary: false })).join("") ||
          `<p class="muted">Aur articles jald aa rahe hain.</p>`}
      </div>`;
  }

  // One section per category that has articles
  document.getElementById("sections").innerHTML = CATEGORIES.map((cat) => {
    const list = articles.filter((a) => a.category === cat).slice(0, 3);
    if (!list.length) return "";
    return `<section class="container">
      <div class="section-head"><h2>${esc(cat)}</h2><a href="articles.html?cat=${encodeURIComponent(cat)}">Sab dekhein →</a></div>
      <div class="grid">${list.map((a) => storyHTML(a)).join("")}</div>
    </section>`;
  }).join("");

  document.getElementById("exam-corner-link").href = EXAM_CORNER_URL;

  // About + socials
  document.getElementById("about-name").textContent = site.author || site.name;
  document.getElementById("about-text").innerHTML = renderMarkdown(site.about || "");
  document.getElementById("avatar").innerHTML = site.photo
    ? `<img src="${esc(site.photo)}" alt="${esc(site.author || site.name)}" />`
    : esc((site.author || site.name || "?")[0]);
  const socials = socialLinksHTML(site);
  document.getElementById("about-socials").innerHTML =
    socials || `<p class="muted">Social media links jald aa rahe hain.</p>`;
});
