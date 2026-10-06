// Share buttons for articles and notes.
function shareHTML(title) {
  const url = encodeURIComponent(location.href);
  const text = encodeURIComponent(title);
  const links = [
    ["whatsapp", "WhatsApp", "#25D366", `https://wa.me/?text=${text}%20${url}`],
    ["telegram", "Telegram", "#26A5E4", `https://t.me/share/url?url=${url}&text=${text}`],
    ["x", "X", "#000000", `https://twitter.com/intent/tweet?url=${url}&text=${text}`],
    ["facebook", "Facebook", "#1877F2", `https://www.facebook.com/sharer/sharer.php?u=${url}`],
  ];
  return `<div class="share no-print">
    <b>Share:</b>
    ${links
      .map(([id, label, color, href]) => `<a class="social" style="--brand:${color}" href="${href}" target="_blank" rel="noopener" title="Share on ${label}" aria-label="Share on ${label}">${ICONS[id]}</a>`)
      .join("")}
    <button class="btn small ghost" id="copy-link">🔗 Copy link</button>
  </div>`;
}

function setupShare() {
  const btn = document.getElementById("copy-link");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      btn.textContent = "✅ Copied";
    } catch (e) {
      prompt("Link copy karein:", location.href);
    }
  });
}
