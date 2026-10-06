// Mock test player: start screen → timed test → result with answer review.
const LETTERS = ["A", "B", "C", "D", "E", "F"];

document.addEventListener("DOMContentLoaded", async () => {
  const site = await renderChrome("exams");
  const root = document.getElementById("mock");
  const [{ exams }, { items }] = await Promise.all([
    loadJSON("content/exams.json", { exams: [] }),
    loadJSON("content/exam-items.json", { items: [] }),
  ]);
  const meta = items.find((i) => i.id === param("id") && i.type === "mock");
  if (!meta) return showError(root, "Ye mock test nahi mila.");
  let test;
  try { test = await loadJSON(`content/exam-items/${meta.id}.json`); }
  catch (e) { return showError(root, "Test load nahi ho paya. Thodi der baad try karein."); }

  const exam = exams.find((e) => e.id === meta.exam) || { id: meta.exam, name: meta.exam, subjects: [] };
  const subject = (exam.subjects || []).find((s) => s.id === meta.subject);
  const qs = test.questions || [];
  const duration = Number(test.duration) || qs.length; // minutes
  const negative = Number(test.negative) || 0;
  const back = `exam.html?id=${encodeURIComponent(exam.id)}&view=material&subject=${encodeURIComponent(meta.subject || "all")}&type=mock`;
  document.title = `${meta.title} | ${site.name}`;

  let answers, marked, current, timerId, endsAt;

  const md = (t) => renderMarkdown(t);

  function startScreen() {
    clearInterval(timerId);
    root.innerHTML = `
      <div class="breadcrumb"><a href="exams.html">Exam Corner</a> › <a href="exam.html?id=${encodeURIComponent(exam.id)}">${esc(exam.name)}</a>
        ${subject ? ` › ${esc(subject.name)}` : ""} › <a href="${back}">Mock Test</a></div>
      <h1 class="page-title">${esc(meta.title)}</h1>
      <div class="panel">
        <div class="score" style="margin-top:0">
          <div><b>${qs.length}</b>Questions</div>
          <div><b>${duration}</b>Minutes</div>
          <div><b>+1</b>Correct</div>
          <div><b>${negative ? "−" + negative : "0"}</b>Wrong</div>
        </div>
        <ul style="padding-left:20px;margin-bottom:16px" class="muted">
          <li>Har question ka ek hi sahi answer hai.</li>
          <li>Timer khatam hote hi test apne aap submit ho jayega.</li>
          <li>"Mark for review" se question ko baad mein dekhne ke liye mark kar sakte hain.</li>
        </ul>
        ${qs.length ? `<button class="btn" id="start">▶ Start Test</button>` : `<p class="empty">Is test mein abhi questions nahi hain.</p>`}
      </div>`;
    const start = document.getElementById("start");
    if (start) start.onclick = begin;
  }

  function begin() {
    answers = new Array(qs.length).fill(null);
    marked = new Array(qs.length).fill(false);
    current = 0;
    endsAt = Date.now() + duration * 60000;
    root.innerHTML = `
      <div class="mock-bar">
        <b>${esc(meta.title)}</b>
        <span class="timer" id="timer"></span>
        <button class="btn small" id="submit">Submit</button>
      </div>
      <div id="qbox"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:space-between">
        <button class="btn ghost" id="prev">← Previous</button>
        <button class="btn ghost" id="mark">⭐ Mark for review</button>
        <button class="btn ghost" id="clear">Clear</button>
        <button class="btn" id="next">Save & Next →</button>
      </div>
      <h3 style="margin-top:22px">Questions</h3>
      <div class="palette" id="palette"></div>
      <p class="help">🟩 Answered · 🟨 border = marked for review</p>`;
    document.getElementById("prev").onclick = () => go(current - 1);
    document.getElementById("next").onclick = () => go(current + 1);
    document.getElementById("mark").onclick = () => { marked[current] = !marked[current]; drawPalette(); drawQuestion(); };
    document.getElementById("clear").onclick = () => { answers[current] = null; drawQuestion(); drawPalette(); };
    document.getElementById("submit").onclick = () => {
      const left = answers.filter((a) => a === null).length;
      if (confirm(left ? `${left} question(s) ka answer nahi diya. Phir bhi submit karein?` : "Test submit karein?")) finish();
    };
    document.getElementById("palette").onclick = (e) => {
      const b = e.target.closest("button[data-i]");
      if (b) go(Number(b.dataset.i));
    };
    tick();
    timerId = setInterval(tick, 1000);
    drawQuestion();
    drawPalette();
  }

  function tick() {
    const left = Math.max(0, endsAt - Date.now());
    const m = Math.floor(left / 60000), s = Math.floor((left / 1000) % 60);
    const el = document.getElementById("timer");
    el.textContent = `⏱ ${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    el.classList.toggle("low", left < 60000);
    if (left <= 0) { alert("Time khatam! Test submit ho raha hai."); finish(); }
  }

  function go(i) {
    if (i < 0 || i >= qs.length) return;
    current = i;
    drawQuestion();
    drawPalette();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function drawQuestion() {
    const q = qs[current];
    document.getElementById("qbox").innerHTML = `<div class="question">
      <div class="meta">Question ${current + 1} of ${qs.length}${marked[current] ? " · ⭐ Marked" : ""}</div>
      <div class="qtext">${md(q.q)}</div>
      ${q.options
        .map(
          (o, j) => `<label class="option ${answers[current] === j ? "picked" : ""}">
            <input type="radio" name="opt" value="${j}" ${answers[current] === j ? "checked" : ""} />
            <span><b>${LETTERS[j]}.</b> ${esc(o)}</span></label>`
        )
        .join("")}
    </div>`;
    document.querySelectorAll('#qbox input[name="opt"]').forEach((r) =>
      r.addEventListener("change", () => { answers[current] = Number(r.value); drawQuestion(); drawPalette(); })
    );
    document.getElementById("prev").disabled = current === 0;
    document.getElementById("next").textContent = current === qs.length - 1 ? "Save" : "Save & Next →";
  }

  function drawPalette() {
    document.getElementById("palette").innerHTML = qs
      .map((_, i) => `<button data-i="${i}" class="${answers[i] !== null ? "answered" : ""} ${marked[i] ? "marked" : ""} ${i === current ? "current" : ""}">${i + 1}</button>`)
      .join("");
  }

  function finish() {
    clearInterval(timerId);
    let right = 0, wrong = 0;
    qs.forEach((q, i) => {
      if (answers[i] === null) return;
      if (answers[i] === Number(q.answer)) right++;
      else wrong++;
    });
    const skipped = qs.length - right - wrong;
    const score = Math.round((right - wrong * negative) * 100) / 100;
    const accuracy = right + wrong ? Math.round((right / (right + wrong)) * 100) : 0;
    root.innerHTML = `
      <h1 class="page-title">Result: ${esc(meta.title)}</h1>
      <div class="score">
        <div><b>${score} / ${qs.length}</b>Score</div>
        <div><b style="color:var(--ok)">${right}</b>Correct</div>
        <div><b style="color:var(--bad)">${wrong}</b>Wrong</div>
        <div><b>${skipped}</b>Skipped</div>
        <div><b>${accuracy}%</b>Accuracy</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:24px">
        <button class="btn" id="retry">↻ Dobara do</button>
        <a class="btn ghost" href="${back}">← Aur mock tests</a>
      </div>
      <h2 style="margin-bottom:12px">Answer review</h2>
      ${qs
        .map((q, i) => {
          const a = answers[i], c = Number(q.answer);
          const status = a === null ? "⚪ Skipped" : a === c ? "✅ Correct" : "❌ Wrong";
          return `<div class="question">
            <div class="meta">Q${i + 1} · ${status}</div>
            <div class="qtext">${md(q.q)}</div>
            ${q.options
              .map((o, j) => `<div class="option ${j === c ? "correct" : j === a ? "wrong" : ""}"><span><b>${LETTERS[j]}.</b> ${esc(o)}${j === c ? " ✔" : ""}${j === a && j !== c ? " (aapka answer)" : ""}</span></div>`)
              .join("")}
            ${q.explanation ? `<div class="explain"><b>Explanation:</b> ${md(q.explanation)}</div>` : ""}
          </div>`;
        })
        .join("")}`;
    document.getElementById("retry").onclick = startScreen;
    window.scrollTo({ top: 0 });
  }

  startScreen();
});
