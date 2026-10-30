import {
  DAYS, DAY_NAMES, fmtTime, clashMap, clashesWith, totalCredits, halvesOverlap, sessionsClash,
  layoutDay, summarizeSessions, recommend, TOPICS,
} from "./scheduler.js";

const HOUR = 60;            // px per hour; mirrors --hour in style.css
const DAY_START = 8 * 60;   // 08:00
const DAY_END = 20 * 60;    // 20:00
const TOP_PAD = 20;         // room above 08:00 so its label isn't clipped
const STORE_KEY = "slotwise.plan.v1";
const RESULT_LIMIT = 250;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

let courses = [];
let byId = new Map();
let chosen = [];            // course ids, in the order added
let sourceName = "";

const chosenCourses = () => chosen.map((id) => byId.get(id)).filter(Boolean);
const label = (c) => c.id;
const halfTag = (c) => (c.half === "FIRST-HALF" ? "1st half" : c.half === "SECOND-HALF" ? "2nd half" : "");

// ---------- persistence ----------

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(chosen)); } catch { /* private mode */ }
}
function restore() {
  // A shared link (#courses=CE432,CS661) wins over the saved plan.
  const shared = new URLSearchParams(location.hash.slice(1)).get("courses");
  if (shared) {
    chosen = [...new Set(shared.split(",").map((s) => s.trim()).filter((id) => byId.has(id)))];
    save();
    history.replaceState(null, "", location.pathname);
    return;
  }
  try {
    const ids = JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
    if (Array.isArray(ids)) chosen = ids.filter((id) => byId.has(id));
  } catch { chosen = []; }
}

// ---------- toast ----------

let toastTimer;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2600);
}

// ---------- add / remove ----------

function addCourse(id) {
  const c = byId.get(id);
  if (!c) return;
  if (chosen.includes(id)) { toast(`${label(c)} is already in your timetable`); return; }
  const clashes = clashesWith(c, chosenCourses());
  chosen.push(id);
  save();
  render();
  toast(clashes.length
    ? `Added ${label(c)} — clashes with ${clashes.map(label).join(", ")}`
    : `Added ${label(c)} (${c.credits} credits)`);
}

function removeCourse(id) {
  chosen = chosen.filter((x) => x !== id);
  save();
  hidePopover();
  render();
}

// ---------- entry card ----------

function fillBranches() {
  const branches = [...new Set(courses.map((c) => c.branch))].sort();
  $("branch").innerHTML = `<option value="">Select Branch</option>` +
    branches.map((b) => `<option value="${esc(b)}">${esc(b)}</option>`).join("");
}

function fillCourseSelect() {
  const branch = $("branch").value;
  const sel = $("course");
  const keep = sel.value;
  if (!branch) {
    sel.innerHTML = `<option value="">Select Course</option>`;
    sel.disabled = true;
    updateEntryState();
    return;
  }
  const mine = chosenCourses();
  const list = courses.filter((c) => c.branch === branch).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  sel.innerHTML = `<option value="">Select Course (${list.length})</option>` + list.map((c) => {
    const added = chosen.includes(c.id);
    const clash = !added && clashesWith(c, mine).length;
    const note = added ? " ✓ added" : clash ? " ⚠ clash" : c.sessions.length ? "" : " (no fixed time)";
    return `<option value="${esc(c.id)}"${added ? " disabled" : ""}>${esc(c.id)} — ${esc(c.title)} · ${c.credits} cr${note}</option>`;
  }).join("");
  sel.disabled = false;
  if (keep && !chosen.includes(keep) && list.some((c) => c.id === keep)) sel.value = keep;
  updateEntryState();
}

function updateEntryState() {
  const c = byId.get($("course").value);
  $("add").disabled = !c;
  const hint = $("addHint");
  hint.classList.remove("warn");
  if (!c) { hint.textContent = ""; return; }
  const times = summarizeSessions(c.sessions).join(" · ") || "No fixed class time";
  const clashes = clashesWith(c, chosenCourses());
  const parts = [`${c.credits} credits`, times];
  if (halfTag(c)) parts.push(halfTag(c));
  if (c.prereq) parts.push(`Prereq: ${c.prereq}`);
  if (clashes.length) {
    parts.push(`⚠ clashes with ${clashes.map(label).join(", ")}`);
    hint.classList.add("warn");
  }
  hint.textContent = parts.join("  ·  ");
}

// ---------- credits + chips ----------

