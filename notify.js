// Reminders while the app is open: study sessions about to start, and assignments
// due within 24 hours or 1 hour. (For reminders when the app is closed, sync your
// plan to Google Calendar.) Uses globals from the other scripts only when called.

const notified = new Set(loadJSON("notified", []));

function notificationsOn() {
  return "Notification" in window && Notification.permission === "granted" && loadJSON("notify", true);
}

async function toggleNotifications() {
  if (!("Notification" in window)) return showMessage("This browser doesn't support notifications.", true);
  if (Notification.permission === "granted") {
    saveJSON("notify", !loadJSON("notify", true));
  } else {
    const result = await Notification.requestPermission();
    if (result !== "granted") {
      showMessage("Notifications are blocked. Allow them for this site in your browser's settings, then try again.", true);
      return updateNotifyButton();
    }
    saveJSON("notify", true);
    notify("Reminders are on", "You'll get a heads-up 5 minutes before study sessions and before things are due.");
  }
  updateNotifyButton();
  checkReminders();
}

function updateNotifyButton() {
  const b = $("notifyBtn");
  if (!b) return;
  const on = notificationsOn();
  b.textContent = on ? "🔔 Reminders on" : "🔕 Reminders off";
  b.title = on
    ? "You'll get notifications while this app is open. Click to turn off."
    : "Get notifications before study sessions and deadlines while this app is open.";
}

function checkReminders(now = Date.now()) {
  if (!notificationsOn() || !items.length) return;
  const pending = [];
  const add = (key, title, body, when) => { if (!notified.has(key)) pending.push({ key, title, body, when }); };

  for (const b of activePlanBlocks()) {
    if (b.done) continue;
    const lead = b.start - now;
    if (lead <= 5 * 60e3 && lead > -5 * 60e3) add(`b:${b.id}:${+b.start}`, `Study time: ${b.item.title}`, `${blockLabel(b)} · ${b.item.course}`, +b.start);
  }
  for (const i of items) {
    if (i.done || i.removed || !i.due) continue;
    const lead = i.due - now;
    if (lead > 0 && lead <= HOUR) add(`d1:${i.id}:${+i.due}`, `Due within an hour: ${i.title}`, `${i.course} · due ${fmtTime(i.due)}`, +i.due);
    else if (lead > HOUR && lead <= DAY) add(`d24:${i.id}:${+i.due}`, `Due in 24 hours: ${i.title}`, `${i.course} · due ${fmtDate(i.due)}`, +i.due);
  }
  if (!pending.length) return;
  pending.sort((a, b) => a.when - b.when); // most urgent first

  // Never more than 2 at once; group the rest into one.
  pending.slice(0, 2).forEach((p) => notify(p.title, p.body));
  if (pending.length > 2) notify(`${pending.length - 2} more reminders`, pending.slice(2).map((p) => p.title).join("\n"));
  pending.forEach((p) => notified.add(p.key));
  saveJSON("notified", [...notified].slice(-500));
}

function notify(title, body) {
  try {
    const n = new Notification(title, { body, icon: "icons/icon-192.png" });
    n.onclick = () => { window.focus(); n.close(); };
  } catch {}
}
