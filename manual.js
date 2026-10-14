// Assignments you add yourself, marking anything done, and High/Normal/Low priority.
// All saved in this browser. Uses globals from app.js / planner.js only when called.

const loadJSON = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const saveJSON = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };

// { id, title, course, due (ISO string), notes, taskId? }
let manualItems = loadJSON("manualItems", []);
const completed = new Set(loadJSON("completed", []));
const priorities = loadJSON("priorities", {}); // id -> "urgent" | "high" | "low" (normal when missing)

function saveManual() { saveJSON("manualItems", manualItems); }
function saveCompleted() { saveJSON("completed", [...completed]); }
function savePriorities() { saveJSON("priorities", priorities); }

const PRIORITY = {
  urgent: { label: "Urgent", rank: 0, icon: "‼️" },
  high:   { label: "High",   rank: 1, icon: "🔴" },
  normal: { label: "Normal", rank: 2, icon: "" },
  low:    { label: "Low",    rank: 3, icon: "⚪️" },
};
function priorityOf(item) { return priorities[item.id] || "normal"; }

function manualAsItems() {
  return manualItems.map((m) => ({
    id: m.id,
    title: m.title,
    course: m.course || "My assignments",
    due: m.due ? new Date(m.due) : null,
    points: 0,
    notes: m.notes || "",
    manual: true,
    fromTask: !!m.taskId,
    templateId: m.templateId || null,
    kind: m.kind || null,
    turnedIn: false,
    link: m.link || null,
  }));
}

function toggleCompleted(item) {
  if (completed.has(item.id)) completed.delete(item.id);
  else completed.add(item.id);
  saveCompleted();
  render();
}

// ---------- Modal ----------

function openModal(title, content, { wide = false } = {}) {
  closeModal();
  const backdrop = el("div", "modal-backdrop");
  backdrop.id = "modal";
  const box = el("div", `modal${wide ? " wide" : ""}`);
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  box.setAttribute("aria-label", title);
  const head = el("div", "modal-head");
  head.append(el("h3", "", title), button("✕", closeModal, "Close"));
  box.append(head, content);
  backdrop.append(box);
  backdrop.onclick = (e) => { if (e.target === backdrop) closeModal(); };
  document.body.append(backdrop);
  box.querySelector("input, select, textarea")?.focus();
}

function closeModal() {
  document.getElementById("modal")?.remove();
}

document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

function field(labelText, input) {
  const label = el("label", "field");
  label.append(el("span", "", labelText), input);
  return label;
}

function inputEl(type, value, attrs = {}) {
  const i = el("input");
  i.type = type;
  if (value != null) i.value = value;
  Object.assign(i, attrs);
  return i;
}

function selectEl(options, value) {
  const s = el("select");
  for (const [v, text] of options) s.add(new Option(text, v));
  if (value != null) s.value = value;
  return s;
}

const pad2 = (n) => String(n).padStart(2, "0");
const dateInputValue = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const timeInputValue = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
function fromDateTimeInputs(date, time) {
  if (!date) return null;
  const [y, m, d] = date.split("-").map(Number);
  const [h, min] = (time || "23:59").split(":").map(Number);
  return new Date(y, m - 1, d, h, min);
}

// ---------- Add / edit assignment form ----------