function renderChips(clashes) {
  const mine = chosenCourses();
  const credits = totalCredits(mine);
  $("creditsLabel").textContent = `Total Credits : ${String(credits).padStart(2, "0")}`;
  const box = $("chips");
  if (!mine.length) { box.innerHTML = `<span class="empty">No courses added yet.</span>`; return; }
  const clashing = mine.filter((c) => clashes.get(c.id).size);
  box.innerHTML = mine.map((c) => {
    const bad = clashes.get(c.id).size > 0;
    return `<span class="chip${bad ? " bad" : ""}" data-id="${esc(c.id)}" title="${esc(c.title)}">
      <b>${esc(c.id)}</b><span class="cr">${c.credits}</span>
      <button data-remove="${esc(c.id)}" aria-label="Remove ${esc(c.id)}">×</button></span>`;
  }).join("") + `<div class="summary">${mine.length} course${mine.length === 1 ? "" : "s"}` +
    (clashing.length
      ? ` · <span class="warn">${clashing.length} in clash: ${clashing.map((c) => esc(c.id)).join(", ")}</span>`
      : " · no clashes") + `</div>`;
}

// ---------- timetable ----------

function renderGrid() {
  const grid = $("grid");
  grid.style.setProperty("--hour", `${HOUR}px`);
  let html = `<div class="corner"></div>` + DAYS.map((d) => `<div class="dayhead">${DAY_NAMES[d]}</div>`).join("");
  let hours = "";
  for (let m = DAY_START; m <= DAY_END; m += 60)
    hours += `<span style="top:${TOP_PAD + ((m - DAY_START) / 60) * HOUR}px">${fmtTime(m)}</span>`;
  html += `<div class="times">${hours}</div>`;

  const mine = chosenCourses();
  DAYS.forEach((day, i) => {
    const blocks = [];
    for (const c of mine)
      for (const s of c.sessions)
        if (s.day === day) blocks.push({ ...s, course: c });
    const laid = layoutDay(blocks);
    const inner = laid.map((b) => {
      const c = b.course;
      const top = TOP_PAD + ((Math.max(b.start, DAY_START) - DAY_START) / 60) * HOUR;
      const height = Math.max(((Math.min(b.end, DAY_END) - Math.max(b.start, DAY_START)) / 60) * HOUR - 2, 18);
      const w = 100 / b.lanes;
      const bad = clashesAt(b, c, mine);
      const half = halfTag(c);
      return `<button class="block${bad ? " bad" : ""}" data-id="${esc(c.id)}"
        style="top:${top}px;height:${height}px;left:calc(${b.lane * w}% + 2px);width:calc(${w}% - 4px)"
        title="${esc(`${c.id} · ${c.title}`)}">
        <span class="t">${fmtTime(b.start)} - ${fmtTime(b.end)}</span>
        <span class="n">${esc(b.kind)}-${esc(c.id)}${half ? ` <span class="h">(${half})</span>` : ""}</span>
      </button>`;
    }).join("");
    html += `<div class="daycol${i % 2 ? " alt" : ""}" data-day="${day}">${inner}</div>`;
  });
  grid.innerHTML = html;

  // Courses with no fixed slot still count toward credits; list them below.
  const loose = mine.filter((c) => !c.sessions.length);
  const un = $("unscheduled");
  un.hidden = !loose.length;
  un.innerHTML = loose.length
    ? `<b>No fixed class time:</b> ${loose.map((c) => `${esc(c.id)} (${c.credits} cr)`).join(", ")}`
    : "";
}

// A block is red only if this particular session overlaps another course's session.
function clashesAt(session, course, mine) {
  return mine.some((o) => o.id !== course.id && halvesOverlap(course.half, o.half) &&
    o.sessions.some((s) => sessionsClash(s, session)));
}

function render() {
  const clashes = clashMap(chosenCourses());
  renderChips(clashes);
  renderGrid();
  fillCourseSelect();
}

// ---------- popover ----------

