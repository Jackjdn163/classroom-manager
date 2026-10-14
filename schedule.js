// Your class schedule (periods, lunch, bus, A/B rotation) and the Week view's
// hour-by-hour grid. Uses globals from the other scripts only when called.

// Starts from the old HomeworkPlanner's day and the B Day in your screenshot
// (Tuesday, Oct 13, 2026). A Day classes are blank until you fill them in.
const SCHEDULE_DEFAULTS = {
  show: true,
  rotation: "ab", // "ab": A/B alternate each school day · "same": same classes every day
  anchor: { date: "2026-10-13", letter: "B" },
  periods: [
    { label: "Period 1", start: "08:00", end: "09:23", A: "", B: "Spanish" },
    { label: "Period 2", start: "09:23", end: "11:00", A: "", B: "History" },
    { label: "Period 3", start: "12:00", end: "13:23", A: "", B: "Math" },
    { label: "Period 4", start: "13:23", end: "14:50", A: "", B: "Theatre" },
  ],
  extras: [
    { label: "Lunch / Flex", start: "11:00", end: "12:00" },
    { label: "Bus ride", start: "14:50", end: "15:30" },
  ],
};
let classSchedule = loadJSON("classSchedule", null) || JSON.parse(JSON.stringify(SCHEDULE_DEFAULTS));
function saveSchedule() { saveJSON("classSchedule", classSchedule); }

const toMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
const minLabel = (min) => fmtTime(new Date(2023, 0, 1, Math.floor(min / 60), min % 60));

// "A" or "B" for a school day (counting only school days from your known day), else null.
function abLetter(day) {
  if (classSchedule.rotation !== "ab" || !isSchoolDay(day)) return null;
  const anchor = startOfDay(new Date(classSchedule.anchor.date + "T12:00"));
  const target = startOfDay(day);
  const step = target >= anchor ? 1 : -1;
  let n = 0;
  for (let d = anchor; +d !== +target; ) {
    d = addDays(d, step);
    if (isSchoolDay(d)) n++;
  }
  const other = classSchedule.anchor.letter === "A" ? "B" : "A";
  return n % 2 ? other : classSchedule.anchor.letter;
}

// Class periods plus lunch / bus for a day, as grid entries.
function classEntries(day) {
  if (!classSchedule.show || !isSchoolDay(day)) return [];
  const letter = abLetter(day) || "A";
  const out = [];
  for (const p of classSchedule.periods) {
    const name = (classSchedule.rotation === "ab" ? p[letter] : p.A)?.trim();
    if (!name || !p.start || !p.end) continue;
    out.push({ kind: "class", title: name, sub: `${p.label} · ${minLabel(toMin(p.start))}–${minLabel(toMin(p.end))}`,
      startMin: toMin(p.start), endMin: toMin(p.end), color: classColor(name) });
  }
  for (const x of classSchedule.extras) {
    if (!x.start || !x.end) continue;
    out.push({ kind: "flex", title: x.label, sub: `${minLabel(toMin(x.start))}–${minLabel(toMin(x.end))}`,
      startMin: toMin(x.start), endMin: toMin(x.end) });
  }
  return out;
}

function scheduleClassNames() {
  return [...new Set(classSchedule.periods.flatMap((p) => [p.A, p.B]).map((s) => (s || "").trim()).filter(Boolean))];
}

// ---------- Week grid ----------

// Zoom: pixels per hour in the Week view. − / + buttons, or pinch / ⌘-scroll on the grid.
const ZOOM_LEVELS = [40, 56, 72, 96, 120, 150, 190];
let HOUR_PX = (() => { try { const v = Number(localStorage.getItem("weekZoom")); return ZOOM_LEVELS.includes(v) ? v : 96; } catch { return 96; } })();

// dir: +1 zoom in, -1 zoom out. Keeps the time at anchorY (px from the top of the grid) in place.
function zoomWeek(dir, anchorY) {
  const i = ZOOM_LEVELS.indexOf(HOUR_PX);
  const next = ZOOM_LEVELS[Math.max(0, Math.min(ZOOM_LEVELS.length - 1, (i < 0 ? 3 : i) + dir))];
  if (next === HOUR_PX) return;
  const sc = document.querySelector(".wk-scroll");
  if (sc) {
    const a = anchorY ?? sc.clientHeight / 2;
    weekScroll = { top: Math.max(0, ((sc.scrollTop + a) * next) / HOUR_PX - a), left: sc.scrollLeft };
  }
  HOUR_PX = next;
  try { localStorage.setItem("weekZoom", String(next)); } catch {}
  render();
}

