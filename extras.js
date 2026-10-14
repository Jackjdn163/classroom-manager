// Features brought over from the old HomeworkPlanner: assignment types, subtask
// checklists, recurring assignments, busy times, class colors, Smart Add + photo
// scan, focus timer, study history / streaks, the "Right now" card, and backups.
// Uses globals from the other scripts only when called.

// ---------- Assignment types ----------

const TYPES = ["Homework", "Project", "Essay", "Quiz", "Test", "Studying", "Other"];
const TYPE_MINUTES = { Homework: 30, Project: 120, Essay: 90, Quiz: 30, Test: 90, Studying: 45, Other: 30 };

function typeOf(item) {
  if (item.kind) return item.kind;
  if (item.type === "MULTIPLE_CHOICE_QUESTION" || item.type === "SHORT_ANSWER_QUESTION") return "Quiz";
  return null; // regular Classroom assignment: no type shown
}

// ---------- Subtask checklists (any assignment) ----------

const subtasks = loadJSON("subtasks", {}); // itemId -> [{ id, text, done }]
const openChecklists = new Set();          // which checklists are expanded (this visit only)
function saveSubtasks() { saveJSON("subtasks", subtasks); }

const SUGGESTED_STEPS = {
  Essay: ["Read the prompt", "Make an outline", "Write the first draft", "Revise and proofread"],
  Project: ["Check the requirements", "Research and gather materials", "Build the main draft", "Review and finish"],
  Test: ["Review notes", "Do practice problems", "Go over weak spots", "Quick final recap"],
  Quiz: ["Review notes", "Do practice problems", "Quick final recap"],
  Studying: ["Review notes", "Practice", "Self-check"],
};
function suggestedSteps(item) {
  return SUGGESTED_STEPS[typeOf(item)] || (estimateOf(item) >= 120
    ? ["Understand the directions", "First pass", "Finish the rest", "Review before turning in"]
    : ["Do the work", "Check it over"]);
}

function setSteps(itemId, texts) {
  subtasks[itemId] = texts.map((text, n) => ({ id: `s${Date.now().toString(36)}${n}`, text, done: false }));
  if (!subtasks[itemId].length) delete subtasks[itemId];
  saveSubtasks();
}

function nextStep(item) {
  return (subtasks[item.id] || []).find((s) => !s.done)?.text || null;
}

// "☑ 1/4 steps" toggle plus, when open, the checklist itself.
function checklistControls(item) {
  const steps = subtasks[item.id] || [];
  const wrap = el("div", "checklist-wrap");
  const done = steps.filter((s) => s.done).length;
  const toggle = button(steps.length ? `☑ ${done}/${steps.length} steps` : "☐ Add steps", () => {
    if (openChecklists.has(item.id)) openChecklists.delete(item.id);
    else openChecklists.add(item.id);
    render();
  });
  toggle.className = "link-btn";
  wrap.append(toggle);
  if (!openChecklists.has(item.id)) return wrap;

  const list = el("ul", "checklist");
  for (const s of steps) {
    const li = el("li", s.done ? "done" : "");
    const box = inputEl("checkbox");
    box.checked = s.done;
    box.onchange = () => { s.done = box.checked; saveSubtasks(); render(); };
    const x = button("✕", () => {
      subtasks[item.id] = steps.filter((t) => t !== s);
      if (!subtasks[item.id].length) delete subtasks[item.id];
      saveSubtasks();
      render();
    }, "Remove step");
    x.className = "link-btn";
    const label = el("label");
    label.append(box, " " + s.text);
    li.append(label, x);
    list.append(li);
  }
  const add = el("form", "add-step");
  const input = inputEl("text", "", { placeholder: "Add a step…" });
  add.append(input);
  add.onsubmit = (e) => {
    e.preventDefault();
    if (!input.value.trim()) return;
    (subtasks[item.id] ||= []).push({ id: "s" + Date.now().toString(36), text: input.value.trim(), done: false });
    saveSubtasks();
    render();
    setTimeout(() => document.querySelector(`[data-steps="${CSS.escape(item.id)}"] .add-step input`)?.focus());
  };
  if (!steps.length) {
    const suggest = button("Suggest steps", () => { setSteps(item.id, suggestedSteps(item)); render(); });
    suggest.type = "button";
    suggest.className = "link-btn";
    add.append(suggest);
  }
  wrap.dataset.steps = item.id;
  wrap.append(list, add);
  return wrap;
}