function showPopover(id, anchor) {
  const c = byId.get(id);
  if (!c) return;
  const others = clashesWith(c, chosenCourses());
  const pop = $("popover");
  pop.innerHTML = `
    <h4>${esc(c.id)}</h4>
    <div class="title">${esc(c.title)}</div>
    <dl>
      <dt>Credits</dt><dd>${c.credits} (${esc(c.ltp)})</dd>
      <dt>Branch</dt><dd>${esc(c.branch)}${c.types.length ? ` · ${esc(c.types.join(", "))}` : ""}</dd>
      ${halfTag(c) ? `<dt>Runs</dt><dd>${halfTag(c)} of semester</dd>` : ""}
      <dt>Times</dt><dd>${summarizeSessions(c.sessions).map(esc).join("<br>") || "No fixed time"}</dd>
      ${c.prereq ? `<dt>Prereq</dt><dd>${esc(c.prereq)}</dd>` : ""}
    </dl>
    ${others.length ? `<div class="clashline">Clashes with ${others.map((o) => esc(o.id)).join(", ")}</div>` : ""}
    <div class="row"><button class="remove" data-remove="${esc(c.id)}">Remove</button></div>`;
  pop.hidden = false;
  const r = anchor.getBoundingClientRect();
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  let left = r.right + 8, top = r.top;
  if (left + pw > innerWidth - 8) left = r.left - pw - 8;
  if (left < 8) left = Math.min(Math.max(8, r.left), innerWidth - pw - 8);
  if (top + ph > innerHeight - 8) top = Math.max(8, innerHeight - ph - 8);
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
  document.querySelectorAll(".block").forEach((b) => b.classList.toggle("hl", b.dataset.id === id));
}

function hidePopover() {
  $("popover").hidden = true;
  document.querySelectorAll(".block.hl").forEach((b) => b.classList.remove("hl"));
}

// ---------- panels ----------

const availFilters = { q: "", branch: "", type: "", half: "", fitsOnly: true, timedOnly: true };
const topicFilters = { q: "", fitsOnly: false };
let panelMode = null;

const TYPE_OPTIONS = [
  ["", "All course types"], ["DE", "Department Elective (DE)"], ["OE", "Open Elective (OE)"],
  ["DC", "Department Compulsory (DC)"], ["HSS", "HSS (HS1/HS2)"], ["IC", "Institute Core (IC)"],
  ["ESO", "ESO/SO"], ["PRF", "PG (PRF)"], ["Minor", "Minor"],
];
const matchesType = (c, t) => !t || (t === "HSS" ? c.types.some((x) => x.startsWith("HS")) : c.types.includes(t));

function openPanel(mode) {
  panelMode = mode;
  hidePopover();
  const branches = [...new Set(courses.map((c) => c.branch))].sort();
  if (mode === "available") {
    $("panelTitle").textContent = "Check Available Courses";
    $("panelFilters").innerHTML = `
      <input type="search" id="fQ" placeholder="Search code or title…" value="${esc(availFilters.q)}">
      <select id="fBranch"><option value="">All branches</option>${branches.map((b) =>
        `<option${b === availFilters.branch ? " selected" : ""}>${esc(b)}</option>`).join("")}</select>
      <select id="fType">${TYPE_OPTIONS.map(([v, t]) =>
        `<option value="${v}"${v === availFilters.type ? " selected" : ""}>${t}</option>`).join("")}</select>
      <select id="fHalf">
        <option value="">Any duration</option>
        <option value="REGULAR"${availFilters.half === "REGULAR" ? " selected" : ""}>Full semester</option>
        <option value="FIRST-HALF"${availFilters.half === "FIRST-HALF" ? " selected" : ""}>First half</option>
        <option value="SECOND-HALF"${availFilters.half === "SECOND-HALF" ? " selected" : ""}>Second half</option>
      </select>
      <label class="check"><input type="checkbox" id="fFits"${availFilters.fitsOnly ? " checked" : ""}> Only clash-free</label>
      <label class="check"><input type="checkbox" id="fTimed"${availFilters.timedOnly ? " checked" : ""}> Hide courses without class times</label>`;
    const sync = () => {
      availFilters.q = $("fQ").value;
      availFilters.branch = $("fBranch").value;
      availFilters.type = $("fType").value;
      availFilters.half = $("fHalf").value;
      availFilters.fitsOnly = $("fFits").checked;
      availFilters.timedOnly = $("fTimed").checked;
      renderPanel();
    };
    $("panelFilters").oninput = sync;
  } else {
    $("panelTitle").textContent = "Topic Base Recommendation";
    $("panelFilters").innerHTML = `
      <input type="search" id="tQ" placeholder="What do you want to learn? e.g. machine learning, finance, water" value="${esc(topicFilters.q)}">
      <label class="check"><input type="checkbox" id="tFits"${topicFilters.fitsOnly ? " checked" : ""}> Only clash-free</label>
      <div class="topic-chips">${Object.keys(TOPICS).map((t) => `<button type="button" data-topic="${esc(t)}">${esc(t)}</button>`).join("")}</div>`;
    $("panelFilters").oninput = () => {
      topicFilters.q = $("tQ").value;
      topicFilters.fitsOnly = $("tFits").checked;
      renderPanel();
    };
    $("panelFilters").onclick = (e) => {
      const t = e.target.closest("[data-topic]");
      if (!t) return;
      $("tQ").value = topicFilters.q = t.dataset.topic;
      renderPanel();
    };
  }
  $("panel").showModal();
  renderPanel();
  const first = $("panelFilters").querySelector("input[type=search]");
  first?.focus();
}

