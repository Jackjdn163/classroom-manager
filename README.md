# Classroom Priorities

Shows all your Google Classroom assignments in one ranked list: **missing** first, then **due in 48 hours**, **due this week**, **coming up**, and **no due date**. Every assignment title links straight to it in Classroom.

The app is read-only. It runs in your browser on your own computer, and your data goes straight from Google to your browser.

## Run it

```bash
./start.sh
```

This opens http://localhost:8000. Click **Try demo** to see the layout with sample data before you set anything up.

## One-time setup: get a Google Client ID (about 5 minutes)

1. Go to https://console.cloud.google.com/ and sign in. Create a new project (e.g. "Classroom Priorities").
2. **Turn on the API:** go to *APIs & Services → Library*, search for **Google Classroom API**, and click **Enable**.
3. **Set up the consent screen:** go to *APIs & Services → OAuth consent screen* (also called "Google Auth Platform").
   - User type: **External**. App name: anything. Use your email for the support and contact fields.
   - Under **Audience → Test users**, add the Google account you use for Classroom (usually your school email).
4. **Create the Client ID:** go to *APIs & Services → Credentials → Create credentials → OAuth client ID*.
   - Application type: **Web application**
   - Authorized JavaScript origins: `http://localhost:8000`
   - Click Create and copy the Client ID.
5. Paste the Client ID into `config.js`, then reload the page and click **Sign in with Google**.

When Google says "Google hasn't verified this app", click **Continue**. You're the developer, so this is expected.

## How it ranks things

| Tier | Rule | Order within the tier |
|---|---|---|
| Missing | Past due and not turned in | Most overdue first, then most points. Turn off all of them with **Show missing** |
| Due in 48 hrs | Due within 2 days | Soonest first |
| Due this week | Due within 7 days | Soonest first |
| Coming up | Due later | Soonest first |
| No due date | No due date set | Most points first |
| Done | Turned in or returned | Hidden unless you check "Show completed" |

To change the rules, edit `tierOf()` and `compare()` in `app.js`.

## Troubleshooting

- **"Access blocked" / "admin_policy_enforced" / 403 errors:** many schools block outside apps from reading Classroom data on school accounts. If that happens, ask your school's IT admin to allow the app, or check whether your school allows it at all.
- **"redirect_uri_mismatch" or "origin not allowed":** make sure `http://localhost:8000` is listed exactly under Authorized JavaScript origins. It can take a few minutes after saving to start working.
- **Sign-in expired:** Google tokens last about an hour. Click **Sign in** again.

## Removing assignments

Click **Remove** on any assignment to take it off your list, calendar and counts. Check **Show removed** to see removed items (faded, with a **Restore** button). Removed items are remembered in this browser only.

## Saved data

The app saves your last-loaded assignments, calendar events and filter settings in this browser, so a refresh shows them right away. You stay signed in for about an hour while the tab is open. **Sign out** clears the saved data from the browser. Use it on shared computers.

## Google Calendars

In Calendar view, click **Calendars ▾** and check the Google Calendars to show next to your assignments. This includes calendars you subscribe to. To add a calendar by link (.ics), add it in Google Calendar under *Other calendars → + → From URL*, then click **Refresh**.

This needs the **Google Calendar API** turned on in your Google Cloud project (*APIs & Services → Library → Google Calendar API → Enable*).

## Your own assignments

- **+ Add assignment:** name, class, due date and time, **type** (Homework, Project, Essay, Quiz, Test, Studying, Other), priority, time needed, an optional **link**, notes, an optional **checklist** and **Repeat** (every day, every weekday or every week). Repeating assignments are created two weeks ahead; deleting one copy doesn't bring it back, and **Stop repeating** (in Edit) removes the upcoming copies.
- **✨ Smart Add:** type something like "Bio quiz Friday at 3pm, 2 hours, high priority" and it fills in the form. You can also **scan a photo** of the assignment; the text is read on your device.
- **Import from Google Tasks:** in the Add assignment window.
- **✓ Done:** marks any assignment finished in this app. For Classroom assignments this does **not** turn it in on Classroom.
- **Priority (Urgent / High / Normal / Low):** listed first within its group and planned earlier (Urgent ≈ 2 days, High ≈ 1 day earlier; Low ≈ 1 day later).
- **Checklist (☑ steps):** on any assignment. Use **Suggest steps** for a starting list based on the type. The next unchecked step shows on study sessions and in the Right now card.

## Week view and class schedule

