// Classroom Priorities: pulls your Google Classroom assignments + your submissions,
// figures out what's missing / due soon, and ranks everything into one list.

const SCOPES = [
  "https://www.googleapis.com/auth/classroom.courses.readonly",
  "https://www.googleapis.com/auth/classroom.coursework.me.readonly",
].join(" ");
const API = "https://classroom.googleapis.com/v1/";
const HOUR = 3600e3, DAY = 24 * HOUR;

const TIERS = {
  missing: { label: "Missing",            order: 0 },
  urgent:  { label: "Due in 48 hrs",      order: 1 },
  soon:    { label: "Due this week",      order: 2 },
  later:   { label: "Coming up",          order: 3 },
  nodate:  { label: "No due date",        order: 4 },
  done:    { label: "Done",               order: 5 },
};

const $ = (id) => document.getElementById(id);
let accessToken = null;
let tokenClient = null;
let items = [];
let view = "list";
// Missing assignments the user chose to hide, remembered in this browser.
const hidden = new Set((() => { try { return JSON.parse(localStorage.getItem("hidden")) || []; } catch { return []; } })());
function saveHidden() { try { localStorage.setItem("hidden", JSON.stringify([...hidden])); } catch {} }
let calMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let selectedDay = new Date(new Date().setHours(0, 0, 0, 0));
let calMode = (() => { try { return localStorage.getItem("calMode") === "week" ? "week" : "month"; } catch { return "month"; } })();

// ---------- Google sign-in ----------

function signIn() {
  const clientId = window.CLASSROOM_CONFIG?.CLIENT_ID;
  if (!clientId || clientId.startsWith("PASTE_")) {
    return showMessage("No Client ID yet. Open <code>config.js</code> and paste your Google OAuth Client ID (see README.md), then reload this page.", true);
  }
  if (!window.google?.accounts?.oauth2) {
    return showMessage("Google sign-in library hasn't loaded yet. Check your internet connection and try again.", true);
  }
  tokenClient ??= google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: SCOPES,
    callback: (resp) => {
      if (resp.error) return showMessage("Sign-in failed: " + resp.error, true);
      accessToken = resp.access_token;
      $("signInBtn").classList.add("hidden");
      $("demoBtn").classList.add("hidden");
      $("refreshBtn").classList.remove("hidden");
      load();
    },
  });
  tokenClient.requestAccessToken();
}

