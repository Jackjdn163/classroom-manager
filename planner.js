// Study planner: fits unfinished assignments into your free study time (outside school,
// calendar events and bedtime) so each one is done before it's due. Blocks you edit,
// add or check off are kept when the plan is remade.
// Uses globals from manual.js / app.js only when called.

const PLAN_DEFAULTS = {
  schoolDays: [1, 2, 3, 4, 5], // 0 = Sunday … 6 = Saturday
  schoolStart: [7, 0],
  schoolEnd: [16, 30],         // study can start after school
  dayStart: [7, 0],            // earliest study time on non-school days
  bedtime: [23, 0],
  softLimitMin: 30,            // may go this far past bedtime, only if needed to finish on time
  weekendCapMin: 180,          // most planned work per non-school day
  maxBlockMin: 60,             // longer assignments are split into blocks of up to this
  minBlockMin: 15,
  breakMin: 10,                // gap after each block
  daysOff: [],                 // "YYYY-MM-DD" dates with no school
};
let PLAN = { ...PLAN_DEFAULTS, ...loadJSON("planSettings", {}) };
function savePlanSettings() { saveJSON("planSettings", PLAN); }

// High priority is planned as if due a day earlier; low as if a day later.
const PRIORITY_SHIFT = { high: -24 * 3600e3, normal: 0, low: 24 * 3600e3 };

// ---------- Time estimates ----------

const estimates = loadJSON("estimates", {});
function saveEstimates() { saveJSON("estimates", estimates); }

function guessMinutes(item) {
  if (item.type === "MULTIPLE_CHOICE_QUESTION" || item.type === "SHORT_ANSWER_QUESTION") return 15;
  if (item.manual) return 30;
  const p = item.points || 0;
  if (!p) return 30;
  if (p <= 10) return 20;
  if (p <= 25) return 30;
  if (p <= 50) return 45;
  if (p <= 100) return 90;
  return 120;
}

function estimateOf(item) {
  return estimates[item.id] ?? guessMinutes(item);
}

const ESTIMATE_CHOICES = [10, 15, 20, 30, 45, 60, 75, 90, 120, 150, 180, 240, 300];