// ---------- Recurring assignments ----------

// { id, title, course, kind, link, notes, minutes, priority, repeat: "daily"|"weekdays"|"weekly",
//   first: ISO due of first one, skip: [instance ids you deleted], until?: ISO }
let templates = loadJSON("templates", []);
function saveTemplates() { saveJSON("templates", templates); }
const REPEATS = { none: "Doesn't repeat", daily: "Every day", weekdays: "Every weekday (Mon–Fri)", weekly: "Every week" };

// Creates the next 2 weeks of each recurring assignment (never duplicates or re-adds deleted ones).
function ensureRecurring() {
  const today = startOfDay(new Date());
  const until = addDays(today, 15);
  let changed = false;
  for (const t of templates) {
    const first = new Date(t.first);
    for (let d = startOfDay(first); d < until; d = addDays(d, 1)) {
      if (d < addDays(today, -1)) continue;
      const wd = d.getDay();
      const match = t.repeat === "daily" || (t.repeat === "weekdays" && wd >= 1 && wd <= 5) || (t.repeat === "weekly" && wd === first.getDay());
      if (!match) continue;
      const id = `${t.id}:${dateInputValue(d)}`;
      if (t.skip.includes(id) || manualItems.some((m) => m.id === id)) continue;
      const due = new Date(d.getFullYear(), d.getMonth(), d.getDate(), first.getHours(), first.getMinutes());
      manualItems.push({ id, templateId: t.id, title: t.title, course: t.course, kind: t.kind, link: t.link, notes: t.notes, due: due.toISOString() });
      estimates[id] = t.minutes;
      if (t.priority !== "normal") priorities[id] = t.priority;
      changed = true;
    }
  }
  if (changed) { saveManual(); saveEstimates(); savePriorities(); }
}

function stopRepeating(templateId) {
  templates = templates.filter((t) => t.id !== templateId);
  saveTemplates();
  // Remove the upcoming copies that haven't been started or finished.
  const now = new Date();
  manualItems = manualItems.filter((m) => m.templateId !== templateId || new Date(m.due) < now || completed.has(m.id));
  saveManual();
}

// ---------- Busy times (practice, work, appointments) ----------

// { id, title, repeat: "once"|"daily"|"weekdays"|"weekly", date: "YYYY-MM-DD", start: "HH:MM", end: "HH:MM" }
let busyTimes = loadJSON("busyTimes", []);
function saveBusy() { saveJSON("busyTimes", busyTimes); }
const BUSY_REPEATS = { once: "One time", daily: "Every day", weekdays: "Weekdays", weekly: "Every week" };

function busyOn(b, day) {
  const anchor = new Date(b.date + "T12:00");
  const wd = day.getDay();
  if (startOfDay(day) < startOfDay(anchor)) return false;
  if (b.repeat === "once") return dateInputValue(day) === b.date;
  if (b.repeat === "daily") return true;
  if (b.repeat === "weekdays") return wd >= 1 && wd <= 5;
  if (b.repeat === "weekly") return wd === anchor.getDay();
  return false;
}

// Every busy time between two dates, as { busyId, title, start, end }.
function busyOccurrences(from, to) {
  const out = [];
  for (let d = startOfDay(from); d < to; d = addDays(d, 1)) {
    for (const b of busyTimes) {
      if (!busyOn(b, d)) continue;
      const start = fromDateTimeInputs(dateInputValue(d), b.start);
      let end = fromDateTimeInputs(dateInputValue(d), b.end);
      if (end <= start) end = addDays(end, 1); // goes past midnight
      out.push({ busyId: b.id, title: b.title, start, end });
    }
  }
  return out;
}

