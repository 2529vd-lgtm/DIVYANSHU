// Posts articles to Instagram straight from the Admin page.
// The Instagram (Facebook Page) token is kept in this browser only, like the GitHub token.
// For each post: draw a 1080x1350 picture (cover photo + title), upload it to the repo so
// Instagram can download it, publish it with a caption, then comment the article's link.

const IG_GRAPH = "https://graph.facebook.com/v24.0";
const IG_POSTED = "content/instagram-posted.json";
const SITE_URL = `https://${SITE_REPO.owner.toLowerCase()}.github.io/${SITE_REPO.repo}/`;
const IG_HASHTAGS = {
  Blog: "#blog #bihar #india #currentaffairs #writing",
  Story: "#story #hindistory #storytelling #writing",
  Editorial: "#editorial #opinion #bihar #india #currentaffairs",
  Report: "#report #groundreport #bihar #india",
};

const IG = {
  get account() {
    try { return JSON.parse(localStorage.getItem("igAccount") || "null"); } catch (e) { return null; }
  },
  set account(v) {
    try { v ? localStorage.setItem("igAccount", JSON.stringify(v)) : localStorage.removeItem("igAccount"); } catch (e) {}
  },
};

async function igCall(method, path, params, token) {
  const body = new URLSearchParams({ ...params, access_token: token || IG.account.token });
  const res = method === "GET"
    ? await fetch(`${IG_GRAPH}/${path}?${body}`)
    : await fetch(`${IG_GRAPH}/${path}`, { method, body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const e = data.error || {};
    throw new Error(`Instagram said: ${e.error_user_msg || e.message || res.status}`);
  }
  return data;
}

// Accepts a Page token or a user token, finds the Instagram account behind it and saves it.
async function igConnect(token) {
  token = token.trim().replace(/^"|"$/g, "");
  if (!/^EAA/.test(token)) throw new Error('This doesn\'t look like the token. It starts with "EAA".');
  let pageToken = token, ig = null, pageName = "";
  try {
    const me = await igCall("GET", "me", { fields: "name,instagram_business_account{id,username}" }, token);
    ig = me.instagram_business_account;
    pageName = me.name;
  } catch (e) { /* a user token: the field doesn't exist on users */ }
  if (!ig) {
    const pages = await igCall("GET", "me/accounts", { fields: "name,access_token,instagram_business_account{id,username}" }, token);
    const page = (pages.data || []).find((p) => p.instagram_business_account);
    if (!page) throw new Error("No Instagram account is linked to your Facebook Page. Link it in Page → Settings → Linked accounts → Instagram, then make a new token.");
    ig = page.instagram_business_account;
    pageToken = page.access_token;
    pageName = page.name;
  }
  let expires = null;
  try {
    const d = (await igCall("GET", "debug_token", { input_token: pageToken }, pageToken)).data || {};
    expires = d.expires_at || 0;
  } catch (e) {}
  IG.account = { token: pageToken, id: ig.id, username: ig.username || "", page: pageName, expires };
  return IG.account;
}

// ---------- Picture ----------
let igFontsReady = null;
function igLoadFonts() {
  if (!igFontsReady) {
    const faces = [
      new FontFace("IG Serif", "url(fonts/Merriweather_900Black.ttf)", { weight: "900" }),
      new FontFace("IG Sans", "url(fonts/Inter_400Regular.ttf)", { weight: "400" }),
      new FontFace("IG Sans", "url(fonts/Inter_800ExtraBold.ttf)", { weight: "800" }),
    ];
    igFontsReady = Promise.all(faces.map((f) => f.load().then((ff) => document.fonts.add(ff))));
  }
  return igFontsReady;
}

function igLoadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function igWrap(ctx, text, width) {
  const lines = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const trial = line ? `${line} ${word}` : word;
    if (ctx.measureText(trial).width <= width || !line) line = trial;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
}

async function igPicture(a) {
  await igLoadFonts();
  const W = 1080, H = 1350, pad = 70, accent = "#c0262d";
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#f7f6f2";
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = "top";

  let coverH = 0;
  if (a.cover) {
    const photo = await igLoadImage(/^https?:/.test(a.cover) ? a.cover : GH.rawURL(a.cover));
    if (photo) {
      coverH = 760;
      const scale = Math.max(W / photo.width, coverH / photo.height);
      const sw = W / scale, sh = coverH / scale;
      ctx.drawImage(photo, (photo.width - sw) / 2, (photo.height - sh) / 2, sw, sh, 0, 0, W, coverH);
    }
  }
  if (!coverH) {
    coverH = 420;
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, W, coverH);
    ctx.fillStyle = "#fff";
    ctx.font = "900 110px 'IG Serif'";
    const name = (DB.site.name || "Divyanshu").toUpperCase();
    ctx.fillText(name, (W - ctx.measureText(name).width) / 2, coverH / 2 - 70);
  }

  // Category label on the edge of the photo.
  ctx.font = "800 30px 'IG Sans'";
  const label = (a.category || "Blog").toUpperCase();
  const lw = ctx.measureText(label).width;
  ctx.fillStyle = accent;
  ctx.fillRect(pad, coverH - 28, lw + 44, 56);
  ctx.fillStyle = "#fff";
  ctx.fillText(label, pad + 22, coverH - 28 + 12);

  // Title: the biggest size that fits.
  const footerH = 110, top = coverH + 60, room = H - footerH - top - 20;
  let lines, step;
  for (let size = 72; size >= 40; size -= 4) {
    ctx.font = `900 ${size}px 'IG Serif'`;
    lines = igWrap(ctx, a.title, W - 2 * pad);
    step = Math.round(size * 1.35);
    if (lines.length * step <= room) break;
  }
  const keep = Math.max(1, Math.floor(room / step));
  if (lines.length > keep) { lines = lines.slice(0, keep); lines[keep - 1] = lines[keep - 1].replace(/[.,;:]?$/, "…"); }
  ctx.fillStyle = "#1b1d22";
  lines.forEach((l, i) => ctx.fillText(l, pad, top + i * step));

  // Footer.
  ctx.fillStyle = "#e4e2dc";
  ctx.fillRect(pad, H - footerH, W - 2 * pad, 2);
  ctx.font = "800 30px 'IG Sans'";
  ctx.fillStyle = accent;
  ctx.fillText(DB.site.name || "Divyanshu", pad, H - footerH + 34);
  ctx.font = "400 30px 'IG Sans'";
  ctx.fillStyle = "#5d6370";
  const hint = "Full article: link in comments";
  ctx.fillText(hint, W - pad - ctx.measureText(hint).width, H - footerH + 34);

  return c.toDataURL("image/jpeg", 0.9);
}

