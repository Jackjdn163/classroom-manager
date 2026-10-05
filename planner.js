// Study planner: fits unfinished assignments into free time outside school and
// calendar events, so each one is done before it's due.
// Uses globals from app.js (items, events, shownCals, …) only when called.

const PLAN = {
  schoolDays: [1, 2, 3, 4, 5], // Mon–Fri
  schoolEnd: [16, 30],         // study can start after 4:30 PM on school days
  dayStart: [7, 0],            // earliest study time on non-school days
  bedtime: [23, 0],
  softLimitMin: 30,            // may go this far past bedtime, only if needed to finish on time
  weekendCapMin: 180,          // at most 3 hours of planned work per non-school day
  maxBlockMin: 60,             // longer assignments are split into blocks of up to this
  minBlockMin: 15,
  breakMin: 10,                // gap after each block
  maxHorizonDays: 60,
};

// ---------- Time estimates ----------

const estimates = (() => { try { return JSON.parse(localStorage.getItem("estimates")) || {}; } catch { return {}; } })();
function saveEstimates() { try { localStorage.setItem("estimates", JSON.stringify(estimates)); } catch {} }

function guessMinutes(item) {
  if (item.type === "MULTIPLE_CHOICE_QUESTION" || item.type === "SHORT_ANSWER_QUESTION") return 15;
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
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h}h ${r}m` : `${h} hr${h > 1 ? "s" : ""}`;
}

// ---------- The plan ----------

let plan = (() => {
  try {
    const p = JSON.parse(localStorage.getItem("plan"));
    if (!p) return null;
    p.blocks.forEach((b) => { b.start = new Date(b.start); b.end = new Date(b.end); });
    return p;
  } catch {
    return null;
  }
})();
function savePlan() { try { localStorage.setItem("plan", JSON.stringify(plan)); } catch {} }

// Assignments that need planning: not done, not removed, and with a due date
// (missing work only while "Show missing" is on).
function planTasks() {
  const showMissing = $("showMissing").checked;
  return items
    .filter((i) => !i.done && !i.removed && i.due && (i.tier !== "missing" || showMissing))
    .map((i) => ({ item: i, minutes: estimateOf(i) }));
}

function planSignature(tasks) {
  return tasks.map((t) => `${t.item.id}:${t.minutes}:${+t.item.due}`).sort().join("|") + "#" + [...shownCals].sort().join(",");
}

function makePlan() {
  items.forEach((i) => (i.tier = tierOf(i)));
  const tasks = planTasks();
  const now = new Date(Math.ceil(Date.now() / (5 * 60e3)) * 5 * 60e3); // next 5-minute mark

  const latestDue = Math.max(0, ...tasks.filter((t) => t.item.tier !== "missing").map((t) => +t.item.due));
  const days = Math.min(PLAN.maxHorizonDays, Math.max(14, Math.ceil((latestDue - now) / DAY) + 1));
  const horizon = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);

  const missing = tasks.filter((t) => t.item.tier === "missing").sort((a, b) => a.item.due - b.item.due);
  const upcoming = tasks.filter((t) => t.item.tier !== "missing").sort((a, b) => (a.item.due - b.item.due) || (b.item.points - a.item.points));
  const soon = upcoming.filter((t) => t.item.due - now < 2 * DAY);
  const later = upcoming.filter((t) => t.item.due - now >= 2 * DAY);

  // First try: anything due in the next 2 days, then missing work, then the rest.
  // If that makes on-time work not fit, plan all on-time work first instead.
  let result = schedule([...soon, ...missing, ...later], now, horizon);
  const lateUpcoming = (r) => r.unfit.filter((u) => u.tier !== "missing").length;
  if (missing.length && lateUpcoming(result)) {
    const alt = schedule([...upcoming, ...missing], now, horizon);
    if (lateUpcoming(alt) < lateUpcoming(result)) result = alt;
  }

  plan = { at: Date.now(), sig: planSignature(tasks), blocks: result.blocks, unfit: result.unfit };
  savePlan();
}

function schedule(tasks, now, horizon) {
  const slots = freeSlots(now, horizon);
  const usedByDay = new Map();
  const blocks = [], unfit = [];

  for (const t of tasks) {
    const isMissing = t.item.tier === "missing";
    const deadline = isMissing ? horizon : t.item.due;
    let left = t.minutes;
    const placed = [];
    // Normal hours first; only then go past bedtime (never for missing work).
    for (const soft of isMissing ? [false] : [false, true]) {
      for (const s of slots) {
        if (s.soft !== soft) continue;
        // Keep filling this stretch of free time (in blocks with breaks) before moving on.
        while (left > 0 && s.start < deadline) {
          const used = usedByDay.get(s.day) || 0;
          const avail = Math.floor(Math.min((Math.min(+s.end, +deadline) - s.start) / 60e3, s.cap - used));
          if (avail < Math.min(PLAN.minBlockMin, left)) break;
          const len = Math.min(left, PLAN.maxBlockMin, avail);
          const start = new Date(s.start);
          const end = new Date(+start + len * 60e3);
          placed.push({ itemId: t.item.id, start, end, soft });
          s.start = new Date(+end + PLAN.breakMin * 60e3);
          usedByDay.set(s.day, used + len);
          left -= len;
        }
        if (left <= 0) break;
      }
    }
    placed.sort((a, b) => a.start - b.start);
    placed.forEach((b, n) => { b.part = n + 1; b.parts = placed.length; });
    blocks.push(...placed);
    if (left > 0) unfit.push({ itemId: t.item.id, needMin: left, tier: t.item.tier });
  }
  blocks.sort((a, b) => a.start - b.start);
  return { blocks, unfit };
}

// Free time per day (outside school, before bedtime, not during timed calendar
// events), plus a separate "soft" slot just after bedtime.
function freeSlots(now, horizon) {
  const busy = events
    .filter((e) => shownCals.has(e.calId) && !e.allDay)
    .map((e) => [+e.start, +e.end]);
  const slots = [];
  for (let day = startOfDay(now); day < horizon; day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)) {
    const at = ([h, m]) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
    const school = PLAN.schoolDays.includes(day.getDay());
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

// ---------- Showing the plan ----------

// Plan blocks for assignments that still need doing.
function activePlanBlocks() {
  if (!plan) return [];
  const byId = new Map(items.map((i) => [i.id, i]));
  return plan.blocks
    .filter((b) => { const i = byId.get(b.itemId); return i && !i.done && !i.removed; })
    .map((b) => ({ ...b, item: byId.get(b.itemId) }));
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

function renderPlanRow(b, now) {
  const li = el("li", `item plan-item${b.soft ? " soft" : ""}${b.end < now ? " past" : ""}`);
  const body = el("div", "body");
  const a = el("a", "title", b.item.title);
  a.href = b.item.link;
  a.target = "_blank";
  a.rel = "noopener";
  const bits = [blockLabel(b), b.item.course];
  if (b.parts > 1) bits.push(`part ${b.part} of ${b.parts}`);
  if (b.soft) bits.push("past bedtime, needed to finish on time");
  body.append(a, el("div", "meta", bits.join(" · ")));
  li.append(body);
  return li;
}

function renderPlanBar(now) {
  const bar = $("planBar");
  bar.innerHTML = "";

  const top = el("div", "plan-top");
  const btn = button(plan ? "Update my plan" : "📅 Make my plan", () => {
    makePlan();
    render();
  });
  btn.classList.add("primary");
  top.append(btn);

  if (!plan) {
    top.append(el("span", "sub", "Plans your work around school (7:00 AM–4:30 PM on weekdays), your calendar events, and an 11 PM bedtime."));
    bar.append(top);
    return;
  }

  const blocks = activePlanBlocks();
  const total = blocks.reduce((m, b) => m + (b.end - b.start) / 60e3, 0);
  top.append(el("span", "sub", `${blocks.length} study blocks · ${fmtMinutes(Math.round(total))} total · made ${fmtDate(new Date(plan.at))}`));
  bar.append(top);

  const tasks = planTasks();
  if (planSignature(tasks) !== plan.sig) {
    bar.append(el("p", "plan-note", "Your assignments, time estimates or calendars changed since this plan was made. Click Update my plan."));
  }

  const byId = new Map(items.map((i) => [i.id, i]));
  const unfit = plan.unfit.filter((u) => { const i = byId.get(u.itemId); return i && !i.done && !i.removed; });
  for (const u of unfit) {
    const i = byId.get(u.itemId);
    const why = u.tier === "missing"
      ? `couldn't find ${fmtMinutes(u.needMin)} of free time in the next few weeks`
      : `needs ${fmtMinutes(u.needMin)} more than you have free before it's due`;
    bar.append(el("p", "plan-warn", `⚠️ ${i.title} (${i.course}) ${why}.`));
  }

  const todayKey = dayKey(new Date(now));
  const today = blocks.filter((b) => dayKey(b.start) === todayKey);
  if (today.length) {
    bar.append(el("h2", "", "Today's plan"));
    const ol = el("ol");
    today.forEach((b) => ol.append(renderPlanRow(b, now)));
    bar.append(ol);
  } else {
    const next = blocks.find((b) => b.start > now);
    bar.append(el("p", "sub", next
      ? `Nothing planned for today. Next: ${fmtDate(next.start)} · ${next.item.title}`
      : "Nothing left to plan. 🎉"));
  }
}
