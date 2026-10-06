// Classroom Priorities: pulls your Google Classroom assignments + your submissions,
// figures out what's missing / due soon, and ranks everything into one list.

const SCOPES = [
  "https://www.googleapis.com/auth/classroom.courses.readonly",
  "https://www.googleapis.com/auth/classroom.coursework.me.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
].join(" ");
const API = "https://classroom.googleapis.com/v1/";
const CAL_API = "https://www.googleapis.com/calendar/v3/";
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
let tokenScopes = new Set(); // permissions the current sign-in has
let afterSignIn = null;      // what to do after signing in (default: load everything)
// sourceItems: from Classroom (or demo). items: sourceItems + your own assignments,
// rebuilt on every render.
let sourceItems = [];
let items = [];
let view = "list";
// Assignments the user removed, remembered in this browser. (Stored under "hidden"
// so items hidden with the older Hide button stay removed.)
const removed = new Set((() => { try { return JSON.parse(localStorage.getItem("hidden")) || []; } catch { return []; } })());
function saveRemoved() { try { localStorage.setItem("hidden", JSON.stringify([...removed])); } catch {} }
let calMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let selectedDay = new Date(new Date().setHours(0, 0, 0, 0));
// Google Calendars: the user's calendar list, which ones they chose to show, and their events.
let calendars = []; // { id, name, color }
let events = [];    // { calId, title, start, end, allDay, link }
const shownCals = new Set((() => { try { return JSON.parse(localStorage.getItem("shownCals")) || []; } catch { return []; } })());
function saveShownCals() { try { localStorage.setItem("shownCals", JSON.stringify([...shownCals])); } catch {} }
let calPanelOpen = false;
let calMode = (() => { try { return localStorage.getItem("calMode") === "week" ? "week" : "month"; } catch { return "month"; } })();

// ---------- Google sign-in ----------

// extraScopes: more permissions to ask for (Google Tasks, writing to Calendar).
// after: run this instead of reloading once signed in.
function signIn(extraScopes = [], after = null) {
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
      tokenScopes = new Set((resp.scope || "").split(" "));
      saveToken(resp.access_token, resp.expires_in, [...tokenScopes]);
      showSignedInButtons();
      const next = afterSignIn;
      afterSignIn = null;
      if (next) next();
      else load();
    },
  });
  afterSignIn = after;
  tokenClient.requestAccessToken({ scope: [SCOPES, ...extraScopes].join(" ") });
}

function showSignedInButtons() {
  $("signInBtn").classList.add("hidden");
  $("demoBtn").classList.add("hidden");
  $("refreshBtn").classList.remove("hidden");
  $("signOutBtn").classList.remove("hidden");
}

