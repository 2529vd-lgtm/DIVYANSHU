"""Posts new articles from content/articles.json to Instagram.

For each article not yet listed in content/instagram-posted.json it:
  1. makes a 1080x1350 post picture (cover photo + title) in uploads/instagram/,
  2. commits it so Instagram can download it from GitHub,
  3. publishes the post with a caption,
  4. comments the article's link under the post,
  5. records the article as posted.

Run by .github/workflows/instagram.yml. Needs the IG_USER_ID and IG_ACCESS_TOKEN secrets
(a Facebook Page token with instagram_basic, instagram_content_publishing and
instagram_manage_comments).

  python scripts/instagram/post.py               post every new article
  python scripts/instagram/post.py <article>     post one article (even if posted before): its id,
                                                 a word from its title, or "latest"
  DRY_RUN=1 ...                                  only make the pictures, post nothing
"""

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[2]
FONTS = Path(__file__).resolve().parent / "fonts"
ARTICLES = ROOT / "content" / "articles.json"
POSTED = ROOT / "content" / "instagram-posted.json"
SITE = ROOT / "content" / "site.json"
OUT_DIR = "uploads/instagram"

OWNER, REPO = (os.environ.get("GITHUB_REPOSITORY") or "2529vd-lgtm/DIVYANSHU").split("/")
BRANCH = os.environ.get("GITHUB_REF_NAME") or "claude/hello-rmr06a"
SITE_URL = f"https://{OWNER.lower()}.github.io/{REPO}/"
GRAPH = "https://graph.facebook.com/v24.0"

W, H = 1080, 1350
BG, TEXT, MUTED, ACCENT = "#f7f6f2", "#1b1d22", "#5d6370", "#c0262d"
HASHTAGS = {
    "Blog": "#blog #bihar #india #currentaffairs #writing",
    "Story": "#story #hindistory #storytelling #writing",
    "Editorial": "#editorial #opinion #bihar #india #currentaffairs",
    "Report": "#report #ground_report #bihar #india",
}


def article_url(a):
    return f"{SITE_URL}article.html?id={urllib.parse.quote(a['id'])}"


# ---------- Picture ----------

def font(name, size):
    return ImageFont.truetype(str(FONTS / name), size)


def wrap(draw, text, fnt, width):
    lines, line = [], ""
    for word in text.split():
        trial = f"{line} {word}".strip()
        if draw.textlength(trial, font=fnt) <= width or not line:
            line = trial
        else:
            lines.append(line)
            line = word
    if line:
        lines.append(line)
    return lines


def fit_title(draw, title, width, max_height):
    """Largest title size (72 down to 40) whose wrapped lines fit; trims with … as a last resort."""
    for size in range(72, 39, -4):
        fnt = font("Merriweather_900Black.ttf", size)
        lines = wrap(draw, title, fnt, width)
        step = int(size * 1.35)
        if len(lines) * step <= max_height:
            return fnt, lines, step
    keep = max(1, max_height // step)
    lines = lines[:keep]
    lines[-1] = lines[-1].rstrip(".,;:") + "…"
    return fnt, lines, step


def make_picture(a, site_name):
    img = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)
    pad = 70

    cover_h = 0
    cover = a.get("cover") or ""
    if cover and not cover.startswith("http") and (ROOT / cover).is_file():
        photo = Image.open(ROOT / cover)
        photo = ImageOps.exif_transpose(photo).convert("RGB")
        cover_h = 760
        img.paste(ImageOps.fit(photo, (W, cover_h), Image.LANCZOS), (0, 0))
    elif cover.startswith("http"):
        try:
            with urllib.request.urlopen(cover, timeout=30) as r:
                photo = Image.open(BytesIO(r.read()))
            cover_h = 760
            img.paste(ImageOps.fit(ImageOps.exif_transpose(photo).convert("RGB"), (W, cover_h), Image.LANCZOS), (0, 0))
        except Exception as e:  # a broken link just means a picture without the photo
            print(f"  Could not download cover photo: {e}")

    if not cover_h:
        # No photo: a big red masthead band instead.
        cover_h = 420
        draw.rectangle([0, 0, W, cover_h], fill=ACCENT)
        big = font("Merriweather_900Black.ttf", 110)
        name = site_name.upper()
        draw.text(((W - draw.textlength(name, font=big)) / 2, cover_h / 2 - 70), name, font=big, fill="white")

    # Category label sitting on the edge of the photo.
    label_font = font("Inter_800ExtraBold.ttf", 30)
    label = a.get("category", "Blog").upper()
    lw = draw.textlength(label, font=label_font)
    top = cover_h - 28
    draw.rectangle([pad, top, pad + lw + 44, top + 56], fill=ACCENT)
    draw.text((pad + 22, top + 10), label, font=label_font, fill="white")

    # Title.
    footer_h = 110
    title_top = cover_h + 60
    fnt, lines, step = fit_title(draw, a["title"], W - 2 * pad, H - footer_h - title_top - 20)
    y = title_top
    for line in lines:
        draw.text((pad, y), line, font=fnt, fill=TEXT)
        y += step

    # Footer: site name and a pointer to the link.
    draw.line([pad, H - footer_h, W - pad, H - footer_h], fill="#e4e2dc", width=2)
    small = font("Inter_400Regular.ttf", 30)
    bold = font("Inter_800ExtraBold.ttf", 30)
    draw.text((pad, H - footer_h + 34), site_name, font=bold, fill=ACCENT)
    hint = "Full article: link in comments"
    draw.text((W - pad - draw.textlength(hint, font=small), H - footer_h + 34), hint, font=small, fill=MUTED)
    return img