function fmtMinutes(m) {
  m = Math.round(m);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h}h ${r}m` : `${h} hr${h > 1 ? "s" : ""}`;
}

// ---------- The plan ----------

// { at, sig, blocks: [{ id, itemId, start, end, soft, part, parts, locked?, done? }], unfit: [...] }
let plan = (() => {
  const p = loadJSON("plan", null);
  if (!p) return null;
  p.blocks.forEach((b, n) => {
    b.start = new Date(b.start);
    b.end = new Date(b.end);
    b.id ??= "b" + n + "-" + +b.start;
  });
  return p;
})();
function savePlan() { saveJSON("plan", plan); }
const blockId = () => "b" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const blockMinutes = (b) => (b.end - b.start) / 60e3;

// Assignments that need planning: not done, not removed, and with a due date
// (missing work only while "Show missing" is on).
function planTasks() {
  const showMissing = $("showMissing").checked;
  return items
    .filter((i) => !i.done && !i.removed && i.due && (i.tier !== "missing" || showMissing))
    .map((i) => ({ item: i, minutes: estimateOf(i) }));
}

function planSignature(tasks) {
  return tasks.map((t) => `${t.item.id}:${t.minutes}:${+t.item.due}:${t.item.priority}`).sort().join("|")
    + "#" + [...shownCals].sort().join(",") + "#" + JSON.stringify(PLAN);
}

// Blocks to keep when remaking the plan: ones you checked off, and upcoming ones you edited or added.
function keptBlocks(now) {
  if (!plan) return [];
  const open = new Set(items.filter((i) => !i.done && !i.removed).map((i) => i.id));
  return plan.blocks.filter((b) => b.done || (b.locked && b.end > now && open.has(b.itemId)));
}

const PLAN_DAYS = 7; // today + the next 6 days

function makePlan() {
  items.forEach((i) => (i.tier = tierOf(i)));
  const now = new Date(Math.ceil(Date.now() / (5 * 60e3)) * 5 * 60e3); // next 5-minute mark
  const today = startOfDay(now);
  const weekEnd = addDays(today, PLAN_DAYS);
  const kept = keptBlocks(now);

  // Time already done or booked by your own sessions comes off each estimate.
  const booked = new Map();
  for (const b of kept) booked.set(b.itemId, (booked.get(b.itemId) || 0) + blockMinutes(b));

  const allTasks = planTasks();
  const tasks = [], unfit = [], later = [];
  for (const t of allTasks) {
    let minutes = Math.max(0, t.minutes - (booked.get(t.item.id) || 0));
    if (!minutes) continue;
    const isMissing = t.item.tier === "missing";
    const dueDay = isMissing ? null : startOfDay(t.item.due);
    // Work only on days before the due date (and only this week).
    const stop = isMissing || dueDay > weekEnd ? weekEnd : dueDay;
    const days = [];
    for (let d = today; d < stop; d = addDays(d, 1)) days.push(dayKey(d));
    if (!days.length) {
      unfit.push({ itemId: t.item.id, needMin: minutes, tier: t.item.tier, reason: "dueToday" });
      continue;
    }
    // Due after this week: plan this week's fair share, leave the rest for later.
    if (!isMissing && dueDay > weekEnd) {
      const daysBeforeDue = Math.round((dueDay - today) / DAY);
      const share = Math.min(minutes, Math.ceil((minutes * PLAN_DAYS) / daysBeforeDue / 5) * 5);
      if (share < minutes) later.push({ itemId: t.item.id, min: minutes - share });
      minutes = share;
    }
    tasks.push({ item: t.item, minutes, days, deadline: isMissing ? weekEnd : stop });
  }

  const result = schedule(tasks, now, weekEnd, kept.filter((b) => b.end > now));
  plan = {
    at: Date.now(),
    sig: planSignature(allTasks),
    blocks: numberParts([...kept, ...result.blocks]),
    unfit: [...unfit, ...result.unfit],
    later,
  };
  savePlan();
}

function addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function numberParts(blocks) {
  blocks.sort((a, b) => a.start - b.start);
  const byItem = new Map();
  for (const b of blocks) {
    if (!byItem.has(b.itemId)) byItem.set(b.itemId, []);
    byItem.get(b.itemId).push(b);
  }
  for (const list of byItem.values()) list.forEach((b, n) => { b.part = n + 1; b.parts = list.length; });
  return blocks;
}

// Splits each assignment into sessions and spreads them over the days before it's due,
// always choosing the least-busy day (and avoiding two sessions of the same
// assignment on one day when possible).
function schedule(tasks, now, weekEnd, keptFuture) {
  const slots = freeSlots(now, weekEnd, keptFuture.map((b) => [+b.start, +b.end]));
  const slotsByDay = new Map();
  for (const s of slots) {
    if (!slotsByDay.has(s.day)) slotsByDay.set(s.day, []);
    slotsByDay.get(s.day).push(s);
  }
  const load = new Map();      // day -> planned minutes
  const sameTask = new Set();  // "itemId|day" already has a session
  for (const b of keptFuture) {
    const k = dayKey(b.start);
    load.set(k, (load.get(k) || 0) + blockMinutes(b));
    sameTask.add(b.itemId + "|" + k);
  }
  const blocks = [], unfit = [];

  // Most constrained first (fewest days left), then earliest (priority-adjusted) due date.
  const effDue = (t) => +t.deadline + PRIORITY_SHIFT[t.item.priority || "normal"];
  tasks.sort((a, b) => (a.days.length - b.days.length) || (effDue(a) - effDue(b)));

  for (const t of tasks) {
    const sessions = Math.max(1, Math.min(t.days.length,
      Math.max(Math.ceil(t.minutes / PLAN.maxBlockMin), Math.floor(t.minutes / 30))));
    const queue = splitEven(t.minutes, sessions);
    const canGoLate = t.item.tier !== "missing" && PLAN.softLimitMin > 0;
    let left = 0;
    while (queue.length) {
      const want = queue.shift();
      // Whole session in normal hours, then past bedtime, then a shorter piece of either.
      const got = place(t, want, false, false)
        || (canGoLate && place(t, want, true, false))
        || place(t, want, false, true)
        || (canGoLate && place(t, want, true, true));
      if (!got) { left += want + queue.reduce((a, b) => a + b, 0); break; }
      if (got < want) queue.unshift(want - got);
    }
    if (left > 0) unfit.push({ itemId: t.item.id, needMin: left, tier: t.item.tier });
  }
  return { blocks, unfit };

  // Puts up to `want` minutes of t on the best day; returns minutes placed (0 if none).
  function place(t, want, soft, partial) {
    const order = t.days
      .map((k, n) => ({ k, n, score: (load.get(k) || 0) + (sameTask.has(t.item.id + "|" + k) ? 10000 : 0) }))
      .sort((a, b) => (a.score - b.score) || (a.n - b.n));
    const need = partial ? Math.min(PLAN.minBlockMin, want) : want;
    for (const { k } of order) {
      for (const s of slotsByDay.get(k) || []) {
        if (s.soft !== soft) continue;
        const used = load.get(k) || 0;
        const fits = Math.floor(Math.min((Math.min(+s.end, +t.deadline) - s.start) / 60e3, s.cap - used));
        if (fits < need) continue;
        const len = Math.min(want, fits);
        const start = new Date(s.start);
        const end = new Date(+start + len * 60e3);
        blocks.push({ id: blockId(), itemId: t.item.id, start, end, soft });
        s.start = new Date(+end + PLAN.breakMin * 60e3);
        load.set(k, used + len);
        sameTask.add(t.item.id + "|" + k);
        return len;
      }
    }
    return 0;
  }
}

// Splits total minutes into n parts in 5-minute steps, as equal as possible.
function splitEven(total, n) {
  const parts = Array(n).fill(Math.floor(total / n / 5) * 5);
  let rest = total - parts.reduce((a, b) => a + b, 0);
  for (let i = 0; rest > 0; i = (i + 1) % n) {
    const add = Math.min(5, rest);
    parts[i] += add;
    rest -= add;
  }
  return parts.filter((p) => p > 0);
}

function isSchoolDay(day) {
  return PLAN.schoolDays.includes(day.getDay()) && !PLAN.daysOff.includes(dateInputValue(day));
}

// Free time per day (outside school, before bedtime, not during timed calendar
// events or your own blocks), plus a separate "soft" slot just after bedtime.
function freeSlots(now, horizon, extraBusy = []) {
  const busy = events
    .filter((e) => shownCals.has(e.calId) && !e.allDay && e.calId !== studyCalendarId())
    .map((e) => [+e.start, +e.end])
    .concat(extraBusy);
  const slots = [];
  for (let day = startOfDay(now); day < horizon; day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)) {
    const at = ([h, m]) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
    const school = isSchoolDay(day);
    const bed = at(PLAN.bedtime);
    const windows = [
      [at(school ? PLAN.schoolEnd : PLAN.dayStart), bed, false],
      [bed, new Date(+bed + PLAN.softLimitMin * 60e3), true],
    ];
    for (const [ws, we, soft] of windows) {
      for (const [a, b] of subtract([[Math.max(+ws, +now), +we]], busy)) {
        if (b - a >= PLAN.minBlockMin * 60e3) {
          slots.push({ start: new Date(a), end: new Date(b), soft, day: dayKey(day), cap: school ? Infinity : PLAN.weekendCapMin });
        }
      }
    }
  }
  return slots.sort((a, b) => a.start - b.start);
}

function subtract(ranges, busy) {
  let out = ranges.filter(([a, b]) => b > a);
  for (const [bs, be] of busy) {
    out = out.flatMap(([a, b]) => (be <= a || bs >= b) ? [[a, b]] : [[a, bs], [be, b]].filter(([x, y]) => y > x));
  }
  return out;
}

// ---------- Plan data for display ----------

// Plan blocks for assignments that still need doing (plus ones you checked off).
function activePlanBlocks() {
  if (!plan) return [];
  const byId = new Map(items.map((i) => [i.id, i]));
  return plan.blocks
    .filter((b) => { const i = byId.get(b.itemId); return i && !i.removed && (b.done || !i.done); })
    .map((b) => Object.assign(b, { item: byId.get(b.itemId) }));
}

function planBlocksByDay() {
  const map = new Map();
  for (const b of activePlanBlocks()) {
    const k = dayKey(b.start);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(b);
  }
  return map;
}

function blockLabel(b) {
  return `${fmtTime(b.start)}–${fmtTime(b.end)}`;
}

function toggleBlockDone(b) {
  b.done = !b.done;
  savePlan();
  render();
}

function renderPlanRow(b, now) {
  const li = el("li", `item plan-item${b.soft ? " soft" : ""}${b.done ? " done" : ""}${b.end < now && !b.done ? " past" : ""}`);
  const check = el("input");
  check.type = "checkbox";
  check.checked = !!b.done;
  check.title = "Mark this study session done";
  check.className = "block-check";
  check.onchange = () => toggleBlockDone(b);

  const body = el("div", "body");
  const a = el(b.item.link ? "a" : "span", "title", b.item.title);
  if (b.item.link) {
    a.href = b.item.link;
    a.target = "_blank";
    a.rel = "noopener";
  }
  const bits = [blockLabel(b), b.item.course];
  if (b.parts > 1) bits.push(`part ${b.part} of ${b.parts}`);
  if (b.locked) bits.push("📌 edited");
  if (b.soft) bits.push("past bedtime, needed to finish on time");
  body.append(a, el("div", "meta", bits.join(" · ")));

  const edit = button("Edit", () => openBlockEditor(b));
  edit.className = "hide-btn";
  li.append(check, body, edit);
  return li;
}

// ---------- Editing study blocks ----------

function openBlockEditor(existing) {
  const form = el("form", "form");
  const open = items.filter((i) => !i.done && !i.removed).sort(compare);
  if (!open.length) {
    form.append(el("p", "", "Add or load some assignments first."));
    return openModal("Study session", form);
  }
  const start = existing?.start || nextQuarterHour();
  const len = existing ? blockMinutes(existing) : 45;

  const which = selectEl(open.map((i) => [i.id, `${i.title} (${i.course})`]), existing?.itemId);
  const date = inputEl("date", dateInputValue(start), { required: true });
  const time = inputEl("time", timeInputValue(start), { required: true });
  const durations = [...new Set([15, 30, 45, 60, 75, 90, 120, 150, 180, len])].sort((a, b) => a - b);
  const dur = selectEl(durations.map((m) => [m, fmtMinutes(m)]), len);

  const row = el("div", "field-row");
  row.append(field("Day", date), field("Start", time), field("Length", dur));
  form.append(field("Assignment", which), row);
  form.append(el("p", "sub", "Sessions you edit or add are kept when you click Update my plan."));

  const actions = el("div", "modal-actions");
  if (existing) {
    const del = button("Delete session", () => {
      plan.blocks = numberParts(plan.blocks.filter((b) => b !== existing));
      savePlan();
      closeModal();
      render();
    });
    del.type = "button";
    del.classList.add("danger");
    actions.append(del);
  }
  const save = el("button", "primary", existing ? "Save" : "Add session");
  save.type = "submit";
  actions.append(save);
  form.append(actions);

  form.onsubmit = (e) => {
    e.preventDefault();
    const s = fromDateTimeInputs(date.value, time.value);
    if (!s) return;
    const block = existing || { id: blockId() };
    Object.assign(block, { itemId: which.value, start: s, end: new Date(+s + Number(dur.value) * 60e3), soft: false, locked: true });
    plan ??= { at: Date.now(), sig: "", blocks: [], unfit: [] };
    if (!existing) plan.blocks.push(block);
    numberParts(plan.blocks);
    savePlan();
    closeModal();
    render();
  };
  openModal(existing ? "Edit study session" : "Add a study session", form);
}

function nextQuarterHour() {
  return new Date(Math.ceil(Date.now() / (15 * 60e3)) * 15 * 60e3);
}

// ---------- Study hours settings ----------

const hm = ([h, m]) => `${pad2(h)}:${pad2(m)}`;
const parseHM = (s) => s.split(":").map(Number);

function openPlanSettings() {
  const form = el("form", "form");
  const dayNames = [0, 1, 2, 3, 4, 5, 6].map((d) => new Date(2023, 0, 1 + d).toLocaleString([], { weekday: "short" }));

  const days = el("div", "day-picks");
  const dayBoxes = dayNames.map((name, d) => {
    const label = el("label", "day-pick");
    const box = inputEl("checkbox");
    box.checked = PLAN.schoolDays.includes(d);
    label.append(box, name);
    days.append(label);
    return box;
  });
  const schoolStart = inputEl("time", hm(PLAN.schoolStart));
  const schoolEnd = inputEl("time", hm(PLAN.schoolEnd));
  const dayStart = inputEl("time", hm(PLAN.dayStart));
  const bedtime = inputEl("time", hm(PLAN.bedtime));
  const soft = selectEl([[0, "Never"], [15, "Up to 15 min"], [30, "Up to 30 min"], [45, "Up to 45 min"], [60, "Up to 1 hr"]], PLAN.softLimitMin);
  const cap = selectEl([60, 120, 180, 240, 300, 360, 480, 600].map((m) => [m, fmtMinutes(m)]), PLAN.weekendCapMin);
  const block = selectEl([30, 45, 60, 90, 120].map((m) => [m, fmtMinutes(m)]), PLAN.maxBlockMin);
  const brk = selectEl([0, 5, 10, 15, 20, 30].map((m) => [m, m ? fmtMinutes(m) : "No break"]), PLAN.breakMin);

  const daysOff = [...PLAN.daysOff];
  const offList = el("div", "chips-list");
  const drawOff = () => {
    offList.innerHTML = "";
    daysOff.sort().forEach((d) => {
      const chip = el("span", "off-chip", new Date(d + "T12:00").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) + " ");
      const x = button("✕", () => { daysOff.splice(daysOff.indexOf(d), 1); drawOff(); }, "Remove day off");
      x.type = "button";
      chip.append(x);
      offList.append(chip);
    });
  };
  drawOff();
  const offDate = inputEl("date");
  const addOff = button("Add", () => {
    if (offDate.value && !daysOff.includes(offDate.value)) daysOff.push(offDate.value);
    offDate.value = "";
    drawOff();
  });
  addOff.type = "button";
  const offRow = el("div", "field-row align-end");
  offRow.append(field("No-school days (holidays, breaks)", offDate), addOff);

  const r1 = el("div", "field-row");
  r1.append(field("School starts", schoolStart), field("School ends", schoolEnd));
  const r2 = el("div", "field-row");
  r2.append(field("Days off: start studying at", dayStart), field("Bedtime", bedtime));
  const r3 = el("div", "field-row");
  r3.append(field("Past bedtime if needed", soft), field("Max work on days off", cap));
  const r4 = el("div", "field-row");
  r4.append(field("Longest study block", block), field("Break between blocks", brk));

  form.append(field("School days", days), r1, offRow, offList, r2, r3, r4);
  const actions = el("div", "modal-actions");
  const reset = button("Reset to defaults", () => {
    PLAN = { ...PLAN_DEFAULTS };
    savePlanSettings();
    closeModal();
    render();
  });
  reset.type = "button";
  reset.classList.add("danger");
  const save = el("button", "primary", "Save");
  save.type = "submit";
  actions.append(reset, save);
  form.append(actions);

  form.onsubmit = (e) => {
    e.preventDefault();
    PLAN = {
      ...PLAN,
      schoolDays: dayBoxes.map((b, d) => (b.checked ? d : -1)).filter((d) => d >= 0),
      schoolStart: parseHM(schoolStart.value || "07:00"),
      schoolEnd: parseHM(schoolEnd.value || "16:30"),
      dayStart: parseHM(dayStart.value || "07:00"),
      bedtime: parseHM(bedtime.value || "23:00"),
      softLimitMin: Number(soft.value),
      weekendCapMin: Number(cap.value),
      maxBlockMin: Number(block.value),
      breakMin: Number(brk.value),
      daysOff,
    };
    savePlanSettings();
    closeModal();
    render();
  };
  openModal("Study hours", form, { wide: true });
}

function settingsSummary() {
  const t = (x) => fmtTime(new Date(2023, 0, 1, x[0], x[1]));
  return `School ${t(PLAN.schoolStart)}–${t(PLAN.schoolEnd)} · bedtime ${t(PLAN.bedtime)} · up to ${fmtMinutes(PLAN.weekendCapMin)} on days off`;
}

// ---------- Plan panel: buttons, warnings, Today / This week ----------

let planTab = loadJSON("planTab", "today");

function renderPlanBar(now) {
  const bar = $("planBar");
  bar.innerHTML = "";

  const top = el("div", "plan-top");
  const make = button(plan?.at && plan.sig ? "Update my plan" : "📅 Make my plan", () => {
    makePlan();
    render();
  });
  make.classList.add("primary");
  top.append(make, button("+ Study session", () => openBlockEditor()), button("⚙ Study hours", openPlanSettings));
  if (typeof calendarSyncButton === "function") top.append(calendarSyncButton());
  bar.append(top);

  if (!plan) {
    bar.append(el("p", "sub", `Plans today and the next 6 days, spreading work out and finishing each assignment before the day it's due. ${settingsSummary()}.`));
    return;
  }

  const blocks = activePlanBlocks();
  const upcoming = blocks.filter((b) => !b.done && b.end > now);
  const left = upcoming.reduce((m, b) => m + blockMinutes(b), 0);
  bar.append(el("p", "sub", `${upcoming.length} sessions left · ${fmtMinutes(left)} of study · ${settingsSummary()}`));

  const tasks = planTasks();
  if (plan.sig && planSignature(tasks) !== plan.sig) {
    bar.append(el("p", "plan-note", "Your assignments, estimates, priorities, calendars or study hours changed since this plan was made. Click Update my plan."));
  }

  const byId = new Map(items.map((i) => [i.id, i]));
  for (const u of plan.unfit) {
    const i = byId.get(u.itemId);
    if (!i || i.done || i.removed) continue;
    const why = u.reason === "dueToday"
      ? "is due today, so there's no day left before its due date to plan it. Do it as soon as you can"
      : u.tier === "missing"
        ? `couldn't fit ${fmtMinutes(u.needMin)} of it into this week's free time`
        : `needs ${fmtMinutes(u.needMin)} more than you have free on the days before it's due`;
    bar.append(el("p", "plan-warn", `⚠️ ${i.title} (${i.course}) ${why}.`));
  }
  const later = (plan.later || []).filter((l) => { const i = byId.get(l.itemId); return i && !i.done && !i.removed; });
  if (later.length) {
    bar.append(el("p", "sub", "Due after this week, so only part is planned now: "
      + later.map((l) => `${byId.get(l.itemId).title} (${fmtMinutes(l.min)} left for later)`).join(", ") + "."));
  }

  const tabs = el("div", "seg plan-tabs");
  for (const [key, label] of [["today", "Today"], ["week", "This week"]]) {
    const b = button(label, () => { planTab = key; saveJSON("planTab", key); render(); });
    if (planTab === key) b.classList.add("active");
    tabs.append(b);
  }
  bar.append(tabs);
  bar.append(planTab === "week" ? weekSummary(blocks, now) : todaySummary(blocks, now));
}

