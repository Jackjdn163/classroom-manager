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
| Missing | Past due and not turned in | Most overdue first, then most points. Hide one with its **Hide** button, or all with **Show missing** |
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
