# Divyanshu's Website

A personal website with a **portfolio**, a **blog**, and **study notes** (BPSC / UPSC). It uses only HTML, CSS and JavaScript, so there's no build step.

## Pages
- `index.html`: home, about, projects, latest posts and notes, and contact
- `blog.html`: all blog posts, with search and category filters
- `notes.html`: all study notes, with search and subject filters
- `posts/`: individual blog posts and notes

## How to edit
- **Projects, skills, blog list, notes list:** edit `js/data.js`.
- **New blog post or note:** copy a file in `posts/`, change its content, then add an entry for it in `js/data.js`.
- **Contact email:** change `data-email` in `index.html`.
- **Colours:** change the variables at the top of `css/style.css`.

## View it locally
Open `index.html` in a browser, or run:
```
python3 -m http.server 8000
```
Then visit http://localhost:8000.

## Publish free on GitHub Pages
Go to repo **Settings → Pages**, choose **Deploy from a branch**, then select the branch and `/ (root)`.
