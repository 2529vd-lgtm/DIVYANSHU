# Divyanshu's Website

A newspaper-style website with **Blogs, Stories, Editorials and Reports**.

The **Exam Corner** (exam countdowns, syllabus, notes, mind maps, PYQs and mock tests) is now its own website: [2529vd-lgtm/EXAM-CORNER](https://github.com/2529vd-lgtm/EXAM-CORNER), live at https://2529vd-lgtm.github.io/EXAM-CORNER/.

It's a plain HTML/CSS/JS site hosted free on GitHub Pages. There's no server and no build step.

Live site: https://2529vd-lgtm.github.io/DIVYANSHU/

## Adding content (no coding needed)

Open **`/admin.html`** on the live site (or use the "Admin" link in the footer) and log in with a GitHub token. The login box has step-by-step instructions for creating the token. After that you can:

- **📰 Articles:** write or edit a Blog, Story, Editorial or Report, with photos, PDFs, tables and a live preview. Big photos are resized to 1600px JPEG before upload, so they upload fast and load fast.
- **🔗 Social & Settings:** add your social media links (each shows its logo on the site), your photo and your About text.

**Novels:** create a Story, tick **📖 This is a novel**, then use **Chapters → Add Chapter** to upload chapters one by one. Readers get two options: read chapter by chapter (with next/previous buttons) or read the full novel on one page. Chapters are saved in `content/articles/<id>/chapter-<n>.md`.

When you change a CSS or JS file, bump the `?v=` number in the HTML files so visitors' browsers load the new version.

Every save becomes a commit in this repo. The live site updates 1–2 minutes later.

## Where things live

| Path | What it is |
|---|---|
| `index.html` | Home page: masthead, lead story, sections, Exam Corner link, About |
| `articles.html`, `article.html` | Article list and reader |
| `admin.html` | Upload and edit everything |
| `content/` | All content: `site.json`, `articles.json`, plus the article files |
| `uploads/` | Photos and PDFs uploaded from the Admin page |
| `js/config.js` | Repo/branch used by Admin, article categories, social platforms |
| `js/vendor/` | Bundled libraries: marked and DOMPurify, plus mammoth and turndown for Word import (loaded only when used) |

## Writing tips

Articles use Markdown. The Admin toolbar inserts the syntax for you.

- **From Word:** click **📄 Word file** in the editor toolbar and choose the `.docx`. Headings, bold, lists, links, tables and pictures (including charts saved as pictures) come across, and the title fills itself in. Copy-pasting from Word also keeps tables and formatting. Word leaves pictures out of copied text, though, so use the button for documents with charts, or paste a chart on its own.

## View it locally

The pages load content with `fetch`, so open them through a local server instead of double-clicking the files:

```
python3 -m http.server 8000
```

Then visit http://localhost:8000.

## Credits

Social media icons are from [Font Awesome Free](https://fontawesome.com), licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
Bundled libraries in `js/vendor/`: [marked](https://github.com/markedjs/marked) (MIT), [DOMPurify](https://github.com/cure53/DOMPurify) (Apache-2.0 / MPL-2.0), [mammoth](https://github.com/mwilliamson/mammoth.js) (BSD-2-Clause), [turndown](https://github.com/mixmark-io/turndown) and [turndown-plugin-gfm](https://github.com/mixmark-io/turndown-plugin-gfm) (MIT).
