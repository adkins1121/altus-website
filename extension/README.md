# Altus KC Vault — Browser Extension

Capture companies and contacts from any website into a Notion database, using Claude to extract structured data from page content.

## What it does

Click the extension on any company website, team page, or contact page. The extension:
1. Reads the visible page text, meta tags, JSON-LD, and `mailto:`/`tel:` links.
2. Sends a structured prompt to Claude with a JSON schema for `{ company, contacts[] }`.
3. Shows a popup form pre-filled with the extracted data so you can review and edit.
4. On save, creates a page in your Notion "Companies" DB and (optionally) one page per named contact in your "Contacts" DB.

Target browser: Comet (Chromium-based, Manifest V3).

## One-time setup

### 1. Create the Notion databases

Make two databases anywhere in your workspace.

**Companies** (recommended properties — name them exactly):
| Property | Type |
|---|---|
| Name | Title |
| Website | URL |
| Industry | Select *or* Text |
| Description | Text |
| Location | Text |
| Phone | Phone |
| Source URL | URL |

**Contacts** (optional but recommended):
| Property | Type |
|---|---|
| Name | Title |
| Title | Text |
| Email | Email |
| Phone | Phone |
| LinkedIn | URL |
| Company | Text |
| Source URL | URL |

The extension matches properties by name; any property you don't add is silently skipped. The title property is auto-detected regardless of its name.

### 2. Create a Notion integration

1. Go to https://www.notion.so/profile/integrations and click **+ New integration**.
2. Give it a name (e.g. "Altus KC Vault"), select the workspace, and create.
3. Copy the **Internal Integration Secret**.
4. Open each of your two databases in Notion → top-right `•••` → **Connections** → invite your integration. Without this, the API can't see the database.

### 3. Grab the database IDs

Open a database in Notion. The URL looks like:

```
https://www.notion.so/your-workspace/abc123def456...?v=789...
```

The 32-character string before `?v=` is the database ID.

### 4. Get an Anthropic API key

Get one at https://console.anthropic.com — keep it private; it's stored locally in your browser only.

### 5. Load the extension

1. Open Comet → `comet://extensions` (or the equivalent extensions page).
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this `extension/` folder.
4. Click the extension icon → the gear icon → fill in:
   - Anthropic API key
   - Model (Haiku 4.5 is the cheapest; Sonnet 4.6 for higher quality)
   - Notion token
   - Companies DB ID
   - Contacts DB ID (optional)
5. Click **Test connection** to verify everything is wired up.

## Using it

1. Browse to a company site, an "About" page, a team page, or a contact page.
2. Click the extension icon → **Extract from page**.
3. Review and edit the form, add/remove contacts as needed.
4. Click **Save to vault** — you'll see a confirmation when the rows land in Notion.

## Notes

- The extension only sends page content to the Anthropic API when you click **Extract**. Nothing leaves your browser before that.
- API keys are stored in Chrome's `storage.local` (per-profile, never synced).
- Cost per extraction with Haiku 4.5 is ~$0.001–$0.003 depending on page size.
- If a company page doesn't have any named contacts (only `info@`/`sales@`), the extractor returns an empty `contacts` array — that's intentional. Add contacts manually if you want them.

## Tweaking

- **System prompt** — edit `background/service-worker.js`, the `SYSTEM_PROMPT` constant.
- **Output schema** — same file, `EXTRACTION_SCHEMA`. Add a field, then surface it in `popup/popup.html` + `popup/popup.js` and in `saveCompany`/`saveContact`.
- **Add a property to Notion** — just add it to your database with one of the names listed above. The extension picks it up on next save.
