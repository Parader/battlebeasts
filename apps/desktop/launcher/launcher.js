const titleEl = document.getElementById("title");
const statusEl = document.getElementById("status");
const playEl = document.getElementById("play");
const retryEl = document.getElementById("retry");
const notesEl = document.getElementById("notes");
const progressWrap = document.getElementById("progressWrap");
const progressBar = document.getElementById("progressBar");
const progressLabel = document.getElementById("progressLabel");

const api = window.launcher;

function setStatus(message, isError) {
  statusEl.textContent = message || "";
  statusEl.classList.toggle("error", Boolean(isError));
}

function renderNotes(payload) {
  if (!payload) return;
  if (payload.title) titleEl.textContent = payload.title;
  const notes = payload.notes || {};
  const sections = [
    ["Balance", notes.balance],
    ["Bug fixes", notes.fixes],
    ["New content", notes.content],
    ["Updates", notes.highlights],
  ].filter(([, items]) => Array.isArray(items) && items.length > 0);

  if (sections.length === 0) {
    notesEl.innerHTML = `<p class="placeholder">No patch notes for this drop.</p>`;
    return;
  }

  notesEl.innerHTML = sections
    .map(
      ([label, items]) => `
      <section class="col">
        <h2>${escapeHtml(label)}</h2>
        <ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </section>`,
    )
    .join("");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

if (api) {
  api.onStatus((payload) => {
    const phase = payload && payload.phase;
    const message = payload && payload.message ? payload.message : "";
    setStatus(message, phase === "error");
    progressWrap.classList.toggle("hidden", phase !== "updating");
    if (phase === "updating") playEl.disabled = true;
    if (phase !== "updating") {
      progressBar.style.setProperty("--pct", "0%");
      progressLabel.textContent = "0%";
    }
    retryEl.classList.toggle("hidden", phase !== "error");
  });

  api.onProgress((payload) => {
    const received = Number(payload && payload.received) || 0;
    const total = Number(payload && payload.total) || 0;
    progressWrap.classList.remove("hidden");
    const pct = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0;
    progressBar.style.setProperty("--pct", `${pct}%`);
    progressLabel.textContent = total > 0 ? `${pct}%` : `${Math.round(received / (1024 * 1024))} MB`;
  });

  api.onNotes(renderNotes);

  api.onReady((payload) => {
    if (payload && payload.restartLauncher) {
      playEl.disabled = true;
      retryEl.classList.add("hidden");
      setStatus("Restarting launcher…", false);
      return;
    }
    const canPlay = Boolean(payload && payload.canPlay);
    playEl.disabled = !canPlay;
    retryEl.classList.toggle("hidden", canPlay && !(payload && payload.error));
    if (payload && payload.error && !canPlay) {
      setStatus("Couldn’t update — check internet.", true);
    }
  });

  playEl.addEventListener("click", () => {
    if (playEl.disabled) return;
    playEl.disabled = true;
    setStatus("Checking for updates…", false);
    void api.play();
  });

  retryEl.addEventListener("click", () => {
    playEl.disabled = true;
    retryEl.classList.add("hidden");
    setStatus("Checking for updates…", false);
    void api.retry();
  });
} else {
  setStatus("Launcher API missing.", true);
}
