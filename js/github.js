// Minimal GitHub "contents" API client used by the Admin page.
// Every save is a commit to SITE_REPO.branch; GitHub Pages then rebuilds the site.
const GH = {
  token: null,
  api: `https://api.github.com/repos/${SITE_REPO.owner}/${SITE_REPO.repo}`,

  async request(method, path, body) {
    const res = await fetch(this.api + path, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    if (res.status === 404) return null;
    const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.message || `GitHub error ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  },

  contentsPath(path) {
    return `/contents/${path.split("/").map(encodeURIComponent).join("/")}`;
  },

  rawURL(path) {
    return `https://raw.githubusercontent.com/${SITE_REPO.owner}/${SITE_REPO.repo}/refs/heads/${SITE_REPO.branch}/${path}`;
  },

  async repoInfo() {
    return this.request("GET", "");
  },

  // Returns { sha, text } or null when the file doesn't exist.
  async read(path) {
    const data = await this.request("GET", `${this.contentsPath(path)}?ref=${encodeURIComponent(SITE_REPO.branch)}`);
    if (!data) return null;
    let b64 = (data.content || "").replace(/\n/g, "");
    if (!b64 && data.size > 0 && data.download_url) {
      // Files over 1 MB come without inline content.
      const text = await (await fetch(this.rawURL(path), { cache: "no-store" })).text();
      return { sha: data.sha, text };
    }
    return { sha: data.sha, text: b64ToText(b64) };
  },

  async readJSON(path, fallback) {
    const f = await this.read(path);
    return f ? { sha: f.sha, data: JSON.parse(f.text) } : { sha: null, data: fallback };
  },

  async writeBase64(path, base64, message, sha) {
    const body = { message, content: base64, branch: SITE_REPO.branch };
    if (sha) body.sha = sha;
    const res = await this.request("PUT", this.contentsPath(path), body);
    return res.content.sha;
  },

  async write(path, text, message, sha) {
    return this.writeBase64(path, textToB64(text), message, sha);
  },

  // Write a text file, looking up its current version first.
  async put(path, text, message) {
    const existing = await this.read(path);
    return this.write(path, text, message, existing && existing.sha);
  },

  async remove(path, message) {
    const existing = await this.read(path);
    if (!existing) return;
    await this.request("DELETE", this.contentsPath(path), { message, sha: existing.sha, branch: SITE_REPO.branch });
  },

  // Read a JSON file fresh, change it, and save it (retrying once if it changed meanwhile).
  async updateJSON(path, fallback, mutate, message) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const { sha, data } = await this.readJSON(path, fallback);
      const draft = structuredClone(data);
      const next = mutate(draft) || draft;
      try {
        await this.write(path, JSON.stringify(next, null, 2) + "\n", message, sha);
        return next;
      } catch (e) {
        if (e.status !== 409 || attempt === 1) throw e;
      }
    }
  },
};

function textToB64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function b64ToText(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