function zoomControls() {
  const seg = el("div", "seg zoom");
  seg.setAttribute("role", "group");
  seg.setAttribute("aria-label", "Zoom the week");
  const out = button("−", () => zoomWeek(-1), "Zoom out (less space between hours)");
  const inn = button("+", () => zoomWeek(1), "Zoom in (more space between hours)");
  out.title = "Zoom out · or pinch / ⌘-scroll on the grid";
  inn.title = "Zoom in · or pinch / ⌘-scroll on the grid";
  out.disabled = HOUR_PX === ZOOM_LEVELS[0];
  inn.disabled = HOUR_PX === ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
  seg.append(out, inn);
  return seg;
}
let weekScroll = null; // keeps your scroll position when the page refreshes itself

function renderWeekGrid(first, { byDay, evByDay, planByDay, busyByDay, now }) {
  const days = [...Array(7)].map((_, n) => addDays(first, n));
  const minsOf = (d, day) => Math.round((d - day) / 60e3);
  const perDay = days.map((day) => {
    const k = dayKey(day);
    const list = classEntries(day);
    const clip = (s, e) => [Math.max(0, minsOf(s, day)), Math.min(24 * 60, minsOf(e, day))];
    for (const b of busyByDay.get(k) || []) {
      const [s, e] = clip(b.start, b.end);
      list.push({ kind: "busy", title: b.title, sub: `${fmtTime(b.start)}–${fmtTime(b.end)}`, startMin: s, endMin: e });
    }
    for (const ev of (evByDay.get(k) || []).filter((x) => !x.allDay)) {
      const [s, e] = clip(ev.start, ev.end);
      list.push({ kind: "event", title: ev.title, sub: `${fmtTime(ev.start)}–${fmtTime(ev.end)}`, startMin: s, endMin: Math.max(e, s + 15),
        color: calColor(ev.calId), href: ev.link });
    }
    for (const b of planByDay.get(k) || []) {
      list.push({ kind: `study${b.soft ? " soft" : ""}${b.done ? " done" : ""}`, title: `📖 ${b.item.title}`,
        sub: `${blockLabel(b)}${b.parts > 1 ? ` · part ${b.part}/${b.parts}` : ""}`, startMin: minsOf(b.start, day), endMin: minsOf(b.end, day),
        color: classColor(b.item.course), onClick: () => openBlockEditor(b) });
    }
    // Due work goes inside that class's block when the class meets that day;
    // otherwise it gets its own marker at the due time.
    const classes = list.filter((e) => e.kind === "class");
    for (const i of byDay.get(k) || []) {
      const block = classes.find((c) => sameClass(c.title, i.course));
      if (block) {
        (block.notes ||= []).push(i);
        continue;
      }
      const m = minsOf(i.due, day);
      list.push({ kind: `due t-${i.tier}`, title: `⚑ Due ${fmtTime(i.due)} · ${i.title}`, sub: "", startMin: Math.max(0, m - 30), endMin: Math.max(30, m),
        href: i.link, onClick: !i.link && i.manual ? () => openAssignmentForm(i) : null });
    }
    const allDay = (evByDay.get(k) || []).filter((x) => x.allDay);
    return { day, k, list, allDay };
  });

  // Hours shown: from the earliest thing (no later than 7 AM) to bedtime or the latest thing.
  let minH = 7, maxH = Math.ceil((PLAN.bedtime[0] * 60 + PLAN.bedtime[1] + PLAN.softLimitMin) / 60);
  for (const { list } of perDay) for (const e of list) {
    minH = Math.min(minH, Math.floor(e.startMin / 60));
    maxH = Math.max(maxH, Math.ceil(e.endMin / 60));
  }
  minH = Math.max(0, minH);
  maxH = Math.min(24, Math.max(maxH, minH + 8));
  const height = (maxH - minH) * HOUR_PX;
  const y = (min) => ((min - minH * 60) / 60) * HOUR_PX;

  const scroller = el("div", "wk-scroll");
  const grid = el("div", "wk-grid");
  grid.style.setProperty("--hour", HOUR_PX + "px");

  // Header row
  grid.append(el("div", "wk-corner"));
  const todayKey = dayKey(new Date(now));
  for (const { day, k, allDay } of perDay) {
    const h = el("button", `wk-head${k === todayKey ? " today" : ""}${k === dayKey(selectedDay) ? " selected" : ""}`);
    h.type = "button";
    h.onclick = () => { selectedDay = day; render(); };
    h.append(el("span", "wk-dow", day.toLocaleDateString([], { weekday: "long" })), el("span", "wk-date", day.toLocaleDateString([], { month: "long", day: "numeric" })));
    const letter = classSchedule.show && abLetter(day);
    if (letter) h.append(el("span", "wk-ab", `${letter} Day`));
    else if (!isSchoolDay(day)) h.append(el("span", "wk-ab off", "No school"));
    for (const ev of allDay.slice(0, 2)) {
      const c = el("span", "wk-allday", ev.title);
      c.style.setProperty("--ev", calColor(ev.calId));
      h.append(c);
    }
    grid.append(h);
  }

  // Hour labels
  const gutter = el("div", "wk-gutter");
  gutter.style.height = height + "px";
  for (let hr = minH; hr < maxH; hr++) {
    const lab = el("span", "wk-hour", fmtTime(new Date(2023, 0, 1, hr)).replace(":00", ""));
    lab.style.top = y(hr * 60) + "px";
    gutter.append(lab);
  }
  grid.append(gutter);

  // Day columns
  for (const { k, list } of perDay) {
    const col = el("div", `wk-col${k === todayKey ? " today" : ""}`);
    col.style.height = height + "px";
    for (const e of layoutLanes(list)) {
      const node = el(e.href ? "a" : "div", `wk-ev ${e.kind}`);
      if (e.href) { node.href = e.href; node.target = "_blank"; node.rel = "noopener"; }
      if (e.onClick) { node.onclick = (ev) => { ev.preventDefault(); e.onClick(); }; node.classList.add("clickable"); }
      if (e.color) node.style.setProperty("--c", e.color);
      const h = Math.max(22, y(e.endMin) - y(e.startMin) - 2);
      node.style.top = y(e.startMin) + "px";
      node.style.height = h + "px";
      if (h < 46) node.classList.add("compact"); // short: one line, time after the title
      node.style.left = `calc(${(e.lane / e.lanes) * 100}% + 3px)`;
      node.style.width = `calc(${100 / e.lanes}% - 6px)`;
      node.title = `${e.title} · ${e.sub}`;
      const t = el("span", "wk-title", e.title);
      if (e.sub) t.append(el("span", "wk-inline", " · " + e.sub.split(" · ")[0]));
      node.append(t);
      if (e.sub) node.append(el("span", "wk-sub", e.sub));
      if (e.notes) addDueNotes(node, e.notes, h);
      col.append(node);
    }
    if (k === todayKey) {
      const n = new Date(now);
      const m = n.getHours() * 60 + n.getMinutes();
      if (m >= minH * 60 && m <= maxH * 60) {
        const line = el("div", "wk-now");
        line.style.top = y(m) + "px";
        col.append(line);
      }
    }
    grid.append(col);
  }

  scroller.append(grid);
  scroller.onscroll = () => (weekScroll = { top: scroller.scrollTop, left: scroller.scrollLeft });
  // Pinch on a trackpad (sent as ctrl + wheel) or ⌘/Ctrl + scroll zooms the hours.
  let wheel = 0;
  scroller.addEventListener("wheel", (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    wheel += e.deltaY;
    if (Math.abs(wheel) < 40) return;
    const anchor = e.clientY - scroller.getBoundingClientRect().top;
    zoomWeek(wheel < 0 ? 1 : -1, anchor);
    wheel = 0;
  }, { passive: false });
  // Restore scroll, or start an hour before now (this week) / at the first class.
  setTimeout(() => {
    if (weekScroll) {
      scroller.scrollTop = weekScroll.top;
      scroller.scrollLeft = weekScroll.left;
    } else {
      const n = new Date(now);
      const inWeek = perDay.some((p) => p.k === todayKey);
      scroller.scrollTop = inWeek ? Math.max(0, y(n.getHours() * 60 - 60) - 14) : 0; // leave room for the hour label
    }
  });
  return scroller;
}