function highlight(text, words) {
  let out = esc(text);
  const ws = words.filter((w) => w.length > 1).sort((a, b) => b.length - a.length)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!ws.length) return out;
  return out.replace(new RegExp(`(${ws.join("|")})`, "gi"), "<mark>$1</mark>");
}

function resultRow(c, mine, words = []) {
  const added = chosen.includes(c.id);
  const clashes = added ? [] : clashesWith(c, mine);
  const status = added ? `<span class="tag">In timetable</span>`
    : clashes.length ? `<span class="tag clash">Clashes: ${clashes.map((o) => esc(o.id)).join(", ")}</span>`
    : `<span class="tag fit">Fits</span>`;
  const half = halfTag(c);
  return `<tr>
    <td class="code">${esc(c.id)}</td>
    <td>${highlight(c.title, words)}${c.prereq ? `<div class="sub">Prereq: ${esc(c.prereq)}</div>` : ""}</td>
    <td>${esc(c.branch)}</td>
    <td>${c.credits}</td>
    <td class="when">${summarizeSessions(c.sessions).map(esc).join("<br>") || "—"}${half ? `<br><span class="tag half">${half}</span>` : ""}</td>
    <td>${c.types.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</td>
    <td>${status}</td>
    <td><button class="addbtn${added ? " added" : ""}" data-add="${esc(c.id)}"${added ? " disabled" : ""}>${added ? "Added" : "Add"}</button></td>
  </tr>`;
}

const TABLE_HEAD = `<table class="results"><thead><tr>
  <th>Code</th><th>Course</th><th>Br</th><th>Cr</th><th>Times</th><th>Type</th><th>Status</th><th></th>
</tr></thead><tbody>`;

function renderPanel() {
  const body = $("panelBody");
  const scroll = body.scrollTop;
  const mine = chosenCourses();
  let rows = [], total = 0, words = [];

  if (panelMode === "available") {
    const q = availFilters.q.trim().toLowerCase();
    const list = courses.filter((c) => {
      if (chosen.includes(c.id)) return false;
      if (availFilters.branch && c.branch !== availFilters.branch) return false;
      if (!matchesType(c, availFilters.type)) return false;
      if (availFilters.half && c.half !== availFilters.half) return false;
      if (availFilters.timedOnly && !c.sessions.length) return false;
      if (q && !`${c.id} ${c.title}`.toLowerCase().includes(q)) return false;
      if (availFilters.fitsOnly && clashesWith(c, mine).length) return false;
      return true;
    }).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
    total = list.length;
    rows = list.slice(0, RESULT_LIMIT);
    words = q ? [q] : [];
    $("panelMeta").textContent = mine.length
      ? `${total} course${total === 1 ? "" : "s"} match${availFilters.fitsOnly ? ` and fit around your ${mine.length} chosen` : ""}.`
      : `${total} course${total === 1 ? "" : "s"} match. Add courses first to filter out clashes.`;
  } else {
    const recs = recommend(courses, topicFilters.q)
      .filter((r) => !topicFilters.fitsOnly || chosen.includes(r.course.id) || !clashesWith(r.course, mine).length);
    total = recs.length;
    rows = recs.slice(0, RESULT_LIMIT).map((r) => r.course);
    words = [...new Set(recs.slice(0, RESULT_LIMIT).flatMap((r) => r.hits))];
    $("panelMeta").textContent = topicFilters.q.trim()
      ? `${total} course${total === 1 ? "" : "s"} related to “${topicFilters.q.trim()}”, best matches first.`
      : "Type a topic or pick one below to get course suggestions.";
  }

  body.innerHTML = rows.length
    ? TABLE_HEAD + rows.map((c) => resultRow(c, mine, words)).join("") + "</tbody></table>" +
      (total > rows.length ? `<p class="panel-meta">Showing first ${rows.length} of ${total}. Narrow the search to see more.</p>` : "")
    : `<div class="no-results">${panelMode === "topics" && !topicFilters.q.trim() ? "" : "No courses found."}</div>`;
  body.scrollTop = scroll;
}

// ---------- menu actions ----------