function todaySummary(blocks, now) {
  const wrap = el("div");
  const todayKey = dayKey(new Date(now));
  const today = blocks.filter((b) => dayKey(b.start) === todayKey);
  const dueToday = items.filter((i) => !i.done && !i.removed && i.due && dayKey(i.due) === todayKey);
  const mins = today.reduce((m, b) => m + blockMinutes(b), 0);
  const doneMins = today.filter((b) => b.done).reduce((m, b) => m + blockMinutes(b), 0);

  wrap.append(el("p", "sub", today.length
    ? `${fmtMinutes(mins)} planned today · ${fmtMinutes(doneMins)} done${dueToday.length ? ` · ${dueToday.length} due today` : ""}`
    : dueToday.length ? `${dueToday.length} due today` : ""));
  if (today.length) {
    const ol = el("ol");
    today.forEach((b) => ol.append(renderPlanRow(b, now)));
    wrap.append(ol);
  } else {
    const next = blocks.find((b) => b.start > now && !b.done);
    wrap.append(el("p", "sub", next
      ? `Nothing planned for today. Next: ${fmtDate(next.start)} · ${next.item.title}`
      : "Nothing left to plan. 🎉"));
  }
  if (dueToday.length) wrap.append(el("p", "sub", "Due today: " + dueToday.map((i) => `${i.title} (${fmtTime(i.due)})`).join(", ")));
  return wrap;
}