// True when a schedule class name and a Classroom course name are the same class
// ("Math" ~ "Math 3 Honors", "Spanish" ~ "Spanish II"), matching whole words only.
function sameClass(className, course) {
  const norm = (x) => " " + String(x || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() + " ";
  const a = norm(className), b = norm(course);
  if (!a.trim() || !b.trim()) return false;
  if (a.includes(b) || b.includes(a)) return true;
  const skip = new Set(["period", "class", "honors", "advanced", "intro", "the", "and"]);
  const words = (x) => x.trim().split(" ").filter((w) => w.length >= 4 && !skip.has(w));
  const bw = new Set(words(b));
  return words(a).some((w) => bw.has(w));
}

// "⚑ Due 11:59 PM · Problem Set" notes inside a class block, linking to each assignment.
function addDueNotes(node, notes, height) {
  // Each note takes 1 line, or 2 if the name is long; show as many as fit.
  const lines = (i) => (`Due ${fmtTime(i.due)} · ${i.title}`.length > 26 ? 2 : 1);
  let room = Math.max(1, Math.floor((height - 40) / 15));
  const shown = [];
  for (const [n, i] of notes.entries()) {
    const need = lines(i) + (n < notes.length - 1 ? 0 : 0);
    const leaveForMore = n < notes.length - 1 ? 1 : 0; // keep a line for "+N more" if others follow
    if (need + (shown.length + 1 < notes.length ? leaveForMore : 0) > room && shown.length) break;
    shown.push(i);
    room -= need;
  }
  for (const i of shown) {
    const note = el(i.link ? "a" : "button", `wk-note t-${i.tier}${i.done ? " done" : ""}`, `⚑ Due ${fmtTime(i.due)} · ${i.title}`);
    note.title = `${i.title} · due ${fmtDate(i.due)}${i.done ? " (done)" : ""}`;
    if (i.link) { note.href = i.link; note.target = "_blank"; note.rel = "noopener"; }
    else { note.type = "button"; if (i.manual) note.onclick = () => openAssignmentForm(i); }
    node.append(note);
  }
  if (shown.length < notes.length) {
    const more = el("button", "wk-note more", `+${notes.length - shown.length} more due`);
    more.type = "button";
    more.title = notes.slice(shown.length).map((i) => i.title).join(", ");
    more.onclick = () => { selectedDay = startOfDay(notes[0].due); render(); };
    node.append(more);
  }
  node.title += " · " + notes.map((i) => `due ${fmtTime(i.due)}: ${i.title}`).join(" · ");
}

// Side-by-side columns for things that overlap in time.
function layoutLanes(list) {
  const items = [...list].sort((a, b) => (a.startMin - b.startMin) || (b.endMin - a.endMin));
  const out = [];
  let cluster = [], clusterEnd = -1, laneEnds = [];
  const flush = () => { const lanes = laneEnds.length || 1; cluster.forEach((e) => (e.lanes = lanes)); out.push(...cluster); cluster = []; laneEnds = []; };
  for (const e0 of items) {
    const e = { ...e0, endMin: Math.max(e0.endMin, e0.startMin + 22 * 60 / HOUR_PX) };
    if (cluster.length && e.startMin >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= e.startMin);
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(0); }
    laneEnds[lane] = e.endMin;
    e.lane = lane;
    cluster.push(e);
    clusterEnd = Math.max(clusterEnd, e.endMin);
  }
  flush();
  return out;
}