function openBusyTimes() {
  const wrap = el("div", "form");
  const list = el("div", "busy-list");
  if (!busyTimes.length) list.append(el("p", "sub", "No busy times yet. Add practices, jobs, clubs or appointments so the plan works around them."));
  for (const b of busyTimes) {
    const row = el("div", "busy-row");
    const t = (s) => fmtTime(fromDateTimeInputs("2023-01-01", s));
    const when = b.repeat === "once"
      ? new Date(b.date + "T12:00").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })
      : b.repeat === "weekly" ? "Every " + new Date(b.date + "T12:00").toLocaleDateString([], { weekday: "long" }) : BUSY_REPEATS[b.repeat];
    row.append(el("span", "", `${b.title} · ${when} · ${t(b.start)}–${t(b.end)}`));
    const del = button("Delete", () => { busyTimes = busyTimes.filter((x) => x !== b); saveBusy(); openBusyTimes(); render(); });
    del.className = "hide-btn";
    row.append(del);
    list.append(row);
  }

  const form = el("form", "form");
  const title = inputEl("text", "", { required: true, placeholder: "e.g. Soccer practice" });
  const repeat = selectEl(Object.entries(BUSY_REPEATS), "weekdays");
  const date = inputEl("date", dateInputValue(new Date()), { required: true });
  const start = inputEl("time", "16:30", { required: true });
  const end = inputEl("time", "18:00", { required: true });
  const r1 = el("div", "field-row");
  r1.append(field("Repeats", repeat), field("Starting", date));
  const r2 = el("div", "field-row");
  r2.append(field("From", start), field("To", end));
  const actions = el("div", "modal-actions");
  const save = el("button", "primary", "Add busy time");
  save.type = "submit";
  actions.append(save);
  form.append(field("What", title), r1, r2, actions);
  form.onsubmit = (e) => {
    e.preventDefault();
    if (!title.value.trim() || start.value === end.value) return;
    busyTimes.push({ id: "busy" + Date.now().toString(36), title: title.value.trim(), repeat: repeat.value, date: date.value, start: start.value, end: end.value });
    saveBusy();
    openBusyTimes();
    render();
  };

  wrap.append(list, el("h4", "", "Add a busy time"), form);
  openModal("Busy times", wrap, { wide: true });
}

// ---------- Class colors ----------

const classColors = loadJSON("classColors", {});
const PALETTE = ["#3b82f6", "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#84cc16", "#f97316"];
// Classes without a chosen color get the next palette color, in alphabetical order,
// so different classes look different.
let paletteIndex = new Map();
function refreshClassColors() {
  const names = [...new Set([...items.map((i) => i.course), ...scheduleClassNames()])].sort();
  paletteIndex = new Map(names.map((n, i) => [n, i]));
}
function classColor(course) {
  if (classColors[course]) return classColors[course];
  if (paletteIndex.has(course)) return PALETTE[paletteIndex.get(course) % PALETTE.length];
  let h = 0;
  for (const c of String(course)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
function classDot(course) {
  const d = el("span", "class-dot");
  d.style.background = classColor(course);
  return d;
}

// ---------- Smart Add (type it, or scan a photo) ----------

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

// "Bio quiz Friday at 3pm, 2 hours, high priority" -> { title, course, kind, priority, due, minutes }
function parseSmartText(text) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  let rest = " " + raw + " ";
  const lower = () => rest.toLowerCase();
  const take = (re) => { const m = lower().match(re); if (m) rest = rest.slice(0, m.index) + " " + rest.slice(m.index + m[0].length); return m; };
  const now = new Date();
  const out = { title: "", course: "", kind: "Homework", priority: "normal", due: null, minutes: null };

  // Class: longest known class name mentioned. Type: first type word. (Both stay in the title.)
  const known = [...new Set(items.map((i) => i.course))].sort((a, b) => b.length - a.length);
  out.course = known.find((c) => lower().includes(c.toLowerCase())) || "";
  out.kind = TYPES.find((t) => new RegExp(`\\b${t.toLowerCase()}\\b`).test(lower())) || "Homework";
  const p = take(/\b(urgent|high|low|normal|medium)(\s+priority)?\b/);
  if (p) out.priority = { medium: "normal" }[p[1]] || p[1];

  const dur = take(/\b(\d+(?:\.\d+)?)\s*(hours?|hrs?|h)\b/) ;
  if (dur) out.minutes = Math.round(Number(dur[1]) * 60);
  const mins = !dur && take(/\b(\d+)\s*(minutes?|mins?|m)\b/);
  if (mins) out.minutes = Number(mins[1]);

  let day = null;
  let m;
  if (take(/\btoday\b|\btonight\b/)) day = startOfDay(now);
  else if (take(/\btomorrow\b/)) day = addDays(startOfDay(now), 1);
  else if ((m = take(/\bin (\d+) days?\b/))) day = addDays(startOfDay(now), Number(m[1]));
  else if ((m = take(/\b(?:next |this |on |due )?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)[a-z]*\b/))) {
    const wd = WEEKDAYS.findIndex((w) => w.startsWith(m[1].slice(0, 3)));
    day = addDays(startOfDay(now), ((wd - now.getDay() + 7) % 7) || 7);
  } else if ((m = take(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/))) {
    const y = m[3] ? Number(m[3].length === 2 ? "20" + m[3] : m[3]) : now.getFullYear();
    day = new Date(y, Number(m[1]) - 1, Number(m[2]));
    if (!m[3] && day < startOfDay(now)) day.setFullYear(y + 1);
  }
  let hour = 23, minute = 59;
  if ((m = take(/\b(?:at |by )?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/))) {
    hour = (Number(m[1]) % 12) + (m[3] === "pm" ? 12 : 0);
    minute = Number(m[2] || 0);
  }
  if (day) out.due = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute);

  out.title = rest.replace(/\b(due|priority|worth|for|on|at|by)\b/gi, " ").replace(/[,;:]+/g, " ").replace(/\s+/g, " ").trim()
    || `${out.course} ${out.kind}`.trim() || raw;
  out.title = out.title.charAt(0).toUpperCase() + out.title.slice(1);
  return out;
}