// ---------- Posting ----------
function igCaption(a) {
  return [a.title, (a.summary || "").trim(), "📖 Read the full article: link in the comments 👇 (also in bio)", IG_HASHTAGS[a.category] || IG_HASHTAGS.Blog]
    .filter(Boolean).join("\n\n").slice(0, 2200);
}

async function igWaitOnline(url) {
  for (let i = 0; i < 30; i++) {
    try { if ((await fetch(url, { method: "HEAD", cache: "no-store" })).ok) return; } catch (e) {}
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error("The picture didn't come online on GitHub. Try again in a minute.");
}

async function igReadPosted() {
  return (await GH.readJSON(IG_POSTED, { posted: {} })).data.posted || {};
}

// Posts one article. onStep gets short progress messages.
async function igPost(a, onStep = () => {}) {
  const acc = IG.account;
  if (!acc) throw new Error("Instagram isn't connected. Open the 📸 Instagram tab first.");
  onStep("Making the picture…");
  const dataURL = await igPicture(a);
  onStep("Uploading the picture…");
  const path = `uploads/instagram/${a.id}-${Date.now().toString(36)}.jpg`;
  await GH.writeBase64(path, dataURL.split(",")[1], `Instagram picture: ${a.title}`);
  const url = GH.rawURL(path);
  await igWaitOnline(url);

  onStep("Sending to Instagram…");
  const container = (await igCall("POST", `${acc.id}/media`, { image_url: url, caption: igCaption(a) })).id;
  for (let i = 0; i < 30; i++) {
    const s = (await igCall("GET", container, { fields: "status_code" })).status_code;
    if (s === "FINISHED") break;
    if (s === "ERROR" || s === "EXPIRED") throw new Error("Instagram couldn't process the picture. Try again.");
    await new Promise((r) => setTimeout(r, 3000));
  }
  onStep("Publishing…");
  const media = (await igCall("POST", `${acc.id}/media_publish`, { creation_id: container })).id;

  let note = "";
  try {
    await igCall("POST", `${media}/comments`, { message: `📖 Read the full article here:\n${SITE_URL}article.html?id=${encodeURIComponent(a.id)}` });
  } catch (e) {
    note = " (The link comment failed: add it yourself.)";
  }
  let link = "";
  try { link = (await igCall("GET", media, { fields: "permalink" })).permalink || ""; } catch (e) {}

  await GH.updateJSON(IG_POSTED, { posted: {} }, (d) => {
    d.posted = d.posted || {};
    d.posted[a.id] = { media_id: media, link, at: new Date().toISOString().slice(0, 16).replace("T", " ") };
  }, `Posted to Instagram: ${a.title}`);
  return { link, note };
}

// ---------- Admin tab ----------
async function instagramTab() {
  const acc = IG.account;
  if (!acc) {
    $("view").innerHTML = `<div class="panel">
      <h2>📸 Connect Instagram</h2>
      <p class="help">Do this once. After that, every new article can go to Instagram with one tick: picture, caption and the article link in the comments.</p>
      <div class="field"><label for="ig-token">Paste your Facebook Page token (starts with <code>EAA</code>)</label>
        <textarea id="ig-token" rows="3" placeholder="EAA..." autocomplete="off" spellcheck="false"></textarea></div>
      <button class="btn" id="ig-connect">Connect</button>
      <details class="help" style="margin-top:16px">
        <summary><b>Where do I get the token?</b></summary>
        <ol>
          <li>Open <a href="https://developers.facebook.com/tools/explorer" target="_blank" rel="noopener">Graph API Explorer</a>, pick your app, and click <b>Generate Access Token</b> (tick your Page and Instagram account in the popup).</li>
          <li>Click ⓘ next to the token → <b>Open in Access Token Tool</b> → <b>Extend Access Token</b>, and copy the new token.</li>
          <li>Paste that token in the Explorer's token box, run <code>me/accounts?fields=name,access_token</code>, and copy the <code>access_token</code> shown. Paste it above.</li>
        </ol>
        <p>The token stays only in this browser. Never share it.</p>
      </details>
    </div>`;
    $("ig-connect").onclick = () =>
      busy($("ig-connect"), "Connecting…", async () => {
        status("⏳ Connecting to Instagram…");
        await igConnect($("ig-token").value);
        instagramTab();
      });
    return;
  }

  status("⏳ Loading…");
  const posted = await igReadPosted();
  status(
    acc.expires
      ? `⚠️ Connected, but this token stops working on ${new Date(acc.expires * 1000).toLocaleString()}. For one that never expires: open the <a href="https://developers.facebook.com/tools/debug/accesstoken/" target="_blank" rel="noopener">Access Token Debugger</a>, paste this token, click <b>Debug</b>, then <b>Extend Access Token</b> at the bottom. Copy the new token, click Disconnect here and connect with it.`
      : "",
    "err"
  );
  const list = [...DB.articles].sort(byDate);
  $("view").innerHTML = `<div class="panel">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
      <h2 style="margin:0">📸 Instagram: ✅ connected${acc.username ? ` to <a href="https://www.instagram.com/${esc(acc.username)}/" target="_blank" rel="noopener">@${esc(acc.username)}</a>` : ""}</h2>
      <button class="btn small outline" id="ig-disconnect">Disconnect</button>
    </div>
    <p class="help">New articles: keep <b>📸 Also post on Instagram</b> ticked when you publish. To post an older article, click its button below.</p>
    <ul class="admin-list">
      ${list.map((a) => {
        const p = posted[a.id];
        return `<li><div><b>${esc(a.title)}</b><div class="meta">${esc(a.category)} · ${fmtDate(a.date)}${
          p ? ` · ✅ posted${p.link ? ` (<a href="${esc(p.link)}" target="_blank" rel="noopener">see post</a>)` : ""}` : ""}</div></div>
          <span class="actions"><button class="btn small ${p ? "ghost" : ""}" data-ig="${esc(a.id)}">${p ? "Post again" : "📸 Post"}</button></span></li>`;
      }).join("") || `<li class="muted">No articles yet.</li>`}
    </ul>
  </div>`;
  $("ig-disconnect").onclick = () => {
    if (!confirm("Disconnect Instagram from this browser?")) return;
    IG.account = null;
    status("");
    instagramTab();
  };
  $("view").querySelectorAll("[data-ig]").forEach((b) =>
    (b.onclick = () => {
      const a = DB.articles.find((x) => x.id === b.dataset.ig);
      if (posted[a.id] && !confirm(`"${a.title}" is already on Instagram. Post it again?`)) return;
      busy(b, "Posting…", async () => {
        const r = await igPost(a, (m) => status(`⏳ ${m} please don't close this page.`));
        await instagramTab();
        status(`✅ Posted on Instagram${r.link ? `: <a href="${esc(r.link)}" target="_blank" rel="noopener">see post</a>` : ""}.${r.note}`, "ok");
      });
    })
  );
}