// ---------- Editing the class schedule ----------

function openScheduleEditor() {
  const draft = JSON.parse(JSON.stringify(classSchedule));
  const wrap = el("form", "form");
  const courseList = el("datalist");
  courseList.id = "schedCourses";
  [...new Set([...items.map((i) => i.course), ...scheduleClassNames()])].sort().forEach((c) => courseList.append(new Option(c)));

  const show = inputEl("checkbox");
  show.checked = draft.show;
  const showRow = el("label", "toggle-row");
  showRow.append(show, " Show my classes in the Week view");

  const rotation = selectEl([["ab", "A/B days (alternate each school day)"], ["same", "Same classes every day"]], draft.rotation);
  const anchorDate = inputEl("date", draft.anchor.date);
  const anchorLetter = selectEl([["A", "A Day"], ["B", "B Day"]], draft.anchor.letter);
  const anchorRow = el("div", "field-row align-end");
  anchorRow.append(field("A known day", anchorDate), field("was a", anchorLetter));

  const periodsBox = el("div", "sched-table");
  const extrasBox = el("div", "sched-table");
  const drawPeriods = () => {
    periodsBox.innerHTML = "";
    const ab = rotation.value === "ab";
    const headRow = el("div", `sched-row head${ab ? "" : " same"}`);
    ["Name", "Start", "End", ab ? "A Day class" : "Class", ...(ab ? ["B Day class"] : []), ""].forEach((t) => headRow.append(el("span", "", t)));
    periodsBox.append(headRow);
    draft.periods.forEach((p, n) => {
      const row = el("div", `sched-row${ab ? "" : " same"}`);
      const bind = (input, key) => { input.oninput = () => (p[key] = input.value); return input; };
      const cls = (key) => { const i = bind(inputEl("text", p[key] || "", { placeholder: "Class" }), key); i.setAttribute("list", "schedCourses"); return i; };
      row.append(bind(inputEl("text", p.label), "label"), bind(inputEl("time", p.start), "start"), bind(inputEl("time", p.end), "end"), cls("A"));
      if (ab) row.append(cls("B"));
      const x = button("✕", () => { draft.periods.splice(n, 1); drawPeriods(); }, "Remove period");
      x.type = "button";
      x.className = "link-btn";
      row.append(x);
      periodsBox.append(row);
    });
  };
  const drawExtras = () => {
    extrasBox.innerHTML = "";
    draft.extras.forEach((x, n) => {
      const row = el("div", "sched-row extra");
      const bind = (input, key) => { input.oninput = () => (x[key] = input.value); return input; };
      row.append(bind(inputEl("text", x.label, { placeholder: "e.g. Lunch" }), "label"), bind(inputEl("time", x.start), "start"), bind(inputEl("time", x.end), "end"));
      const del = button("✕", () => { draft.extras.splice(n, 1); drawExtras(); }, "Remove");
      del.type = "button";
      del.className = "link-btn";
      row.append(del);
      extrasBox.append(row);
    });
  };
  rotation.onchange = () => { anchorRow.classList.toggle("hidden", rotation.value !== "ab"); drawPeriods(); };
  anchorRow.classList.toggle("hidden", rotation.value !== "ab");
  drawPeriods();
  drawExtras();

  const addPeriod = button("+ Add period", () => {
    const last = draft.periods[draft.periods.length - 1];
    draft.periods.push({ label: `Period ${draft.periods.length + 1}`, start: last?.end || "08:00", end: "", A: "", B: "" });
    drawPeriods();
  });
  addPeriod.type = "button";
  const addExtra = button("+ Add lunch, break or bus", () => { draft.extras.push({ label: "", start: "", end: "" }); drawExtras(); });
  addExtra.type = "button";

  // Offer to line up study hours with the schedule.
  const times = [...draft.periods, ...draft.extras].filter((p) => p.start && p.end);
  const first = times.length ? Math.min(...times.map((p) => toMin(p.start))) : null;
  const last = times.length ? Math.max(...times.map((p) => toMin(p.end))) : null;
  const studyEnd = PLAN.schoolEnd[0] * 60 + PLAN.schoolEnd[1];
  const note = el("p", "sub");
  if (last != null && last !== studyEnd) {
    note.append(`Your study hours say school ends at ${minLabel(studyEnd)}, but this schedule ends at ${minLabel(last)}. `);
    const sync = button(`Start study time at ${minLabel(last)}`, () => {
      PLAN = { ...PLAN, schoolStart: [Math.floor(first / 60), first % 60], schoolEnd: [Math.floor(last / 60), last % 60] };
      savePlanSettings();
      note.textContent = `Done. Study time now starts at ${minLabel(last)} on school days (click Update my plan).`;
      render();
    });
    sync.type = "button";
    sync.className = "link-btn";
    note.append(sync);
  }

  const actions = el("div", "modal-actions");
  const reset = button("Reset", () => { classSchedule = JSON.parse(JSON.stringify(SCHEDULE_DEFAULTS)); saveSchedule(); closeModal(); render(); });
  reset.type = "button";
  reset.classList.add("danger");
  const save = el("button", "primary", "Save");
  save.type = "submit";
  actions.append(reset, save);

  wrap.append(showRow, field("Rotation", rotation), anchorRow, courseList,
    el("h4", "", "Class periods"), periodsBox, addPeriod,
    el("h4", "", "Lunch, breaks and bus"), extrasBox, addExtra, note, actions);
  wrap.onsubmit = (e) => {
    e.preventDefault();
    draft.show = show.checked;
    draft.rotation = rotation.value;
    draft.anchor = { date: anchorDate.value || draft.anchor.date, letter: anchorLetter.value };
    draft.periods = draft.periods.filter((p) => p.start && p.end);
    draft.extras = draft.extras.filter((x) => x.label && x.start && x.end);
    classSchedule = draft;
    saveSchedule();
    closeModal();
    render();
  };
  showPanel("Class schedule", wrap, { wide: true });
}