function openSmartAdd() {
  const wrap = el("div", "form");
  const text = el("textarea");
  text.rows = 3;
  text.placeholder = "e.g. Bio quiz Friday, 2 hours, high priority";
  const preview = el("p", "sub smart-preview");
  const show = () => {
    const p = parseSmartText(text.value);
    preview.textContent = text.value.trim()
      ? `→ ${p.title} · ${p.course || "no class"} · ${p.kind} · ${PRIORITY[p.priority].label} · ${p.due ? "due " + fmtDate(p.due) : "no due date found"}${p.minutes ? " · " + fmtMinutes(p.minutes) : ""}`
      : "";
  };
  text.oninput = show;

  const photo = inputEl("file", null, { accept: "image/*" });
  photo.setAttribute("capture", "environment");
  const scanStatus = el("p", "sub");
  photo.onchange = async () => {
    const file = photo.files[0];
    if (!file) return;
    scanStatus.textContent = "Reading the photo… (the first scan takes a little longer)";
    try {
      const words = await scanPhoto(file);
      text.value = words.trim();
      scanStatus.textContent = words.trim() ? "Done. Check the text above and fix anything it misread." : "Couldn't find any text in that photo.";
      show();
    } catch (e) {
      scanStatus.textContent = "Couldn't scan the photo: " + e.message;
    }
  };

  const actions = el("div", "modal-actions");
  const go = button("Fill in the form", () => {
    if (!text.value.trim()) return;
    openAssignmentForm(null, parseSmartText(text.value));
  });
  go.classList.add("primary");
  actions.append(go);
  wrap.append(
    field("Describe the assignment", text), preview,
    field("Or scan a photo of it", photo), scanStatus,
    el("p", "sub", "Understands class names, types (quiz, test, essay…), priority, days (today, Friday, 10/24, in 3 days), times (at 3pm) and how long it takes (2 hours, 45 min). The photo is read on your device and not uploaded."),
    actions,
  );
  openModal("Smart Add", wrap, { wide: true });
}

// Reads text from a photo in the browser (loads the OCR library the first time).
async function scanPhoto(file) {
  if (!window.Tesseract) {
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
      s.onload = resolve;
      s.onerror = () => reject(new Error("the scanner couldn't load. Check your internet connection."));
      document.head.append(s);
    });
  }
  const worker = await Tesseract.createWorker("eng");
  try {
    return (await worker.recognize(file)).data.text || "";
  } finally {
    await worker.terminate();
  }
}

// ---------- Study history, streaks ----------

let studyLog = loadJSON("history", []); // [{ key, date: "YYYY-MM-DD", minutes, itemId, course }]
function saveHistory() { saveJSON("history", studyLog.slice(-1000)); }

