// Assignments you add yourself, marking anything done, and High/Normal/Low priority.
// All saved in this browser. Uses globals from app.js / planner.js only when called.

const loadJSON = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const saveJSON = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };

// { id, title, course, due (ISO string), notes, taskId? }
let manualItems = loadJSON("manualItems", []);
const completed = new Set(loadJSON("completed", []));
const priorities = loadJSON("priorities", {}); // id -> "high" | "low" (normal when missing)

function saveManual() { saveJSON("manualItems", manualItems); }
function saveCompleted() { saveJSON("completed", [...completed]); }
function savePriorities() { saveJSON("priorities", priorities); }

const PRIORITY = {
  high:   { label: "High",   rank: 0, icon: "🔴" },
  normal: { label: "Normal", rank: 1, icon: "" },
  low:    { label: "Low",    rank: 2, icon: "⚪️" },
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
    turnedIn: false,
    link: null,
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

function openAssignmentForm(existing) {
  const m = existing ? manualItems.find((x) => x.id === existing.id) : null;
  const due = m?.due ? new Date(m.due) : null;
  const form = el("form", "form");

  const title = inputEl("text", m?.title || "", { required: true, placeholder: "e.g. Chapter 6 worksheet" });
  const courseList = el("datalist");
  courseList.id = "courseOptions";
  [...new Set(items.map((i) => i.course))].sort().forEach((c) => courseList.append(new Option(c)));
  const course = inputEl("text", m?.course || "", { placeholder: "e.g. Biology" });
  course.setAttribute("list", "courseOptions");
  const date = inputEl("date", due ? dateInputValue(due) : "", { required: true });
  const time = inputEl("time", due ? timeInputValue(due) : "23:59");
  const prio = selectEl(Object.entries(PRIORITY).map(([k, p]) => [k, p.label]), existing ? priorityOf(existing) : "normal");
  const est = selectEl(ESTIMATE_CHOICES.map((n) => [n, fmtMinutes(n)]), existing ? estimateOf(existing) : 30);
  const notes = el("textarea");
  notes.rows = 2;
  notes.value = m?.notes || "";
  notes.placeholder = "Optional";

  const row = el("div", "field-row");
  row.append(field("Due date", date), field("Time", time));
  const row2 = el("div", "field-row");
  row2.append(field("Priority", prio), field("Time needed", est));
  form.append(field("Assignment", title), field("Class", course), courseList, row, row2, field("Notes", notes));

  const actions = el("div", "modal-actions");
  if (m) {
    const del = button("Delete", () => {
      manualItems = manualItems.filter((x) => x.id !== m.id);
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
    const imp = button("Import from Google Tasks…", () => openTasksImport());
    imp.type = "button";
    importRow.append("Or ", imp);
    form.append(importRow);
  }

  form.onsubmit = (e) => {
    e.preventDefault();
    if (!title.value.trim() || !date.value) return;
    const data = {
      id: m?.id || "manual:" + Date.now().toString(36),
      title: title.value.trim(),
      course: course.value.trim() || "My assignments",
      due: fromDateTimeInputs(date.value, time.value).toISOString(),
      notes: notes.value.trim(),
      ...(m?.taskId && { taskId: m.taskId }),
    };
    if (m) Object.assign(m, data);
    else manualItems.push(data);
    saveManual();
    setPriority(data.id, prio.value, false);
    estimates[data.id] = Number(est.value);
    saveEstimates();
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
  wrap.title = "Priority. High is listed and planned earlier.";
  const sel = selectEl(Object.entries(PRIORITY).map(([k, p]) => [k, `${p.icon ? p.icon + " " : ""}${p.label}`]), priorityOf(item));
  sel.onchange = () => setPriority(item.id, sel.value);
  wrap.append("Priority ", sel);
  return wrap;
}