function signOut() {
  if (accessToken && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(accessToken, () => {});
  try {
    sessionStorage.removeItem("token");
    localStorage.removeItem("cache");
  } catch {}
  location.reload();
}

// Google access tokens last ~1 hour. Keeping it in sessionStorage means a page refresh
// stays signed in, but closing the tab signs you out.
function saveToken(token, expiresIn, scopes) {
  try { sessionStorage.setItem("token", JSON.stringify({ token, scopes, exp: Date.now() + (expiresIn - 60) * 1000 })); } catch {}
}
function restoreToken() {
  try {
    const t = JSON.parse(sessionStorage.getItem("token"));
    if (t && t.exp > Date.now()) {
      tokenScopes = new Set(t.scopes || []);
      return t.token;
    }
  } catch {}
  return null;
}

async function api(path, params = {}, base = API) {
  const url = new URL(base + path);
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

    setSource(perCourse.flat());

    let calError = null;
    try {
      await loadCalendars();
    } catch (e) {
      calError = e;
    }

    render();
    saveCache();
    setStatus(`Updated ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · ${courses.length} classes · ${sourceItems.length} assignments`);
    const problems = [];
    if (skipped.length) problems.push("Couldn't read assignments from: " + skipped.join(", "));
    if (calError) problems.push(calendarErrorText(calError));
    if (problems.length) showMessage(problems.join("<br><br>"));
  } catch (e) {
    if (e.status === 401) {
      accessToken = null;
      try { sessionStorage.removeItem("token"); } catch {}
      showMessage("Your sign-in expired. Click Refresh to sign in again.", true);
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

// ---------- Google Calendar ----------

async function calListAll(path, params = {}) {
  const out = [];
  let pageToken;
  do {
    const data = await api(path, { ...params, ...(pageToken && { pageToken }) }, CAL_API);
    out.push(...(data.items || []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return out;
}

async function loadCalendars() {
  const list = await calListAll("users/me/calendarList");
  calendars = list
    .filter((c) => c.id !== studyCalendarId()) // the app's own Study Plan calendar is shown as study blocks already
    .map((c) => ({ id: c.id, name: c.summaryOverride || c.summary, color: c.backgroundColor || "#888", primary: !!c.primary }))
    .sort((a, b) => (b.primary - a.primary) || a.name.localeCompare(b.name));
  const ids = calendars.filter((c) => shownCals.has(c.id)).map((c) => c.id);
  events = (await Promise.all(ids.map(fetchEvents))).flat();
}

// Loads events from 2 months back to 6 months ahead.
async function fetchEvents(calId) {
  const now = new Date();
  const list = await calListAll(`calendars/${encodeURIComponent(calId)}/events`, {
    timeMin: new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString(),
    timeMax: new Date(now.getFullYear(), now.getMonth() + 7, 1).toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 2500,
  });
  return list.filter((e) => e.status !== "cancelled" && e.start).map((e) => {
    const allDay = !!e.start.date;
    return {
      calId,
      title: e.summary || "(busy)",
      start: allDay ? parseLocalDate(e.start.date) : new Date(e.start.dateTime),
      end: allDay ? parseLocalDate(e.end.date) : new Date(e.end?.dateTime || e.start.dateTime),
      allDay,
      link: e.htmlLink,
    };
  });
}

// All-day events use plain dates ("2026-10-05") that must stay in local time.
function parseLocalDate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

async function toggleCalendar(id, on) {
  if (on) shownCals.add(id);
  else shownCals.delete(id);
  saveShownCals();
  if (on && !events.some((e) => e.calId === id)) {
    if (!accessToken) {
      render();
      return signIn(); // signing in reloads everything, including this calendar
    }
    try {
      events.push(...await fetchEvents(id));
      saveCache();
    } catch (e) {
      showMessage(calendarErrorText(e), true);
    }
  }
  render();
}

function calendarErrorText(e) {
  if (e.status === 403) {
    return "Couldn't load your Google Calendars. Make sure the <b>Google Calendar API</b> is enabled in your Google Cloud project, and that you allowed calendar access when signing in. (" + e.message + ")";
  }
  return "Couldn't load your Google Calendars: " + e.message;
}

// Events grouped by local day. Multi-day events appear on every day they cover.
function eventsByDay() {
  const map = new Map();
  for (const e of events) {
    if (!shownCals.has(e.calId)) continue;
    let day = startOfDay(e.start);
    // End is exclusive; a timed event ending exactly at midnight doesn't spill into the next day.
    const last = e.end > e.start ? new Date(e.end - 1) : e.start;
    for (let n = 0; day <= last && n < 62; n++) {
      const k = dayKey(day);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(e);
      day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
    }
  }
  for (const list of map.values()) list.sort((a, b) => (b.allDay - a.allDay) || (a.start - b.start));
  return map;
}

function calColor(id) {
  return calendars.find((c) => c.id === id)?.color || "#888";
}

function eventTime(e) {
  return e.allDay ? "All day" : fmtTime(e.start);
}

// ---------- Saving between visits ----------

function saveCache() {
  try {
    localStorage.setItem("cache", JSON.stringify({ at: Date.now(), items: sourceItems, calendars, events }));
  } catch {}
}

function restoreCache() {
  try {
    const c = JSON.parse(localStorage.getItem("cache"));
    if (!c) return null;
    setSource(c.items.map((i) => ({ ...i, due: i.due ? new Date(i.due) : null })));
    calendars = c.calendars || [];
    events = (c.events || []).map((e) => ({ ...e, start: new Date(e.start), end: new Date(e.end) }));
    return new Date(c.at);
  } catch {
    return null;
  }
}

const PREFS = ["showMissing", "showDone", "showRemoved", "courseFilter"];
function savePrefs() {
  const p = {};
  for (const id of PREFS) p[id] = $(id).type === "checkbox" ? $(id).checked : $(id).value;
  try { localStorage.setItem("prefs", JSON.stringify(p)); } catch {}
}
function restorePrefs() {
  let p = {};
  try { p = JSON.parse(localStorage.getItem("prefs")) || {}; } catch {}
  for (const id of PREFS) {
    if (!(id in p)) continue;
    if ($(id).type === "checkbox") $(id).checked = p[id];
    else if ([...$(id).options].some((o) => o.value === p[id])) $(id).value = p[id];
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
    turnedIn: done,
    state,
    grade: sub?.assignedGrade,
    // Prefer the submission link (opens your own work page); fall back to the assignment.
    link: sub?.alternateLink || w.alternateLink || course.alternateLink,
  };
}

function setSource(list) {
  list.forEach((i) => (i.turnedIn ??= i.done)); // older saved data has only "done"
  sourceItems = list;
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
  if (a.tier === "done") return (b.due || 0) - (a.due || 0);
  // Your priority comes first within each group.
  const pa = PRIORITY[a.priority || "normal"].rank, pb = PRIORITY[b.priority || "normal"].rank;
  if (pa !== pb) return pa - pb;
  if (a.tier === "missing") {
    // Most overdue first, then biggest point value.
    return (a.due - b.due) || (b.points - a.points);
  }
  if (a.due && b.due && a.due - b.due !== 0) return a.due - b.due;
  return b.points - a.points;
}

// ---------- Rendering ----------

function render() {
  const now = Date.now();
  items = [...sourceItems, ...manualAsItems()];
  for (const i of items) {
    i.markedDone = !i.turnedIn && completed.has(i.id);
    i.done = i.turnedIn || i.markedDone;
    i.priority = priorityOf(i);
    i.tier = tierOf(i, now);
  }
  fillCourseFilter(items.map((i) => i.course));

  const q = $("search").value.trim().toLowerCase();
  const course = $("courseFilter").value;
  const showDone = $("showDone").checked;
  const showMissing = $("showMissing").checked;
  const showRemoved = $("showRemoved").checked;

  items.forEach((i) => (i.removed = removed.has(i.id)));
  const removedCount = items.filter((i) => i.removed).length;
  $("removedCount").textContent = removedCount ? ` (${removedCount})` : "";

  const visible = items
    .filter((i) => !i.removed || showRemoved)
    .filter((i) => i.tier !== "missing" || showMissing)
    .filter((i) => !course || i.course === course)
    .filter((i) => !q || i.title.toLowerCase().includes(q) || i.course.toLowerCase().includes(q))
    .sort(compare);

  // Removed items never count toward the totals, even while shown.
  const open = visible.filter((i) => i.tier !== "done" && !i.removed);
  $("sMissing").textContent = open.filter((i) => i.tier === "missing").length;
  $("sUrgent").textContent = open.filter((i) => i.tier === "urgent").length;
  $("sWeek").textContent = open.filter((i) => i.tier === "urgent" || i.tier === "soon").length;
  $("sOpen").textContent = open.length;

  renderPlanBar(now);
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
      if (tier !== "done" && !item.removed) rank++;
      ol.appendChild(renderItem(item, tier === "done" ? "✓" : item.removed ? "–" : rank, now));
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
  const evByDay = eventsByDay();
  const planByDay = planBlocksByDay();

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
  const calsBtn = button(`Calendars${shownCals.size ? ` (${calendars.filter((c) => shownCals.has(c.id)).length})` : ""} ▾`, () => {
    calPanelOpen = !calPanelOpen;
    render();
  });
  if (calPanelOpen) calsBtn.classList.add("active-outline");
  nav.append(calsBtn);

  // Week view shows the week containing the selected day; month view shows calMonth.
  const first = week
    ? new Date(selectedDay.getFullYear(), selectedDay.getMonth(), selectedDay.getDate() - selectedDay.getDay())
    : new Date(calMonth.getFullYear(), calMonth.getMonth(), 1 - calMonth.getDay());
  const totalDays = week ? 7 : 42;
  head.append(el("h3", "", week ? weekTitle(first) : calMonth.toLocaleString([], { month: "long", year: "numeric" })), nav);

  const panel = calPanelOpen ? renderCalPanel() : null;

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
    const evs = evByDay.get(k) || [];
    const study = planByDay.get(k) || [];

    const cell = el("div", "cal-day");
    cell.tabIndex = 0;
    cell.setAttribute("role", "button");
    cell.setAttribute("aria-label", `${day.toDateString()}, ${due.length} due, ${evs.length} events`);
    if (!week && day.getMonth() !== calMonth.getMonth()) cell.classList.add("other");
    if (k === todayKey) cell.classList.add("today");
    if (k === selKey) cell.classList.add("selected");
    cell.append(el("span", "num", week ? day.toLocaleDateString([], { weekday: "short", day: "numeric" }) : day.getDate()));

    // Assignments first, then calendar events. Month view fits 3 per day;
    // week view has room to show everything with times.
    const chips = [
      ...due.map((i) => {
        const a = el("a", `chip t-${i.tier}${i.removed ? " removed" : ""}`, week ? `${fmtTime(i.due)} · ${i.title}` : i.title);
        if (i.link) a.href = i.link;
        a.title = `${i.title} · ${i.course}`;
        return a;
      }),
      ...study.map((b) => {
        const a = el("a", `chip plan${b.soft ? " soft" : ""}`, week ? `${blockLabel(b)} · 📖 ${b.item.title}` : `📖 ${b.item.title}`);
        if (b.item.link) a.href = b.item.link;
        a.title = `Study: ${b.item.title} · ${blockLabel(b)}`;
        return a;
      }),
      ...evs.map((e) => {
        const a = el("a", "chip ev", week ? `${eventTime(e)} · ${e.title}` : e.title);
        a.href = e.link;
        a.title = `${e.title} · ${eventTime(e)}`;
        a.style.setProperty("--ev", calColor(e.calId));
        return a;
      }),
    ];
    (week ? chips : chips.slice(0, 3)).forEach((a) => {
      // Items without a link (your own assignments) just select the day.
      if (a.getAttribute("href")) {
        a.target = "_blank";
        a.rel = "noopener";
        a.onclick = (e) => e.stopPropagation();
      }
      cell.append(a);
    });
    if (!week && chips.length > 3) cell.append(el("span", "more", `+${chips.length - 3} more`));
    if (chips.length) {
      const dots = el("div", "dots");
      due.forEach((i) => dots.append(el("span", `dot t-${i.tier}`)));
      study.forEach(() => dots.append(el("span", "dot plan")));
      evs.forEach((e) => {
        const d = el("span", "dot ev");
        d.style.setProperty("--ev", calColor(e.calId));
        dots.append(d);
      });
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
  const dayEvents = evByDay.get(selKey) || [];
  const h = el("h2", "", `${selectedDay.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })} (${dayItems.length})`);
  const detail = el("div");
  if (dayItems.length) {
    const ol = el("ol");
    dayItems.forEach((i, idx) => ol.append(renderItem(i, i.tier === "done" ? "✓" : idx + 1, now)));
    detail.append(ol);
  } else {
    detail.append(el("div", "notice", "Nothing due this day."));
  }
  const dayStudy = planByDay.get(selKey) || [];
  if (dayStudy.length) {
    detail.append(el("h2", "", `Study plan (${dayStudy.length})`));
    const ol = el("ol");
    dayStudy.forEach((b) => ol.append(renderPlanRow(b, now)));
    detail.append(ol);
  }
  if (dayEvents.length) {
    detail.append(el("h2", "", `Events (${dayEvents.length})`));
    const ol = el("ol");
    for (const e of dayEvents) {
      const li = el("li", "item ev-item");
      li.style.setProperty("--ev", calColor(e.calId));
      const body = el("div", "body");
      const a = el("a", "title", e.title);
      a.href = e.link;
      a.target = "_blank";
      a.rel = "noopener";
      const cal = calendars.find((c) => c.id === e.calId);
      body.append(a, el("div", "meta", `${eventTime(e)}${cal ? " · " + cal.name : ""}`));
      li.append(body);
      ol.append(li);
    }
    detail.append(ol);
  }
  const noDate = visible.filter((i) => i.tier === "nodate").length;
  if (noDate) {
    const note = el("p", "sub", `${noDate} assignment${noDate > 1 ? "s have" : " has"} no due date. See List view.`);
    detail.append(note);
  }

  cal.append(...[head, panel, grid, h, detail].filter(Boolean));
}

function renderCalPanel() {
  const panel = el("div", "cal-panel");
  if (!calendars.length) {
    panel.append(el("p", "", accessToken
      ? "No Google Calendars found yet. Click Refresh to load them."
      : "Sign in (click Refresh) to choose which Google Calendars to show."));
    return panel;
  }
  panel.append(el("p", "sub", "Show events from these Google Calendars:"));
  for (const c of calendars) {
    const label = el("label", "cal-option");
    const box = el("input");
    box.type = "checkbox";
    box.checked = shownCals.has(c.id);
    box.onchange = () => toggleCalendar(c.id, box.checked);
    const swatch = el("span", "swatch");
    swatch.style.background = c.color;
    label.append(box, swatch, el("span", "", c.name));
    panel.append(label);
  }
  panel.append(el("p", "sub", "To add a subscription by link (.ics), add it in Google Calendar under Other calendars → + → From URL, then click Refresh here."));
  return panel;
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
  if (hasData()) render();
}

function hasData() {
  return sourceItems.length > 0 || manualItems.length > 0;
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
  li.className = `item t-${item.tier}${item.removed ? " removed" : ""}`;

  const r = document.createElement("div");
  r.className = "rank";
  r.textContent = rank;

  const body = document.createElement("div");
  body.className = "body";
  const a = el(item.link ? "a" : "span", "title", item.title);
  if (item.link) {
    a.href = item.link;
    a.target = "_blank";
    a.rel = "noopener";
  }

  const meta = document.createElement("div");
  meta.className = "meta";
  const parts = [item.course];
  if (item.priority === "high") parts.unshift("🔴 High priority");
  if (item.due) parts.push("Due " + fmtDate(item.due));
  if (item.points) parts.push(`${item.points} pts`);
  if (item.tier === "done" && item.grade != null) parts.push(`Grade: ${item.grade}/${item.points}`);
  if (item.fromTask) parts.push("from Google Tasks");
  meta.textContent = parts.join(" · ");

  const badge = document.createElement("span");
  badge.className = "badge";
  badge.textContent = badgeText(item, now);

  body.append(a, document.createElement("br"), meta);
  if (item.notes) body.append(el("div", "notes", item.notes));
  if (!item.done) {
    const pickers = el("div", "pickers");
    pickers.append(estimatePicker(item), priorityPicker(item));
    body.append(pickers);
  }
  const right = document.createElement("div");
  right.className = "item-actions";
  right.append(badge);
  if (item.link) {
    const openLink = a.cloneNode(false);
    openLink.className = "open";
    openLink.textContent = "Open ↗";
    right.append(openLink);
  }
  if (!item.turnedIn) {
    const doneBtn = el("button", "hide-btn done-btn", item.markedDone ? "Undo done" : "✓ Done");
    doneBtn.title = item.manual ? "Mark this finished" : "Mark finished in this app (doesn't turn it in on Classroom)";
    doneBtn.onclick = () => toggleCompleted(item);
    right.append(doneBtn);
  }
  if (item.manual) {
    right.append(button("Edit", () => openAssignmentForm(item)));
    right.lastChild.className = "hide-btn";
  }
  const toggle = el("button", "hide-btn", item.removed ? "Restore" : "Remove");
  toggle.title = item.removed ? "Put this back in your list" : "Remove from your list (turn on Show removed to see it again)";
  toggle.onclick = () => {
    if (item.removed) removed.delete(item.id);
    else removed.add(item.id);
    saveRemoved();
    render();
  };
  right.append(toggle);

  li.append(r, body, right);
  return li;
}

// "⏱ 45 min" dropdown; changing it is remembered and used by the planner.
function estimatePicker(item) {
  const wrap = el("label", "est");
  wrap.title = "How long you think this will take. Used by Make my plan.";
  const sel = el("select");
  const current = estimateOf(item);
  [...new Set([...ESTIMATE_CHOICES, current])].sort((a, b) => a - b)
    .forEach((m) => sel.add(new Option(fmtMinutes(m), m)));
  sel.value = current;
  sel.onchange = () => {
    estimates[item.id] = Number(sel.value);
    saveEstimates();
    render();
  };
  wrap.append("⏱ ", sel);
  if (!(item.id in estimates)) wrap.append(el("span", "guess", " (guess)"));
  return wrap;
}

function badgeText(item, now) {
  if (item.tier === "done") return item.markedDone ? "Done" : item.state === "RETURNED" ? "Returned" : "Turned in";
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
  const demo = [
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
  demo.forEach((i, n) => (i.id = "demo:" + n));
  setSource(demo);
  render();
  setStatus("Demo mode: sample data. Sign in to see your real assignments.");
}

// ---------- Wire up ----------

$("signInBtn").onclick = () => signIn();
$("refreshBtn").onclick = () => (accessToken ? load() : signIn());
$("signOutBtn").onclick = signOut;
$("demoBtn").onclick = loadDemo;
$("addBtn").onclick = () => openAssignmentForm();
$("notifyBtn").onclick = toggleNotifications;
updateNotifyButton();
$("listViewBtn").onclick = () => setView("list");
$("calViewBtn").onclick = () => setView("calendar");
try { if (localStorage.getItem("view") === "calendar") setView("calendar"); } catch {}
$("search").addEventListener("input", render);
PREFS.forEach((id) => $(id).addEventListener("input", () => { savePrefs(); render(); }));
try { if (localStorage.getItem("showMissing") === "0") $("showMissing").checked = false; } catch {} // older setting

// On page load: show saved data right away, and stay signed in if the token is still valid.
const savedAt = restoreCache();
restorePrefs();
accessToken = restoreToken();
if (savedAt) {
  showSignedInButtons();
  render();
  setStatus(`Showing saved data from ${fmtDate(savedAt)}. Click Refresh for the latest.`);
}
if (!savedAt && manualItems.length) render();
if (accessToken) {
  showSignedInButtons();
  load();
}
// Makes the site installable as an app and able to open offline.
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

// Keep the "due in" countdowns and missing status fresh if the tab stays open.
setInterval(() => {
  if (!hasData()) return;
  render();
  checkReminders();
}, 60e3);
setTimeout(checkReminders, 3000);