function logStudy(key, minutes, item, when = new Date()) {
  studyLog = studyLog.filter((h) => h.key !== key);
  if (minutes > 0) studyLog.push({ key, date: dateInputValue(when), minutes: Math.round(minutes), itemId: item?.id, course: item?.course || "Other" });
  saveHistory();
}
function unlogStudy(key) {
  studyLog = studyLog.filter((h) => h.key !== key);
  saveHistory();
}

function progressSummary() {
  const today = startOfDay(new Date());
  const weekStart = dateInputValue(addDays(today, -6));
  const week = studyLog.filter((h) => h.date >= weekStart);
  const minutes = week.reduce((m, h) => m + h.minutes, 0);
  const byClass = new Map();
  for (const h of week) byClass.set(h.course, (byClass.get(h.course) || 0) + h.minutes);
  const top = [...byClass].sort((a, b) => b[1] - a[1])[0];
  // Streak: days in a row with study, counting back from today (or yesterday if nothing yet today).
  const days = new Set(studyLog.map((h) => h.date));
  let d = days.has(dateInputValue(today)) ? today : addDays(today, -1);
  let streak = 0;
  while (days.has(dateInputValue(d))) { streak++; d = addDays(d, -1); }
  return { minutes, sessions: week.length, streak, top };
}

// ---------- Focus timer ----------

// { itemId, blockId?, running, startedAt, elapsed (seconds before the current run) }
let focusState = loadJSON("focus", null);
function saveFocus() { saveJSON("focus", focusState); }
const focusSeconds = () => !focusState ? 0 : focusState.elapsed + (focusState.running ? Math.round((Date.now() - focusState.startedAt) / 1000) : 0);
const fmtClock = (s) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (h ? h + ":" + pad2(m) : m) + ":" + pad2(sec);
};

function startFocus(target) {
  focusState = { itemId: target.item.id, blockId: target.block?.id || null, running: true, startedAt: Date.now(), elapsed: 0 };
  saveFocus();
  render();
}
function pauseFocus() {
  focusState.elapsed = focusSeconds();
  focusState.running = false;
  saveFocus();
  render();
}
function resumeFocus() {
  focusState.running = true;
  focusState.startedAt = Date.now();
  saveFocus();
  render();
}
function cancelFocus() {
  focusState = null;
  saveFocus();
  render();
}

// Saves the timed minutes; finishedAssignment also marks the assignment done.
function finishFocus(finishedAssignment) {
  const minutes = Math.max(1, Math.round(focusSeconds() / 60));
  const item = items.find((i) => i.id === focusState.itemId);
  const block = plan?.blocks.find((b) => b.id === focusState.blockId);
  if (block) {
    block.done = true;
    savePlan();
  } else if (item && !finishedAssignment) {
    // No planned session: take the time off what's left of the estimate.
    estimates[item.id] = Math.max(5, Math.round((estimateOf(item) - minutes) / 5) * 5);
    saveEstimates();
  }
  logStudy(block ? "block:" + block.id : "focus:" + Date.now(), minutes, item);
  if (finishedAssignment && item && !item.turnedIn) {
    completed.add(item.id);
    saveCompleted();
  }
  focusState = null;
  saveFocus();
  render();
}

// Keep the clock ticking without redrawing the whole page.
setInterval(() => {
  const clock = document.getElementById("focusClock");
  if (clock && focusState) clock.textContent = fmtClock(focusSeconds());
}, 1000);

// ---------- "Right now" card ----------

// What to work on: the session happening now, else the next one today, else the top open assignment.
function focusTarget(now = Date.now()) {
  const blocks = activePlanBlocks().filter((b) => !b.done && b.item && !b.item.done);
  const current = blocks.find((b) => b.start <= now && b.end > now);
  if (current) return { item: current.item, block: current, why: `Planned now · ${blockLabel(current)}` };
  const todayKey = dayKey(new Date(now));
  const next = blocks.find((b) => b.start > now && dayKey(b.start) === todayKey);
  if (next) return { item: next.item, block: next, why: `Next session today · ${blockLabel(next)}` };
  const top = items.filter((i) => !i.done && !i.removed && i.tier !== "nodate").sort(compare)[0];
  if (top) return { item: top, block: null, why: top.tier === "missing" ? "Most overdue" : "Due soonest" };
  return null;
}

