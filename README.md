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

- **+ Add assignment:** add anything that isn't in Classroom (name, class, due date and time, priority, time needed, notes). Click **Edit** on it to change or delete it.
- **Import from Google Tasks:** in the Add assignment window. Choose which unfinished tasks to add. Each task list becomes the "class", and due dates are set to 11:59 PM.
- **✓ Done:** marks any assignment finished in this app. For Classroom assignments this does **not** turn it in on Classroom.
- **Priority (High / Normal / Low):** High is listed first within its group and planned about a day earlier; Low about a day later.

## Study plan

Click **Make my plan** to fit your unfinished assignments into your free study time:
- **⚙ Study hours:** school days and times, no-school days (holidays), time to start studying on days off, bedtime, how far past bedtime is allowed when needed, the most work on days off, block length and breaks.
- **Calendar events:** timed events on the calendars you've turned on are avoided. All-day events don't block time.
- **Order:** work due in the next 2 days first, then missing work (oldest first), then the rest by due date, adjusted by priority.
- **Adjust it:** click **Edit** on a session to move, resize or delete it, or **+ Study session** to add your own. Check off sessions you finish. Edited and finished sessions are kept when you click **Update my plan**, and their time comes off what's left to plan.
- **Today / This week:** today's sessions and what's due, or a 7-day overview with study time per day and per class. Click a day to open it in the calendar.
- **Sync to Google Calendar:** copies upcoming sessions into a **Study Plan** calendar the app creates, with a reminder 10 minutes before each. Sync again after updating the plan. The app can only change calendars it created.

## Reminders

Click **🔕 Reminders off** to turn on notifications 5 minutes before study sessions and 24 hours and 1 hour before things are due. They only appear while the app is open. For reminders on your phone or when the app is closed, use **Sync to Google Calendar**.

Each assignment shows a **⏱ time estimate** (a guess from its type and points until you change it).

## Google APIs to enable

In Google Cloud → *APIs & Services → Library*, enable: **Google Classroom API**, **Google Calendar API**, and **Google Tasks API** (only needed for importing tasks).

## Install as a Mac app

Open https://classroommanager.site in **Google Chrome**, then click the install icon at the right end of the address bar (or ⋮ menu → *Cast, save and share → Install page as app…*). It gets its own window, Dock icon and Launchpad entry, and opens with your saved data even offline.