# ---------- Git ----------

def git(*args):
    subprocess.run(["git", *args], cwd=ROOT, check=True)


def commit_and_push(paths, message):
    git("add", *paths)
    if subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=ROOT).returncode == 0:
        return
    git("commit", "-q", "-m", message)
    for attempt in range(5):
        try:
            git("pull", "-q", "--rebase", "origin", BRANCH)
            git("push", "-q", "origin", f"HEAD:{BRANCH}")
            return
        except subprocess.CalledProcessError:
            time.sleep(2 ** attempt)
    raise SystemExit("Could not push to GitHub")


def raw_url(path):
    return f"https://raw.githubusercontent.com/{OWNER}/{REPO}/refs/heads/{BRANCH}/{path}"


def wait_until_online(url):
    for _ in range(30):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, method="HEAD"), timeout=20) as r:
                if r.status == 200:
                    return
        except urllib.error.URLError:
            pass
        time.sleep(5)
    raise SystemExit(f"The picture never came online: {url}")


# ---------- Instagram ----------

def graph(method, path, **params):
    params["access_token"] = os.environ["IG_ACCESS_TOKEN"]
    data = urllib.parse.urlencode(params).encode()
    url = f"{GRAPH}/{path}"
    if method == "GET":
        req = urllib.request.Request(f"{url}?{data.decode()}")
    else:
        req = urllib.request.Request(url, data=data, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        try:
            err = json.load(e).get("error", {})
            msg = err.get("error_user_msg") or err.get("message") or str(e)
        except Exception:
            msg = str(e)
        raise RuntimeError(f"Instagram said: {msg}") from None


def caption_for(a):
    parts = [a["title"]]
    if a.get("summary"):
        parts.append(a["summary"].strip())
    parts.append("📖 Read the full article: link in the comments 👇 (also in bio)")
    parts.append(HASHTAGS.get(a.get("category"), HASHTAGS["Blog"]))
    return "\n\n".join(parts)[:2200]


def publish(a, image_url):
    user = os.environ["IG_USER_ID"]
    container = graph("POST", f"{user}/media", image_url=image_url, caption=caption_for(a))["id"]
    for _ in range(30):
        status = graph("GET", container, fields="status_code").get("status_code")
        if status == "FINISHED":
            break
        if status in ("ERROR", "EXPIRED"):
            raise RuntimeError(f"Instagram could not process the picture ({status})")
        time.sleep(5)
    media = graph("POST", f"{user}/media_publish", creation_id=container)["id"]
    try:
        graph("POST", f"{media}/comments", message=f"📖 Read the full article here:\n{article_url(a)}")
    except RuntimeError as e:  # the post is live; a missing comment shouldn't repost it
        print(f"  Posted, but could not add the link comment: {e}")
    link = graph("GET", media, fields="permalink").get("permalink", "")
    return media, link


# ---------- Main ----------

def load(path, fallback):
    return json.loads(path.read_text("utf-8")) if path.exists() else fallback


def main():
    dry = os.environ.get("DRY_RUN") == "1"
    if not dry and not (os.environ.get("IG_USER_ID") and os.environ.get("IG_ACCESS_TOKEN")):
        raise SystemExit("Missing secrets: add IG_USER_ID and IG_ACCESS_TOKEN in Settings → Secrets and variables → Actions.")

    articles = load(ARTICLES, {"articles": []})["articles"]
    site_name = load(SITE, {}).get("name") or "Divyanshu"
    posted = load(POSTED, {"posted": {}})

    wanted = sys.argv[1].strip() if len(sys.argv) > 1 and sys.argv[1].strip() else None
    if wanted:
        if wanted.lower() == "latest":
            todo = sorted(articles, key=lambda a: a.get("date", ""))[-1:]
        else:
            todo = [a for a in articles if a["id"] == wanted] or [
                a for a in articles if wanted.lower() in a["title"].lower()
            ][:1]
        if not todo:
            raise SystemExit(f"No article with id {wanted}")
    else:
        # Oldest first, so the newest ends up on top of the Instagram grid.
        todo = sorted((a for a in articles if a["id"] not in posted["posted"]), key=lambda a: a.get("date", ""))

    if not todo:
        print("Nothing new to post.")
        return

    failed = 0
    for a in todo:
        print(f"• {a['title']}")
        path = f"{OUT_DIR}/{a['id']}.jpg"
        (ROOT / OUT_DIR).mkdir(parents=True, exist_ok=True)
        make_picture(a, site_name).save(ROOT / path, "JPEG", quality=90, optimize=True)
        if dry:
            print(f"  Picture: {path}")
            print("  Caption:\n    " + caption_for(a).replace("\n", "\n    "))
            continue
        try:
            commit_and_push([path], f"Instagram picture: {a['title']}")
            url = raw_url(path)
            wait_until_online(url)
            media, link = publish(a, url)
        except RuntimeError as e:
            print(f"  ❌ {e}")
            failed += 1
            continue
        print(f"  ✅ Posted: {link}")
        posted = load(POSTED, {"posted": {}})
        posted["posted"][a["id"]] = {"media_id": media, "link": link, "at": time.strftime("%Y-%m-%d %H:%M")}
        POSTED.write_text(json.dumps(posted, indent=2, ensure_ascii=False) + "\n", "utf-8")
        commit_and_push([str(POSTED.relative_to(ROOT))], f"Posted to Instagram: {a['title']}")

    if failed:
        raise SystemExit(f"{failed} article(s) could not be posted. See the messages above.")


if __name__ == "__main__":
    main()