async function api(path, params = {}) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) {
    [].concat(v).forEach((val) => url.searchParams.append(k, val));
  }
  const res = await fetch(url, { headers: { Authorization: "Bearer " + accessToken } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error?.message || res.statusText);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function listAll(path, key, params = {}) {
  const out = [];
  let pageToken;
  do {
    const data = await api(path, { ...params, pageSize: 100, ...(pageToken && { pageToken }) });
    out.push(...(data[key] || []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return out;
}

// ---------- Loading data ----------

async function load() {
  setStatus("Loading your classes…");
  $("refreshBtn").disabled = true;
  hideMessage();
  try {
    const courses = await listAll("courses", "courses", { studentId: "me", courseStates: "ACTIVE" });
    setStatus(`Loading assignments from ${courses.length} classes…`);

    const skipped = [];
    const perCourse = await Promise.all(courses.map(async (course) => {
      try {
        const [work, subs] = await Promise.all([
          listAll(`courses/${course.id}/courseWork`, "courseWork"),
          listAll(`courses/${course.id}/courseWork/-/studentSubmissions`, "studentSubmissions", { userId: "me" }),
        ]);
        const subByWork = new Map(subs.map((s) => [s.courseWorkId, s]));
        return work.map((w) => toItem(course, w, subByWork.get(w.id)));
      } catch (e) {
        skipped.push(course.name);
        return [];
      }
    }));

    items = perCourse.flat();
    fillCourseFilter(courses.map((c) => c.name));
    render();
    setStatus(`Updated ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · ${courses.length} classes · ${items.length} assignments`);
    if (skipped.length) showMessage("Couldn't read assignments from: " + skipped.join(", "));
  } catch (e) {
    if (e.status === 401) {
      accessToken = null;
      showMessage("Your sign-in expired. Click Sign in again.", true);
      $("signInBtn").classList.remove("hidden");
      $("refreshBtn").classList.add("hidden");
    } else if (e.status === 403) {
      showMessage("Google blocked access: " + e.message + "<br><br>If this is a school account, your school may block outside apps from reading Classroom. See README.md → Troubleshooting.", true);
    } else {
      showMessage("Something went wrong: " + e.message, true);
    }
    setStatus("");
  } finally {
    $("refreshBtn").disabled = false;
  }
}

// Classroom gives dueDate/dueTime in UTC; proto3 omits zero fields, so default them.
function dueOf(w) {
  if (!w.dueDate) return null;
  const { year, month, day } = w.dueDate;
  const { hours = 0, minutes = 0 } = w.dueTime || {};
  return new Date(Date.UTC(year, month - 1, day, hours, minutes));
}

function toItem(course, w, sub) {
  const due = dueOf(w);
  const state = sub?.state || "NEW";
  const done = state === "TURNED_IN" || state === "RETURNED";
  return {
    id: `${course.id}:${w.id}`,
    title: w.title || "(untitled)",
    course: course.name,
    due,
    points: w.maxPoints || 0,
    type: w.workType,
    done,
    state,
    grade: sub?.assignedGrade,
    // Prefer the submission link (opens your own work page); fall back to the assignment.
    link: sub?.alternateLink || w.alternateLink || course.alternateLink,
  };
}

// ---------- Prioritizing ----------

function tierOf(item, now = Date.now()) {
  if (item.done) return "done";
  if (!item.due) return "nodate";
  const diff = item.due - now;
  if (diff < 0) return "missing";
  if (diff < 2 * DAY) return "urgent";
  if (diff < 7 * DAY) return "soon";
  return "later";
}

function compare(a, b) {
  const ta = TIERS[a.tier].order, tb = TIERS[b.tier].order;
  if (ta !== tb) return ta - tb;
  if (a.tier === "missing") {
    // Most overdue first, then biggest point value.
    return (a.due - b.due) || (b.points - a.points);
  }
  if (a.tier === "done") return (b.due || 0) - (a.due || 0);
  if (a.due && b.due && a.due - b.due !== 0) return a.due - b.due;
  return b.points - a.points;
}

// ---------- Rendering ----------

function render() {
  const now = Date.now();
  items.forEach((i) => (i.tier = tierOf(i, now)));

  const q = $("search").value.trim().toLowerCase();
  const course = $("courseFilter").value;
  const showDone = $("showDone").checked;
  const showMissing = $("showMissing").checked;

  const hiddenCount = items.filter((i) => i.tier === "missing" && hidden.has(i.id)).length;
  $("unhideBtn").textContent = `Unhide ${hiddenCount} hidden`;
  $("unhideBtn").classList.toggle("hidden", !hiddenCount || !showMissing);

  const visible = items
    .filter((i) => i.tier !== "missing" || (showMissing && !hidden.has(i.id)))
    .filter((i) => !course || i.course === course)
    .filter((i) => !q || i.title.toLowerCase().includes(q) || i.course.toLowerCase().includes(q))
    .sort(compare);

  const open = visible.filter((i) => i.tier !== "done");
  $("sMissing").textContent = open.filter((i) => i.tier === "missing").length;
  $("sUrgent").textContent = open.filter((i) => i.tier === "urgent").length;
  $("sWeek").textContent = open.filter((i) => i.tier === "urgent" || i.tier === "soon").length;
  $("sOpen").textContent = open.length;

  $("lists").classList.toggle("hidden", view !== "list");
  $("calendar").classList.toggle("hidden", view !== "calendar");
  if (view === "calendar") renderCalendar(visible, now);
  else renderList(visible, open, now, showDone, course || q);
  $("app").classList.remove("hidden");
}

function renderList(visible, open, now, showDone, filtered) {
  const lists = $("lists");
  lists.innerHTML = "";
  let rank = 0;
  for (const tier of Object.keys(TIERS)) {
    if (tier === "done" && !showDone) continue;
    const group = visible.filter((i) => i.tier === tier);
    if (!group.length) continue;
    const h = document.createElement("h2");
    h.textContent = `${TIERS[tier].label} (${group.length})`;
    lists.appendChild(h);
    const ol = document.createElement("ol");
    for (const item of group) {
      if (tier !== "done") rank++;
      ol.appendChild(renderItem(item, tier === "done" ? "✓" : rank, now));
    }
    lists.appendChild(ol);
  }
  if (!open.length && !(showDone && visible.length)) {
    lists.innerHTML = `<div class="notice">🎉 Nothing to do${filtered ? " matching your filters" : ""}. You're all caught up!</div>`;
  }
}

// ---------- Calendar view ----------

function renderCalendar(visible, now) {
  const showDone = $("showDone").checked;
  const byDay = new Map();
  for (const i of visible) {
    if (!i.due || (i.tier === "done" && !showDone)) continue;
    const k = dayKey(i.due);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(i);
  }

  const cal = $("calendar");
  cal.innerHTML = "";

  const week = calMode === "week";
  const head = el("div", "cal-head");
  const nav = el("div");
  nav.style.cssText = "display:flex; gap:6px; flex-wrap:wrap;";
  const unit = week ? "week" : "month";
  const modes = el("div", "seg");
  modes.append(
    modeButton("Month", "month"),
    modeButton("Week", "week"),
  );
  nav.append(
    modes,
    button("‹", () => shiftCal(-1), `Previous ${unit}`),
    button("Today", () => { calMonth = startOfMonth(new Date()); selectedDay = startOfDay(new Date()); render(); }),
    button("›", () => shiftCal(1), `Next ${unit}`),
  );

  // Week view shows the week containing the selected day; month view shows calMonth.
  const first = week
    ? new Date(selectedDay.getFullYear(), selectedDay.getMonth(), selectedDay.getDate() - selectedDay.getDay())
    : new Date(calMonth.getFullYear(), calMonth.getMonth(), 1 - calMonth.getDay());
  const totalDays = week ? 7 : 42;
  head.append(el("h3", "", week ? weekTitle(first) : calMonth.toLocaleString([], { month: "long", year: "numeric" })), nav);

  const grid = el("div", week ? "cal-grid week" : "cal-grid");
  for (let d = 0; d < 7; d++) {
    grid.append(el("div", "cal-dow", new Date(2023, 0, 1 + d).toLocaleString([], { weekday: "short" })));
  }

  const todayKey = dayKey(new Date(now));
  const selKey = dayKey(selectedDay);
  for (let n = 0; n < totalDays; n++) {
    const day = new Date(first.getFullYear(), first.getMonth(), first.getDate() + n);
    if (!week && n % 7 === 0 && n >= 28 && day.getMonth() !== calMonth.getMonth()) break; // drop empty trailing week
    const k = dayKey(day);
    const due = (byDay.get(k) || []).sort(compare);

    const cell = el("div", "cal-day");
    cell.tabIndex = 0;
    cell.setAttribute("role", "button");
    cell.setAttribute("aria-label", `${day.toDateString()}, ${due.length} due`);
    if (!week && day.getMonth() !== calMonth.getMonth()) cell.classList.add("other");
    if (k === todayKey) cell.classList.add("today");
    if (k === selKey) cell.classList.add("selected");
    cell.append(el("span", "num", week ? day.toLocaleDateString([], { weekday: "short", day: "numeric" }) : day.getDate()));

    // Month view fits 3 per day; week view has room to show everything with due times.
    (week ? due : due.slice(0, 3)).forEach((i) => {
      const a = el("a", `chip t-${i.tier}`, week ? `${fmtTime(i.due)} · ${i.title}` : i.title);
      a.href = i.link;
      a.target = "_blank";
      a.rel = "noopener";
      a.title = `${i.title} · ${i.course}`;
      a.onclick = (e) => e.stopPropagation();
      cell.append(a);
    });
    if (!week && due.length > 3) cell.append(el("span", "more", `+${due.length - 3} more`));
    if (due.length) {
      const dots = el("div", "dots");
      due.forEach((i) => dots.append(el("span", `dot t-${i.tier}`)));
      cell.append(dots);
    }

    const select = () => {
      selectedDay = day;
      calMonth = startOfMonth(day);
      render();
    };
    cell.onclick = select;
    cell.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(); } };
    grid.append(cell);
  }

  // Selected day's assignments, full detail with links
  const dayItems = (byDay.get(selKey) || []).sort(compare);
  const h = el("h2", "", `${selectedDay.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })} (${dayItems.length})`);
  const detail = el("div");
  if (dayItems.length) {
    const ol = el("ol");
    dayItems.forEach((i, idx) => ol.append(renderItem(i, i.tier === "done" ? "✓" : idx + 1, now)));
    detail.append(ol);
  } else {
    detail.append(el("div", "notice", "Nothing due this day."));
  }
  const noDate = visible.filter((i) => i.tier === "nodate").length;
  if (noDate) {
    const note = el("p", "sub", `${noDate} assignment${noDate > 1 ? "s have" : " has"} no due date. See List view.`);
    detail.append(note);
  }

  cal.append(head, grid, h, detail);
}

function shiftCal(delta) {
  if (calMode === "week") {
    selectedDay = new Date(selectedDay.getFullYear(), selectedDay.getMonth(), selectedDay.getDate() + 7 * delta);
    calMonth = startOfMonth(selectedDay);
  } else {
    calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + delta, 1);
  }
  render();
}

function modeButton(text, mode) {
  const b = button(text, () => {
    calMode = mode;
    try { localStorage.setItem("calMode", mode); } catch {}
    // Keep the selected day on screen when switching to week view.
    if (mode === "week" && startOfMonth(selectedDay).getTime() !== calMonth.getTime()) selectedDay = calMonth;
    render();
  });
  if (calMode === mode) b.classList.add("active");
  return b;
}

function weekTitle(start) {
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  const md = { month: "short", day: "numeric" };
  return `${start.toLocaleDateString([], md)} – ${end.toLocaleDateString([], start.getMonth() === end.getMonth() ? { day: "numeric" } : md)}, ${end.getFullYear()}`;
}

function fmtTime(d) {
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function setView(v) {
  view = v;
  try { localStorage.setItem("view", v); } catch {}
  $("listViewBtn").classList.toggle("active", v === "list");
  $("calViewBtn").classList.toggle("active", v === "calendar");
  if (items.length) render();
}

function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function dayKey(d) { return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; }

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function button(text, onclick, label) {
  const b = el("button", "", text);
  b.onclick = onclick;
  if (label) b.setAttribute("aria-label", label);
  return b;
}

function renderItem(item, rank, now) {
  const li = document.createElement("li");
  li.className = `item t-${item.tier}`;

  const r = document.createElement("div");
  r.className = "rank";
  r.textContent = rank;

  const body = document.createElement("div");
  body.className = "body";
  const a = document.createElement("a");
  a.className = "title";
  a.href = item.link;
  a.target = "_blank";
  a.rel = "noopener";
  a.textContent = item.title;

  const meta = document.createElement("div");
  meta.className = "meta";
  const parts = [item.course];
  if (item.due) parts.push("Due " + fmtDate(item.due));
  if (item.points) parts.push(`${item.points} pts`);
  if (item.tier === "done" && item.grade != null) parts.push(`Grade: ${item.grade}/${item.points}`);
  meta.textContent = parts.join(" · ");

  const badge = document.createElement("span");
  badge.className = "badge";
  badge.textContent = badgeText(item, now);

  body.append(a, document.createElement("br"), meta);
  const right = document.createElement("div");
  right.style.cssText = "display:flex; flex-direction:column; align-items:flex-end; gap:6px;";
  const openLink = a.cloneNode(false);
  openLink.className = "open";
  openLink.textContent = "Open ↗";
  right.append(badge, openLink);
  if (item.tier === "missing") {
    const hide = el("button", "hide-btn", "Hide");
    hide.title = "Hide this missing assignment";
    hide.onclick = () => {
      hidden.add(item.id);
      saveHidden();
      render();
    };
    right.append(hide);
  }

  li.append(r, body, right);
  return li;
}

function badgeText(item, now) {
  if (item.tier === "done") return item.state === "RETURNED" ? "Returned" : "Turned in";
  if (item.tier === "nodate") return "No due date";
  const diff = item.due - now;
  if (diff < 0) {
    // Count calendar days, so "due yesterday 11:59pm" reads as 1d late.
    const days = Math.round((startOfDay(new Date(now)) - startOfDay(item.due)) / DAY);
    return days < 1 ? "Missing · today" : `Missing · ${days}d late`;
  }
  if (diff < DAY) return `Due in ${Math.max(1, Math.round(diff / HOUR))}h`;
  return `Due in ${Math.round(diff / DAY)}d`;
}

function fmtDate(d) {
  return d.toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function fillCourseFilter(names) {
  const sel = $("courseFilter");
  const current = sel.value;
  sel.innerHTML = '<option value="">All classes</option>';
  [...new Set(names)].sort().forEach((n) => sel.add(new Option(n, n)));
  sel.value = current;
}

function setStatus(t) { $("status").textContent = t; }
function showMessage(html, isError) {
  const m = $("message");
  m.innerHTML = html;
  m.classList.toggle("error", !!isError);
  m.classList.remove("hidden");
}
function hideMessage() { $("message").classList.add("hidden"); }

// ---------- Demo data (lets you preview without signing in) ----------

function loadDemo() {
  const now = Date.now();
  const d = (days, h = 23, m = 59) => {
    const x = new Date(now + days * DAY);
    x.setHours(h, m, 0, 0);
    return x;
  };
  const link = "https://classroom.google.com/";
  items = [
    { title: "Lab Report: Photosynthesis", course: "Biology", due: d(-3), points: 50, done: false, state: "CREATED", link },
    { title: "Chapter 4 Vocab Quiz", course: "Spanish II", due: d(-1), points: 20, done: false, state: "NEW", link },
    { title: "Essay Draft: The Great Gatsby", course: "English 11", due: d(1, 8, 0), points: 100, done: false, state: "CREATED", link },
    { title: "Problem Set 3.2", course: "Algebra II", due: d(0, 23, 59), points: 10, done: false, state: "NEW", link },
    { title: "Primary Source Analysis", course: "US History", due: d(4), points: 30, done: false, state: "NEW", link },
    { title: "Unit 2 Test Review", course: "Algebra II", due: d(6), points: 15, done: false, state: "NEW", link },
    { title: "Research Project Proposal", course: "English 11", due: d(14), points: 50, done: false, state: "NEW", link },
    { title: "Read Chapters 5–6", course: "English 11", due: null, points: 0, done: false, state: "NEW", link },
    { title: "Cell Diagram", course: "Biology", due: d(-5), points: 25, done: true, state: "RETURNED", grade: 23, link },
    { title: "Weekly Reflection", course: "US History", due: d(-2), points: 10, done: true, state: "TURNED_IN", link },
    { title: "Poetry Unit Packet", course: "English 11", due: d(-400), points: 40, done: false, state: "NEW", link },
  ];
  items.forEach((i, n) => (i.id = "demo:" + n));
  fillCourseFilter(items.map((i) => i.course));
  render();
  setStatus("Demo mode: sample data. Sign in to see your real assignments.");
}

// ---------- Wire up ----------

$("signInBtn").onclick = signIn;
$("refreshBtn").onclick = load;
$("demoBtn").onclick = loadDemo;
$("listViewBtn").onclick = () => setView("list");
$("calViewBtn").onclick = () => setView("calendar");
try { if (localStorage.getItem("view") === "calendar") setView("calendar"); } catch {}
["search", "courseFilter", "showDone"].forEach((id) => $(id).addEventListener("input", render));
$("showMissing").addEventListener("input", () => {
  try { localStorage.setItem("showMissing", $("showMissing").checked ? "1" : "0"); } catch {}
  render();
});
$("unhideBtn").onclick = () => {
  hidden.clear();
  saveHidden();
  render();
};
try { if (localStorage.getItem("showMissing") === "0") $("showMissing").checked = false; } catch {}
// Keep the "due in" countdowns and missing status fresh if the tab stays open.
setInterval(() => items.length && render(), 60e3);
