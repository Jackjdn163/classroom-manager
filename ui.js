// Line icons for buttons. Any button whose label starts with one of these emoji gets the
// matching icon instead; the emoji stays in the text (hidden) so labels don't change.

const svg = (body) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const ICONS = {
  settings: svg('<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>'),
  bell: svg('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>'),
  bellOff: svg('<path d="M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 0 .6 5"/><path d="M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="m2 2 20 20"/>'),
  calendar: svg('<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>'),
  play: svg('<path d="M7 4v16l13-8z" fill="currentColor" stroke="none"/>'),
  pause: svg('<rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/>'),
  sparkles: svg('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 17v4M17 19h4"/>'),
  school: svg('<path d="M22 10 12 5 2 10l10 5 10-5Z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>'),
  download: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>'),
  maximize: svg('<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>'),
  minimize: svg('<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/>'),
  check: svg('<path d="M20 6 9 17l-5-5"/>'),
  x: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
  more: svg('<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>'),
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
};

const EMOJI_ICONS = { "⚙": "settings", "🔔": "bell", "🔕": "bellOff", "📅": "calendar", "▶": "play", "❚❚": "pause",
  "✨": "sparkles", "🏫": "school", "⬇": "download", "⤢": "maximize", "⤡": "minimize", "✓": "check", "✕": "x", "⋯": "more" };
const EMOJI_RE = /^(\s*)(⚙️?|🔔|🔕|📅|▶️?|❚❚|✨|🏫|⬇️?|⤢|⤡|✓|✕|⋯)(\s*)/u;

function decorateIcons(root = document.body) {
  for (const b of root.querySelectorAll("button")) {
    const t = b.firstChild;
    if (!t || t.nodeType !== Node.TEXT_NODE) continue;
    const m = t.nodeValue.match(EMOJI_RE);
    if (!m) continue;
    const name = EMOJI_ICONS[m[2].replace(/️/g, "")];
    if (!name) continue;
    t.nodeValue = t.nodeValue.slice(m[0].length);
    const hidden = document.createElement("span");
    hidden.className = "emo";
    hidden.setAttribute("aria-hidden", "true");
    hidden.textContent = m[0];
    const tmp = document.createElement("span");
    tmp.innerHTML = ICONS[name];
    b.insertBefore(tmp.firstChild, t);
    b.insertBefore(hidden, b.firstChild);
    if (!t.nodeValue.trim()) b.classList.add("icon-only");
  }
}

new MutationObserver(() => decorateIcons()).observe(document.documentElement, { childList: true, subtree: true });
document.addEventListener("DOMContentLoaded", () => decorateIcons());
