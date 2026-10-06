// Google Tasks import, and copying study sessions into a "Study Plan" Google Calendar.
// Each asks for its Google permission the first time you use it.
// Uses globals from app.js / manual.js / planner.js only when called.

const TASKS_SCOPE = "https://www.googleapis.com/auth/tasks.readonly";
// Lets the app create its own calendars and manage events on them, and nothing else.
const CAL_WRITE_SCOPE = "https://www.googleapis.com/auth/calendar.app.created";
const TASKS_API = "https://tasks.googleapis.com/tasks/v1/";

// Run fn once signed in with the given extra permission (asks Google only if needed).
function withScope(scope, fn) {
  if (accessToken && tokenScopes.has(scope)) return fn();
  signIn([scope], fn);
}

async function apiSend(method, path, body, base) {
  const res = await fetch(base + path, {
    method,
    headers: { Authorization: "Bearer " + accessToken, ...(body && { "Content-Type": "application/json" }) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    const err = new Error(b.error?.message || res.statusText);
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

// Runs fn over list with a few requests at a time.
async function inBatches(list, fn, size = 5) {
  for (let n = 0; n < list.length; n += size) await Promise.all(list.slice(n, n + size).map(fn));
}

function apiErrorText(e, apiName) {
  if (e.status === 403 || e.status === 401) {
    return `Google didn't allow this: ${e.message}<br><br>Make sure the <b>${apiName}</b> is enabled in your Google Cloud project, and that you allowed the permission when Google asked.`;
  }
  return "Something went wrong: " + e.message;
}

// ---------- Google Tasks ----------

function openTasksImport() {
  withScope(TASKS_SCOPE, showTasksImport);
}

async function tasksAll(path, params = {}) {
  const out = [];
  let pageToken;
  do {
    const data = await api(path, { maxResults: 100, ...params, ...(pageToken && { pageToken }) }, TASKS_API);
    out.push(...(data.items || []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return out;
}

async function showTasksImport() {
  const wrap = el("div", "form");
  wrap.append(el("p", "sub", "Loading your Google Tasks…"));
  openModal("Import from Google Tasks", wrap, { wide: true });

  let tasks;
  try {
    const lists = await tasksAll("users/@me/lists");
    tasks = (await Promise.all(lists.map(async (l) =>
      (await tasksAll(`lists/${encodeURIComponent(l.id)}/tasks`, { showCompleted: false, showHidden: false }))
        .filter((t) => t.title?.trim())
        .map((t) => ({ ...t, listName: l.title }))
    ))).flat();
  } catch (e) {
    wrap.innerHTML = "";
    wrap.append(el("p", "plan-warn"));
    wrap.lastChild.innerHTML = apiErrorText(e, "Google Tasks API");
    return;
  }

  wrap.innerHTML = "";
  if (!tasks.length) {
    wrap.append(el("p", "", "You have no unfinished Google Tasks."));
    return;
  }
  // Google Tasks due dates are dates only; treat them as due at 11:59 PM that day.
  const taskDue = (t) => (t.due ? fromDateTimeInputs(t.due.slice(0, 10), "23:59") : null);
  tasks.sort((a, b) => (taskDue(a) || Infinity) - (taskDue(b) || Infinity));

  const already = new Set(manualItems.map((m) => m.taskId).filter(Boolean));
  wrap.append(el("p", "sub", "Choose tasks to add as assignments. Tasks without a due date are listed but not planned until you give them one."));
  const list = el("div", "task-list");
  const boxes = [];
  for (const t of tasks) {
    const label = el("label", "task-row");
    const box = inputEl("checkbox");
    box.checked = !already.has(t.id);
    box.disabled = already.has(t.id);
    const due = taskDue(t);
    const info = el("span", "task-info");
    info.append(
      el("span", "task-title", t.title),
      el("span", "meta", [t.listName, due ? "Due " + due.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) : "No due date", already.has(t.id) ? "already added" : ""].filter(Boolean).join(" · ")),
    );
    label.append(box, info);
    list.append(label);
    boxes.push([box, t, due]);
  }
  wrap.append(list);

  const actions = el("div", "modal-actions");
  const go = button("Add selected", () => {
    let added = 0;
    for (const [box, t, due] of boxes) {
      if (!box.checked || box.disabled) continue;
      manualItems.push({
        id: "task:" + t.id,
        taskId: t.id,
        title: t.title.trim(),
        course: t.listName === "My Tasks" ? "Google Tasks" : t.listName,
        due: due ? due.toISOString() : null,
        notes: t.notes || "",
      });
      added++;
    }
    saveManual();
    closeModal();
    render();
    if (added) showMessage(`Added ${added} task${added > 1 ? "s" : ""} from Google Tasks. Edit any of them to change the class, due date or time needed.`);
  });
  go.classList.add("primary");
  actions.append(go);
  wrap.append(actions);
}

// ---------- Study sessions → Google Calendar ----------

function studyCalendarId() {
  return loadJSON("studyCalId", null);
}

function calendarSyncButton() {
  const b = button("Sync to Google Calendar", () => withScope(CAL_WRITE_SCOPE, syncToCalendar));
  const last = loadJSON("lastSync", null);
  b.title = "Copies your upcoming study sessions into a 'Study Plan' calendar in Google Calendar, with a reminder 10 minutes before each."
    + (last ? ` Last synced ${fmtDate(new Date(last))}.` : "");
  b.id = "syncBtn";
  return b;
}

async function syncToCalendar() {
  if (!plan || !activePlanBlocks().length) return showMessage("Make a plan first, then sync it to Google Calendar.", true);
  const enc = encodeURIComponent;
  setStatus("Syncing study sessions to Google Calendar…");
  try {
    let calId = studyCalendarId();
    if (calId) {
      try {
        await api(`calendars/${enc(calId)}`, {}, CAL_API);
      } catch (e) {
        if (e.status !== 404 && e.status !== 403) throw e;
        calId = null; // it was deleted; make a new one
      }
    }
    if (!calId) {
      const c = await apiSend("POST", "calendars", {
        summary: "Study Plan",
        description: "Study sessions from Classroom Priorities (classroommanager.site)",
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }, CAL_API);
      calId = c.id;
      saveJSON("studyCalId", calId);
    }

    // Replace all upcoming sessions on that calendar with the current plan.
    const now = new Date();
    const old = await calListAll(`calendars/${enc(calId)}/events`, { timeMin: now.toISOString(), singleEvents: true, maxResults: 2500 });
    await inBatches(old, (e) => apiSend("DELETE", `calendars/${enc(calId)}/events/${enc(e.id)}`, null, CAL_API));

    const blocks = activePlanBlocks().filter((b) => !b.done && b.end > now);
    await inBatches(blocks, (b) => apiSend("POST", `calendars/${enc(calId)}/events`, {
      summary: `📖 ${b.item.title}`,
      description: [b.item.course, b.parts > 1 ? `Part ${b.part} of ${b.parts}` : "", b.item.link || ""].filter(Boolean).join("\n"),
      start: { dateTime: b.start.toISOString() },
      end: { dateTime: b.end.toISOString() },
      reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 10 }] },
      extendedProperties: { private: { app: "classroom-priorities", blockId: b.id } },
    }, CAL_API));

    saveJSON("lastSync", Date.now());
    setStatus(`Synced ${fmtDate(new Date())}`);
    showMessage(`Added ${blocks.length} study session${blocks.length === 1 ? "" : "s"} to your <b>Study Plan</b> Google Calendar, each with a reminder 10 minutes before. Sync again after you update your plan.`);
    render();
  } catch (e) {
    setStatus("");
    showMessage(apiErrorText(e, "Google Calendar API"), true);
  }
}