function weekSummary(blocks, now) {
  const wrap = el("div");
  const start = startOfDay(new Date(now));
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
  const inWeek = blocks.filter((b) => b.start >= start && b.start < end);
  const total = inWeek.reduce((m, b) => m + blockMinutes(b), 0);
  const done = inWeek.filter((b) => b.done).reduce((m, b) => m + blockMinutes(b), 0);
  const dueWeek = items.filter((i) => !i.done && !i.removed && i.due && i.due >= start && i.due < end);
  wrap.append(el("p", "sub", `Next 7 days: ${fmtMinutes(total)} of study (${fmtMinutes(done)} done) · ${dueWeek.length} assignments due`));

  const table = el("div", "week-table");
  for (let n = 0; n < 7; n++) {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + n);
    const k = dayKey(day);
    const dayBlocks = inWeek.filter((b) => dayKey(b.start) === k);
    const mins = dayBlocks.reduce((m, b) => m + blockMinutes(b), 0);
    const due = dueWeek.filter((i) => dayKey(i.due) === k);
    const row = el("button", "week-row");
    row.type = "button";
    row.title = "Show this day in the calendar";
    row.onclick = () => { selectedDay = day; calMonth = startOfMonth(day); calMode = "week"; setView("calendar"); };
    const bar = el("span", "week-bar");
    bar.style.width = `${Math.min(100, (mins / Math.max(60, PLAN.weekendCapMin)) * 100)}%`;
    const barWrap = el("span", "week-bar-wrap");
    barWrap.append(bar);
    row.append(
      el("span", "week-day", n === 0 ? "Today" : day.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })),
      barWrap,
      el("span", "week-mins", mins ? `${fmtMinutes(mins)} · ${dayBlocks.length} session${dayBlocks.length > 1 ? "s" : ""}` : "free"),
      el("span", "week-due", due.length ? "Due: " + due.map((i) => i.title).join(", ") : ""),
    );
    table.append(row);
  }
  wrap.append(table);

  const byCourse = new Map();
  for (const b of inWeek) byCourse.set(b.item.course, (byCourse.get(b.item.course) || 0) + blockMinutes(b));
  if (byCourse.size) {
    wrap.append(el("p", "sub", "By class: " + [...byCourse].sort((a, b) => b[1] - a[1]).map(([c, m]) => `${c} ${fmtMinutes(m)}`).join(" · ")));
  }
  return wrap;
}