// prefill: values from Smart Add for a new assignment.
function openAssignmentForm(existing, prefill = null) {
  const m = existing ? manualItems.find((x) => x.id === existing.id) : null;
  const src = m || prefill || {};
  const due = src.due ? new Date(src.due) : null;
  const form = el("form", "form");

  const title = inputEl("text", src.title || "", { required: true, placeholder: "e.g. Chapter 6 worksheet" });
  const courseList = el("datalist");
  courseList.id = "courseOptions";
  [...new Set(items.map((i) => i.course))].sort().forEach((c) => courseList.append(new Option(c)));
  const course = inputEl("text", src.course || "", { placeholder: "e.g. Biology" });
  course.setAttribute("list", "courseOptions");
  const date = inputEl("date", due ? dateInputValue(due) : "", { required: true });
  const time = inputEl("time", due ? timeInputValue(due) : "23:59");
  const kind = selectEl(TYPES.map((t) => [t, t]), src.kind || "Homework");
  const prio = selectEl(Object.entries(PRIORITY).map(([k, p]) => [k, p.label]), existing ? priorityOf(existing) : src.priority || "normal");
  const startMin = existing ? estimateOf(existing) : src.minutes || TYPE_MINUTES[src.kind || "Homework"];
  const est = selectEl([...new Set([...ESTIMATE_CHOICES, startMin])].sort((a, b) => a - b).map((n) => [n, fmtMinutes(n)]), startMin);
  let estTouched = !!(existing || src.minutes);
  est.onchange = () => (estTouched = true);
  kind.onchange = () => { if (!estTouched) est.value = TYPE_MINUTES[kind.value]; };
  const link = inputEl("url", src.link || "", { placeholder: "Optional link (Classroom, Canvas, doc…)" });
  const notes = el("textarea");
  notes.rows = 2;
  notes.value = src.notes || "";
  notes.placeholder = "Optional";

  const row = el("div", "field-row");
  row.append(field("Due date", date), field("Time", time));
  const row2 = el("div", "field-row");
  row2.append(field("Type", kind), field("Priority", prio), field("Time needed", est));
  form.append(field("Assignment", title), field("Class", course), courseList, row, row2, field("Link", link), field("Notes", notes));

  // New assignments: optional steps and repeating.
  let steps = null, repeat = null;
  if (!m) {
    steps = el("textarea");
    steps.rows = 2;
    steps.placeholder = "Optional: one step per line";
    const suggest = button("Suggest steps", () => {
      steps.value = suggestedSteps({ kind: kind.value, id: "", points: 0 }).join("\n");
    });
    suggest.type = "button";
    suggest.className = "link-btn";
    const stepsField = field("Checklist", steps);
    stepsField.append(suggest);
    repeat = selectEl(Object.entries(REPEATS), "none");
    form.append(stepsField, field("Repeat", repeat));
  } else if (m.templateId && templates.some((t) => t.id === m.templateId)) {
    const t = templates.find((x) => x.id === m.templateId);
    const stop = button(`Stop repeating (${REPEATS[t.repeat].toLowerCase()})`, () => {
      stopRepeating(t.id);
      closeModal();
      render();
    });
    stop.type = "button";
    stop.className = "link-btn";
    form.append(stop);
  }

  const actions = el("div", "modal-actions");
  if (m) {
    const del = button("Delete", () => {
      manualItems = manualItems.filter((x) => x.id !== m.id);
      const t = templates.find((x) => x.id === m.templateId);
      if (t) { t.skip.push(m.id); saveTemplates(); } // don't re-create this copy
      saveManual();
      closeModal();
      render();
    });
    del.type = "button";
    del.classList.add("danger");
    actions.append(del);
  }
  const save = el("button", "primary", m ? "Save" : "Add assignment");
  save.type = "submit";
  actions.append(save);
  form.append(actions);

  if (!m) {
    const importRow = el("p", "sub import-row");
    const smart = button("✨ Smart Add / scan a photo", openSmartAdd);
    smart.type = "button";
    const imp = button("Import from Google Tasks…", () => openTasksImport());
    imp.type = "button";
    importRow.append("Or ", smart, " ", imp);
    form.append(importRow);
  }

  form.onsubmit = (e) => {
    e.preventDefault();
    if (!title.value.trim() || !date.value) return;
    const data = {
      id: m?.id || "manual:" + Date.now().toString(36),
      title: title.value.trim(),
      course: course.value.trim() || "My assignments",
      kind: kind.value,
      link: link.value.trim(),
      due: fromDateTimeInputs(date.value, time.value).toISOString(),
      notes: notes.value.trim(),
      ...(m?.taskId && { taskId: m.taskId }),
      ...(m?.templateId && { templateId: m.templateId }),
    };
    if (repeat && repeat.value !== "none") {
      // Repeating: save a template; the copies (including this first one) are created from it.
      const t = { id: "tpl" + Date.now().toString(36), title: data.title, course: data.course, kind: data.kind, link: data.link,
        notes: data.notes, minutes: Number(est.value), priority: prio.value, repeat: repeat.value, first: data.due, skip: [] };
      templates.push(t);
      saveTemplates();
      ensureRecurring();
    } else {
      if (m) Object.assign(m, data);
      else manualItems.push(data);
      saveManual();
      setPriority(data.id, prio.value, false);
      estimates[data.id] = Number(est.value);
      saveEstimates();
      if (steps?.value.trim()) setSteps(data.id, steps.value.split("\n").map((x) => x.trim()).filter(Boolean));
    }
    closeModal();
    render();
  };

  openModal(m ? "Edit assignment" : "Add an assignment", form);
}

function setPriority(id, value, rerender = true) {
  if (value === "normal") delete priorities[id];
  else priorities[id] = value;
  savePriorities();
  if (rerender) render();
}

// Small "Priority" dropdown shown on each open assignment.
function priorityPicker(item) {
  const wrap = el("label", "est prio");
  wrap.title = "Priority. Urgent and High are listed and planned earlier.";
  const sel = selectEl(Object.entries(PRIORITY).map(([k, p]) => [k, `${p.icon ? p.icon + " " : ""}${p.label}`]), priorityOf(item));
  sel.onchange = () => setPriority(item.id, sel.value);
  wrap.append("Priority ", sel);
  return wrap;
}
