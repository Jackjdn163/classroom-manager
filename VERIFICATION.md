# Going public: Google verification guide

Everything to make Classroom Priorities usable by anyone, in order. Copy and paste the answers below into Google Cloud.

Google Cloud project: the one with Client ID `926676130255-p8g7s9m0f3sbmj71a5h7vg33nhmn1e2o.apps.googleusercontent.com`
(console.cloud.google.com → Google Auth Platform)

---

## 1. Verify you own classroommanager.site (about 10 minutes)

1. Go to <https://search.google.com/search-console> with the **same Google account that owns the Cloud project**.
2. **Add property → Domain** → type `classroommanager.site` → Continue.
3. Google shows a **TXT record** like `google-site-verification=abc123…`. Copy it.
4. Namecheap → Domain List → classroommanager.site → **Manage → Advanced DNS → Add New Record**:
   - Type: **TXT Record**, Host: `@`, Value: *(paste the google-site-verification text)*, TTL: Automatic → ✓ save.
   - Don't touch the 4 GitHub A records or the `www` CNAME.
5. Back in Search Console, click **Verify** (if it fails, wait 10–30 minutes and try again).

## 2. Branding (Google Auth Platform → Branding)

| Field | Value |
|---|---|
| App name | `Classroom Priorities` |
| User support email | `jjordan@ucvts.org` (must be an email you can choose in the list: your account, or a Google Group you manage) |
| App logo | upload `icons/logo-120.png` from this folder (120×120 PNG) |
| Application home page | `https://classroommanager.site/about.html` |
| Application privacy policy link | `https://classroommanager.site/privacy.html` |
| Application terms of service link | `https://classroommanager.site/terms.html` |
| Authorized domains | `classroommanager.site` |
| Developer contact information | `jjordan@ucvts.org` |

Also check **Clients → your Web client → Authorized JavaScript origins** contains `https://classroommanager.site` (and `http://localhost:8000` for testing).

## 3. Data Access (Google Auth Platform → Data Access → Add or remove scopes)

Add exactly these seven scopes. For each sensitive one, paste the justification.

**Non-sensitive** (no justification needed):
- `.../auth/userinfo.email`
- `.../auth/userinfo.profile`

**`https://www.googleapis.com/auth/classroom.courses.readonly`**
> Classroom Priorities is a homework planner for students. It lists the student's active Google Classroom classes so it can load each class's assignments, show class names and colors next to assignments, and match classes to the student's class schedule. The app only reads; it never creates or changes classes. Data is processed in the user's browser and never sent to our servers (the app has no server).

**`https://www.googleapis.com/auth/classroom.coursework.me.readonly`**
> The core feature: the app reads the student's own assignments (titles, due dates, points, links) and their own submission status (turned in, returned, missing) to rank work by urgency, show what is missing, and build a weekly study plan that finishes each assignment before it is due. Returned grades are shown next to completed work. The app only reads the student's own coursework and never turns in, edits or deletes anything. Data stays in the user's browser.

**`https://www.googleapis.com/auth/calendar.readonly`**
> Users can choose which of their Google Calendars to show next to their assignments in the app's month and week views. Timed events from chosen calendars (for example sports or appointments) are treated as busy so the study plan doesn't schedule homework during them. Read-only; the app never changes the user's existing calendars. Data stays in the user's browser.

**`https://www.googleapis.com/auth/tasks.readonly`** *(requested only when the user clicks "Import from Google Tasks")*
> Optional feature: when the user clicks "Import from Google Tasks", the app lists their unfinished Google Tasks so they can pick which ones to add to their planner as assignments, with the task's due date. Read-only. Requested only when the user uses this feature (incremental authorization). Data stays in the user's browser.

**`https://www.googleapis.com/auth/calendar.app.created`** *(requested only when the user clicks "Sync to Google Calendar")*
> Optional feature: when the user clicks "Sync to Google Calendar", the app creates a secondary calendar named "Study Plan" and adds their planned study sessions to it with a 10-minute reminder, so they get reminders on their phone. Re-syncing replaces the upcoming sessions on that calendar only. This narrow scope only allows access to calendars the app itself created, so the app cannot see or change the user's other calendars. Requested only when the user uses this feature.

## 4. Demo video (upload to YouTube as **Unlisted**, about 3 minutes)

Record your screen (on a Mac: ⌘⇧5 → Record Entire Screen) in **English**, with the address bar visible:

1. Open `https://classroommanager.site`, then scroll to the footer and click **Privacy policy** (shows it's linked from the home page). Go back.
2. Open the **profile menu → Sign in with Google**. **Slow down on the consent screen:** show the URL bar (it contains the Client ID `926676130255-…`), the app name **Classroom Priorities**, and every permission listed. Click Continue.
3. **classroom.courses.readonly / classroom.coursework.me.readonly:** show the assignment list loading (class names, due dates, Missing / Due in 48 hrs groups), click **Open ↗** on one assignment to show it opens in Classroom, and point out a missing one.
4. **calendar.readonly:** Calendar → ⋯ → **Calendars**, tick one of your calendars, show its events in Month and Week view, then click **Update my plan** and show study sessions placed around those events.
5. **userinfo.profile / email:** show your picture on the profile button and your name and email in the profile menu.
6. **tasks.readonly:** **+ Add assignment → Import from Google Tasks…**, approve the extra permission when Google asks (show that screen), pick a task, and show it in the list.
7. **calendar.app.created:** in the plan, **More ▾ → Sync to Google Calendar**, approve the permission, then open Google Calendar in a new tab and show the new **Study Plan** calendar with the sessions.
8. End by showing **Sign out** and mentioning access can be removed at myaccount.google.com/connections.

Paste the YouTube link into the verification form.

## 5. Publish and submit

1. **Google Auth Platform → Audience → Publishing status → Publish app** (switches from Testing to In production).
2. Go to **Verification Center** → **Prepare for verification** → review everything → **Submit**.
3. Watch **jjordan@ucvts.org** for emails from Google's Trust & Safety team and reply quickly; they often ask small follow-up questions. It usually takes **a few days to a few weeks**.

Until approved, people can still sign in but see "Google hasn't verified this app" (Advanced → Go to Classroom Priorities). Up to 100 users can sign in this way.

## 6. Schools: ask IT to allow the app

Many school accounts (especially students under 18) block apps until the school's Google Workspace admin allows them. Send this to a school's IT department:

> Subject: Request to allow "Classroom Priorities" for students
>
> Hi, I'd like students to be able to use Classroom Priorities (https://classroommanager.site), a free homework planner that reads a student's own Google Classroom assignments and builds a study plan. It is read-only for Classroom, runs entirely in the browser (no server, no data collection), and its privacy policy is at https://classroommanager.site/privacy.html.
>
> To allow it: Google Admin console → Security → Access and data control → API controls → Manage Third-Party App Access → Add app → OAuth App Name or Client ID → enter
> `926676130255-p8g7s9m0f3sbmj71a5h7vg33nhmn1e2o.apps.googleusercontent.com`
> → choose the student OU → **Trusted** (or **Specific Google data** with Classroom and Calendar).
>
> Thank you!

## After launch

- **Usage limits:** Google Cloud → APIs & Services → Classroom API → Quotas. If many people use it, request a higher quota (free).
- **Changes to permissions:** if you ever add a new Google permission, update the privacy policy and re-submit verification.
- **Legal:** the privacy policy and terms are written for how the app actually works (no server, data in the browser). They aren't legal advice; if it grows a lot or schools ask for a student-data agreement, have someone qualified review them.