function plannerStatus() {
  const open = items.filter((i) => !i.done && !i.removed);
  const missing = open.filter((i) => i.tier === "missing").length;
  const unfit = plan ? plan.unfit.filter((u) => open.some((i) => i.id === u.itemId)).length : 0;
  const soon = open.filter((i) => i.tier === "urgent").length;
  if (unfit) return ["warn", `Needs attention: ${unfit} assignment${unfit > 1 ? "s don't" : " doesn't"} fit before ${unfit > 1 ? "they're" : "it's"} due`];
  if (missing) return ["warn", `Catching up: ${missing} missing`];
  if (soon >= 2) return ["focus", `Busy stretch: ${soon} due in the next 2 days`];
  return ["ok", "On track"];
}

function renderRightNow(now) {
  const card = $("rightNow");
  card.innerHTML = "";
  if (!hasData()) return card.classList.add("hidden");
  card.classList.remove("hidden");

  const [level, text] = plannerStatus();
  const head = el("div", "rn-head");
  head.append(el("span", `rn-status ${level}`, text));
  const p = progressSummary();
  head.append(el("span", "sub", [
    `${fmtMinutes(p.minutes)} studied in the last 7 days`,
    p.streak ? `🔥 ${p.streak}-day streak` : "",
    p.top ? `top class: ${p.top[0]}` : "",
  ].filter(Boolean).join(" · ")));
  card.append(head);

  const target = focusState ? { item: items.find((i) => i.id === focusState.itemId), block: plan?.blocks.find((b) => b.id === focusState.blockId) } : focusTarget(now);
  if (!target?.item) {
    card.append(el("p", "sub", "Nothing to work on right now. 🎉"));
    return;
  }
  const row = el("div", "rn-row");
  const info = el("div", "rn-info");
  const t = el(target.item.link ? "a" : "span", "title", target.item.title);
  if (target.item.link) { t.href = target.item.link; t.target = "_blank"; t.rel = "noopener"; }
  const step = nextStep(target.item);
  info.append(
    el("div", "kicker", focusState ? (focusState.running ? "Focusing on" : "Paused") : "Work on this now"),
    t,
    el("div", "meta", [target.item.course, focusState ? "" : target.why, step ? "next step: " + step : ""].filter(Boolean).join(" · ")),
  );
  const ctl = el("div", "rn-controls");
  if (!focusState) {
    const go = button("▶ Start focus timer", () => startFocus(target));
    go.classList.add("primary");
    ctl.append(go);
  } else {
    const clock = el("span", "rn-clock", fmtClock(focusSeconds()));
    clock.id = "focusClock";
    ctl.append(
      clock,
      button(focusState.running ? "Pause" : "Resume", focusState.running ? pauseFocus : resumeFocus),
      button(target.block ? "✓ Session done" : "✓ Log time", () => finishFocus(false)),
      button("✓ Assignment finished", () => finishFocus(true)),
      button("Cancel", cancelFocus),
    );
    ctl.lastChild.className = "hide-btn";
  }
  row.append(info, ctl);
  card.append(row);
}

// ---------- Backup and restore ----------

function exportBackup() {
  const data = {};
  for (let n = 0; n < localStorage.length; n++) {
    const k = localStorage.key(n);
    if (k !== "cache" && k !== "notified") data[k] = localStorage.getItem(k);
  }
  const blob = new Blob([JSON.stringify({ app: "classroom-priorities", at: new Date().toISOString(), data }, null, 2)], { type: "application/json" });
  const a = el("a");
  a.href = URL.createObjectURL(blob);
  a.download = `classroom-priorities-backup-${dateInputValue(new Date())}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importBackup(file) {
  try {
    const backup = JSON.parse(await file.text());
    if (backup.app !== "classroom-priorities" || typeof backup.data !== "object") throw new Error("That isn't a Classroom Priorities backup file.");
    if (!confirm(`Replace everything in this browser with the backup from ${new Date(backup.at).toLocaleString()}?`)) return;
    for (const [k, v] of Object.entries(backup.data)) localStorage.setItem(k, v);
    location.reload();
  } catch (e) {
    showMessage("Couldn't restore the backup: " + e.message, true);
  }
}