function download(name, text, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function courseListText() {
  const mine = chosenCourses();
  return mine.map((c) => `${c.id}  ${c.title}  (${c.credits} cr)\n    ${summarizeSessions(c.sessions).join("; ") || "No fixed time"}`)
    .join("\n") + `\n\nTotal credits: ${totalCredits(mine)}`;
}

async function menuAction(act) {
  $("menu").hidden = true;
  $("menuBtn").setAttribute("aria-expanded", "false");
  if (act === "print") window.print();
  else if (act === "link") {
    if (!chosen.length) return toast("Add courses first");
    const url = `${location.origin}${location.pathname}#courses=${chosen.map(encodeURIComponent).join(",")}`;
    try { await navigator.clipboard.writeText(url); toast("Share link copied"); }
    catch { toast("Couldn't access the clipboard"); }
  } else if (act === "copy") {
    if (!chosen.length) return toast("Nothing to copy yet");
    try { await navigator.clipboard.writeText(courseListText()); toast("Course list copied"); }
    catch { toast("Couldn't access the clipboard"); }
  } else if (act === "export") {
    if (!chosen.length) return toast("Nothing to export yet");
    download("slotwise-plan.json", JSON.stringify({ app: "SlotWise", source: sourceName, courses: chosen }, null, 2), "application/json");
  } else if (act === "import") $("importFile").click();
  else if (act === "clear") resetAll();
}

async function importPlan(file) {
  try {
    const data = JSON.parse(await file.text());
    const ids = Array.isArray(data) ? data : data.courses;
    if (!Array.isArray(ids)) throw new Error("bad file");
    const known = ids.filter((id) => byId.has(id));
    chosen = [...new Set(known)];
    save();
    render();
    const missing = ids.length - known.length;
    toast(`Imported ${known.length} course${known.length === 1 ? "" : "s"}${missing ? ` (${missing} not in this schedule)` : ""}`);
  } catch {
    toast("That file isn't a SlotWise plan");
  }
}

function resetAll() {
  if (chosen.length && !confirm(`Remove all ${chosen.length} courses from your timetable?`)) return;
  chosen = [];
  save();
  $("branch").value = "";
  hidePopover();
  render();
}

// ---------- wiring ----------

function wire() {
  $("branch").addEventListener("change", fillCourseSelect);
  $("course").addEventListener("change", updateEntryState);
  $("course").addEventListener("keydown", (e) => { if (e.key === "Enter" && $("course").value) addCourse($("course").value); });
  $("add").addEventListener("click", () => {
    const id = $("course").value;
    if (id) { addCourse(id); $("course").value = ""; updateEntryState(); }
  });
  $("reset").addEventListener("click", resetAll);
  $("openAvailable").addEventListener("click", () => openPanel("available"));
  $("openTopics").addEventListener("click", () => openPanel("topics"));

  $("panelBody").addEventListener("click", (e) => {
    const b = e.target.closest("[data-add]");
    if (b) { addCourse(b.dataset.add); renderPanel(); }
  });
  $("panel").addEventListener("click", (e) => { if (e.target === $("panel")) $("panel").close(); });

  $("chips").addEventListener("click", (e) => {
    const rm = e.target.closest("[data-remove]");
    if (rm) return removeCourse(rm.dataset.remove);
    const chip = e.target.closest(".chip");
    if (chip) { e.stopPropagation(); showPopover(chip.dataset.id, chip); }
  });
  $("grid").addEventListener("click", (e) => {
    const b = e.target.closest(".block");
    if (b) { e.stopPropagation(); showPopover(b.dataset.id, b); }
  });
  $("popover").addEventListener("click", (e) => {
    e.stopPropagation();
    const rm = e.target.closest("[data-remove]");
    if (rm) removeCourse(rm.dataset.remove);
  });

  $("menuBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    const m = $("menu");
    m.hidden = !m.hidden;
    $("menuBtn").setAttribute("aria-expanded", String(!m.hidden));
  });
  $("menu").addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (b) menuAction(b.dataset.act);
  });
  $("importFile").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (f) importPlan(f);
    e.target.value = "";
  });

  document.addEventListener("click", () => {
    hidePopover();
    $("menu").hidden = true;
    $("menuBtn").setAttribute("aria-expanded", "false");
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { hidePopover(); $("menu").hidden = true; } });
  window.addEventListener("resize", hidePopover);
  window.addEventListener("scroll", hidePopover, { passive: true });
}

async function init() {
  wire();
  try {
    const res = await fetch("data/courses.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    courses = data.courses;
    sourceName = data.source;
  } catch {
    $("addHint").textContent = "Couldn't load data/courses.json — run ./run.sh to build it from the Excel file.";
    $("addHint").classList.add("warn");
    renderGrid();
    return;
  }
  byId = new Map(courses.map((c) => [c.id, c]));
  $("source").textContent = `${courses.length} courses · ${sourceName}`;
  fillBranches();
  restore();
  render();
}

init();
