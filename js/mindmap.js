// Turns markdown headings and bullet points into an interactive mind map.
// The (large) mind map libraries are only downloaded on pages that need them.
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(s);
  });
}

async function renderMindmap(svg, markdown, fallbackEl) {
  try {
    await loadScript("js/vendor/d3.min.js");
    await loadScript("js/vendor/markmap-lib.js");
    await loadScript("js/vendor/markmap-view.js");
    const transformer = new markmap.Transformer([]);
    const { root } = transformer.transform(markdown);
    markmap.Markmap.create(svg, { autoFit: true, duration: 300 }, root);
  } catch (e) {
    // If the mind map can't be drawn, show the same content as normal notes.
    svg.closest(".mindmap-wrap").remove();
    fallbackEl.classList.remove("hidden");
  }
}
