// First-time setup: walks through every setting once (using the same forms as the
// Settings page), saves as you go, and remembers that setup is done.
// Uses globals from the other scripts only when called.

let setupStep = (() => { try { return Number(localStorage.getItem("setupStep")) || 0; } catch { return 0; } })();
const setupIsDone = () => { try { return localStorage.getItem("setupDone") === "1"; } catch { return true; } };

const SETUP_STEPS = [
  { id: "welcome", title: "Welcome to Classroom Priorities", blurb: "Let's set things up for you. It takes about two minutes, and you can change anything later in Settings.", build: setupWelcome },
  { id: "hours", title: "Your school day and study time", blurb: "When you're at school, when you go to bed, and how much studying you want in a day.", build: () => openPlanSettings(), save: "form" },
  { id: "schedule", title: "Your classes", blurb: "Add your class periods so the Week view shows your day. Using A/B days? Tell it one day you know.", build: () => openScheduleEditor(), save: "form" },
  { id: "busy", title: "Busy times", blurb: "Practices, jobs, clubs or anything else. Your study plan will work around them.", build: () => openBusyTimes(), save: "busy" },
  { id: "calendars", title: "Your Google Calendars", blurb: "Pick calendars to show next to your assignments. Timed events are planned around.", build: () => renderCalPanel(), skip: () => !accessToken || !calendars.length },
  { id: "reminders", title: "Reminders and refreshing", blurb: "Get a heads-up before study sessions and deadlines, and keep your assignments up to date.", build: setupReminders },
  { id: "done", title: "You're all set 🎉", blurb: "Everything is saved in this browser and will be remembered next time.", build: setupSummary },
];

function visibleSteps() {
  return SETUP_STEPS.filter((s) => !s.skip?.());
}

function renderSetup() {
  const page = $("setupPage");
  page.innerHTML = "";
  const steps = visibleSteps();
  setupStep = Math.max(0, Math.min(setupStep, steps.length - 1));
  try { localStorage.setItem("setupStep", String(setupStep)); } catch {}
  const step = steps[setupStep];

  const card = el("div", "setup-card");
  const top = el("div", "setup-top");
  const dots = el("div", "setup-dots");
  steps.forEach((s, n) => dots.append(el("span", n === setupStep ? "on" : n < setupStep ? "done" : "")));
  const close = button("Skip setup", () => finishSetup(false));
  close.className = "ghost";
  top.append(el("span", "kicker", `Step ${setupStep + 1} of ${steps.length}`), dots, close);

  const body = el("div", `setup-step${step.save === "form" ? " hide-actions" : ""}`);
  body.append(el("h2", "", step.title), el("p", "sub", step.blurb));
  panelTarget = body;
  try {
    const out = step.build();
    if (out instanceof Element) body.append(out);
  } finally {
    panelTarget = null;
  }

  const foot = el("div", "setup-foot");
  if (setupStep > 0) foot.append(button("← Back", () => goSetup(-1, false)));
  foot.append(el("span", "setup-spacer"));
  if (step.id !== "welcome" && step.id !== "done") {
    const skip = button("Skip this step", () => goSetup(1, false));
    skip.className = "ghost";
    foot.append(skip);
  }
  if (step.id === "done") {
    const make = button("📅 Make my first plan", () => { finishSetup(true); });
    make.classList.add("primary");
    foot.append(button("Go to my assignments", () => finishSetup(false)), make);
  } else {
    const next = button(step.id === "welcome" ? "Get started →" : "Save & continue →", () => goSetup(1, true));
    next.classList.add("primary");
    foot.append(next);
  }

  card.append(top, body, foot);
  page.append(card);
}

// Moves forward/back; when saving, submits the step's form first (same as its Save button).
function goSetup(dir, save) {
  const steps = visibleSteps();
  const step = steps[setupStep];
  if (save) {
    const body = document.querySelector("#setupPage .setup-step");
    if (step.save === "form") body?.querySelector("form")?.dispatchEvent(new Event("submit", { cancelable: true }));
    if (step.save === "busy") {
      const form = body?.querySelector("form");
      if (form?.querySelector('input[type="text"]')?.value.trim()) form.dispatchEvent(new Event("submit", { cancelable: true }));
    }
  }
  setupStep += dir;
  render();
  window.scrollTo(0, 0);
}

function finishSetup(makeFirstPlan) {
  try {
    localStorage.setItem("setupDone", "1");
    localStorage.removeItem("setupStep");
  } catch {}
  setupStep = 0;
  setView(lastView || "list");
  if (makeFirstPlan && hasData()) { makePlan(); render(); }
}

function startSetup() {
  setupStep = 0;
  setView("setup");
}

function setupWelcome() {
  const wrap = el("div", "setup-welcome");
  if (accessToken) {
    const who = el("div", "setup-who");
    const pic = el("div", "avatar");
    pic.innerHTML = $("profileBtn").innerHTML;
    who.append(pic, el("div", "", `Signed in${profile?.name ? " as " + profile.name : ""}. Your classes are loading in the background.`));
    wrap.append(who);
  } else {
    wrap.append(el("p", "", "Sign in with the Google account you use for Classroom to load your assignments, calendars and class names."));
    const row = el("div", "settings-actions");
    const sign = button("Sign in with Google", () => signIn());
    sign.classList.add("primary");
    row.append(sign);
    wrap.append(row, el("p", "sub", "Or click Get started to set things up without signing in. You can sign in any time from the profile menu."));
  }
  return wrap;
}

function setupReminders() {
  const wrap = el("div", "form");
  wrap.append(remindersSettings());
  const auto = selectEl([[0, "Off"], [5, "Every 5 minutes"], [10, "Every 10 minutes"], [15, "Every 15 minutes"], [30, "Every 30 minutes"], [60, "Every hour"]], autoRefreshMinutes());
  auto.onchange = () => { try { localStorage.setItem("autoRefreshMin", auto.value); } catch {} };
  const f = field("Auto-refresh from Google", auto);
  f.style.maxWidth = "280px";
  wrap.append(f);
  return wrap;
}

function setupSummary() {
  const t = (x) => fmtTime(new Date(2023, 0, 1, x[0], x[1]));
  const days = PLAN.schoolDays.map((d) => new Date(2023, 0, 1 + d).toLocaleString([], { weekday: "short" })).join(", ");
  const classes = scheduleClassNames();
  const list = el("ul", "setup-summary");
  const row = (label, text) => { const li = el("li"); li.append(el("b", "", label), el("span", "", text)); list.append(li); };
  row("School", `${days || "No school days"} · ${t(PLAN.schoolStart)}–${t(PLAN.schoolEnd)}`);
  row("Study", `aim for ${fmtMinutes(PLAN.dailyTargetMin)} a day · bedtime ${t(PLAN.bedtime)} · up to ${fmtMinutes(PLAN.weekendCapMin)} on days off`);
  row("Classes", classes.length ? `${classes.length} (${classes.slice(0, 5).join(", ")}${classes.length > 5 ? "…" : ""})${classSchedule.rotation === "ab" ? " · A/B days" : ""}` : "None yet");
  row("Busy times", busyTimes.length ? busyTimes.map((b) => b.title).join(", ") : "None");
  row("Calendars", shownCals.size ? `${shownCals.size} shown` : "None");
  row("Reminders", notificationsOn() ? "On" : "Off");
  row("Auto-refresh", autoRefreshMinutes() ? `every ${autoRefreshMinutes()} min` : "Off");
  const wrap = el("div");
  wrap.append(list, el("p", "sub", "Change any of this later: profile picture → Settings. To use it on another device, Settings → Backup & restore."));
  return wrap;
}
