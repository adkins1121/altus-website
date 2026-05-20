# sync-doc-rooms

Adds new doc rooms to the Notion **Document Hub** database whenever an HTML file
matching `share/*.html` is added on a push to `main`.

A "doc room" is any top-level HTML file under `share/` that is not a
`-print.html` variant.

## One-time setup

1. In Notion, create an internal integration and copy its token:
   https://www.notion.so/profile/integrations
2. Open the **Document Hub** database in Notion → `...` menu → **Connections**
   → add the integration so it has write access.
3. In GitHub, add the token as a repository secret named `NOTION_TOKEN`
   (Settings → Secrets and variables → Actions → New repository secret).

The data source ID and base URL are hard-coded in
`.github/workflows/sync-doc-rooms.yml`; update them there if either changes.

## How it works

- Workflow: `.github/workflows/sync-doc-rooms.yml` triggers on pushes to `main`
  that touch `share/*.html`.
- `tj-actions/changed-files` reports newly **added** files (not modifications).
- `scripts/sync-doc-rooms.mjs` parses each added file's `<title>` and meta
  description, then creates a row in the Document Hub with `Drive Link` set to
  `https://altus-kc.com/<path>`.
