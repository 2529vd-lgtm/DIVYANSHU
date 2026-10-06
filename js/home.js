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
  const [articlesData, examsData] = await Promise.all([
    loadJSON("content/articles.json", { articles: [] }),
    loadJSON("content/exams.json", { exams: [] }),
  ]);
  const articles = [...articlesData.articles].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const upcoming = examsData.exams
    .filter((e) => examTime(e) > Date.now())
    .sort((a, b) => examTime(a) - examTime(b));

  // Masthead
  document.getElementById("masthead").innerHTML = `
    <div class="date">${new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</div>
    <h1>${esc(site.name)}</h1>
    <p>${esc(site.tagline || "")}</p>`;

  // Exam ticker
  const ticker = document.getElementById("ticker");
  if (upcoming.length) {
    const items = upcoming
      .map((e) => `<a href="exam.html?id=${encodeURIComponent(e.id)}">📅 ${esc(e.name)}: <b>${daysLeft(examTime(e))} din baaki</b> (${fmtDate(e.date)})</a>`)
      .join("");
    ticker.innerHTML = `<span class="label">Exam Alert</span><div class="track">${items}${items}</div>`;
  } else ticker.remove();

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

  // Exam corner preview
  const examGrid = document.getElementById("exam-preview");
  const shown = upcoming.length ? upcoming : examsData.exams;
  examGrid.innerHTML = shown.length
    ? shown.slice(0, 3).map(examCardHTML).join("")
    : `<p class="empty">Abhi koi exam add nahi hua hai.</p>`;
  startCountdowns();

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

function examCardHTML(e) {
  return `<a class="card exam-card" href="exam.html?id=${encodeURIComponent(e.id)}">
    <span class="tag">${fmtDate(e.date, { day: "numeric", month: "long", year: "numeric" })}</span>
    <h3 style="margin-top:8px">${esc(e.name)}</h3>
    ${e.fullName ? `<p>${esc(e.fullName)}</p>` : ""}
    <div class="countdown" data-countdown="${examTime(e).toISOString()}"></div>
    <span class="btn small">Syllabus, Notes, PYQ, Mock →</span>
  </a>`;
}