In **Calendar → Week**, you get a big hour-by-hour grid for the week: your **classes** at their real times (with **A Day / B Day** badges), lunch and bus, **study sessions** (click one to edit it), calendar events, busy times and when things are **due**, plus a line for the current time. Work due for a class shows **inside that class's block** on the day it's due (for example "⚑ Due 11:59 PM · Problem Set 4.2" in Thursday's Math block), linked to the assignment. Class names are matched by word, so "Math" matches "Math 3 Honors" and "Spanish" matches "Spanish II". If the class doesn't meet that day, or the name doesn't match, it shows as its own ⚑ marker at the due time. Tip: in 🏫 Class schedule you can pick your exact Classroom class names from the suggestions. The page gets wider in this view. Month view stays as day boxes.

Click **🏫 Class schedule** (in Week view) to set it up:
- **Rotation:** A/B days (alternating each school day, skipping weekends and your no-school days) or the same classes every day. Tell it one day you know was an A or B Day.
- **Class periods:** name, start, end, and the class for A Day and B Day.
- **Lunch, breaks and bus:** shown as dashed blocks.
- If your study hours don't match the schedule, it offers to start study time when your last block ends.

It starts with your old HomeworkPlanner times (8:00–2:50 with lunch 11–12 and the bus until 3:30) and the B Day from your screenshot (Spanish, History, Math, Theatre; Tuesday Oct 13 = B Day). Fill in the A Day classes.

## Right now, focus timer and progress

The **Right now** card shows whether you're on track, your study time over the last 7 days, your **streak** of days in a row with studying, and your top class. It suggests what to work on (the session happening now, the next one today, or your most urgent assignment).

**▶ Start focus timer** opens a full-screen timer with a big countdown ring (the length of the planned session, or what's left of the estimate), the assignment and its next step. The browser tab shows the countdown too. **⤡ Minimize** (or Esc) shrinks it back to the card; **⤢ Full screen** reopens it; Space pauses. **✓ Session done** checks off the planned session; **✓ Log time** (with no planned session) takes the time off that assignment's estimate; **✓ Assignment finished** also marks it done. Checking off sessions in the plan counts toward your streak too.

## Study plan

Click **Make my plan** to fit your unfinished assignments into your free study time:
- **⚙ Settings:** school days and times, no-school days (holidays), time to start studying on days off, bedtime, how far past bedtime is allowed when needed, the most work on days off, a **daily study target** for school days (only exceeded when needed to finish on time), block length, breaks, reminder timing, **class colors**, and **backup / restore**.
- **Busy times:** practices, jobs, clubs or appointments (one time, every day, weekdays or weekly). The plan works around them and they show on the calendar.
- **Calendar events:** timed events on the calendars you've turned on are avoided. All-day events don't block time.
- **This week:** plans today and the next 6 days. Work due after that gets a fair share of this week's time; the rest is planned in later weeks.
- **Spread out:** each assignment is split into sessions (about 30 min or more) on different days, always on the least-busy day available, so nothing gets crammed into one day.
- **Before the due date:** sessions only go on days before the day something is due, never on or after it. Something due today can't be planned, so it's flagged instead. Missing work is spread over the week.
- **Order:** assignments with the fewest days left are planned first; High priority counts as due a day earlier, Low a day later.
- **Adjust it:** click **Edit** on a session to move, resize or delete it, or **+ Study session** to add your own. Check off sessions you finish. Edited and finished sessions are kept when you click **Update my plan**, and their time comes off what's left to plan.
- **Today / This week:** today's sessions and what's due, or a 7-day overview with study time per day and per class. Click a day to open it in the calendar.
- **Sync to Google Calendar:** copies upcoming sessions into a **Study Plan** calendar the app creates, with a reminder 10 minutes before each. Sync again after updating the plan. The app can only change calendars it created.

## Reminders

Click **🔕 Reminders off** to turn on notifications before study sessions (5 minutes by default; change it in Settings) and 24 hours and 1 hour before things are due. They only appear while the app is open. For reminders on your phone or when the app is closed, use **Sync to Google Calendar**.

Each assignment shows a **⏱ time estimate** (a guess from its type and points until you change it).

## Google APIs to enable

In Google Cloud → *APIs & Services → Library*, enable: **Google Classroom API**, **Google Calendar API**, and **Google Tasks API** (only needed for importing tasks).

## Install as a Mac app

Open https://classroommanager.site in **Google Chrome**, then click the install icon at the right end of the address bar (or ⋮ menu → *Cast, save and share → Install page as app…*). It gets its own window, Dock icon and Launchpad entry, and opens with your saved data even offline.

## Settings page

Click **⚙ Settings** (top of the page, or in the plan) for one place with every setting: **Study hours**, **Class schedule**, **Busy times**, which **Google Calendars** to show, **Reminders**, **Google account & sync** (sign in/out, Sync to Google Calendar, import Google Tasks), **Class colors**, and **Backup & restore**. Use the menu on the left to jump to a section and **← Back** to return.

## Backups

Your own assignments, plan, settings, checklists, busy times and study history live only in this browser. In **⚙ Settings → Backup**, download a backup file, and restore it on another device or browser.
