// Service worker — handles Claude extraction + Notion writes.
// Receives messages from the popup and dispatches API calls.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const NOTION_VERSION = "2022-06-28";
const MODEL = "claude-haiku-4-5";

const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    company: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string" },
        website: { type: "string" },
        industry: { type: "string" },
        description: { type: "string" },
        location: { type: "string" },
        phone: { type: "string" },
      },
      required: ["name", "website", "industry", "description", "location", "phone"],
    },
    contacts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          title: { type: "string" },
          email: { type: "string" },
          phone: { type: "string" },
          linkedin: { type: "string" },
        },
        required: ["name", "title", "email", "phone", "linkedin"],
      },
    },
  },
  required: ["company", "contacts"],
};

const SYSTEM_PROMPT = `You extract company and contact information from website content for a CRM-style vault.

Rules:
- Return the canonical company on the page, not advertisers or partners.
- For each field, use an empty string "" when not present. Never invent.
- "website" should be the canonical homepage URL (origin), not a deep link.
- "industry" is a short label (e.g. "Logistics", "B2B SaaS", "Healthcare").
- "description" is one sentence about what the company does.
- "location" is "City, State" or "City, Country" if visible.
- Contacts: only include named individuals visible on the page (team page, about page, byline, signature, mailto links). Don't include generic addresses like info@ or sales@ unless no named contact exists; if the only signal is a generic email, skip contacts.
- "title" is job title (e.g. "VP of Sales"), not honorific.`;

async function loadConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      [
        "anthropicKey",
        "notionToken",
        "companiesDbId",
        "contactsDbId",
        "model",
      ],
      (cfg) => resolve(cfg)
    );
  });
}

async function callClaude({ anthropicKey, model, snapshot }) {
  const userContent = [
    `URL: ${snapshot.url}`,
    `Title: ${snapshot.title}`,
    snapshot.description ? `Meta description: ${snapshot.description}` : "",
    snapshot.siteName ? `Site name: ${snapshot.siteName}` : "",
    snapshot.emails.length ? `Mailto links: ${snapshot.emails.join(", ")}` : "",
    snapshot.phones.length ? `Tel links: ${snapshot.phones.join(", ")}` : "",
    snapshot.socialLinks.length ? `Social links: ${snapshot.socialLinks.join(", ")}` : "",
    snapshot.jsonLd.length ? `JSON-LD:\n${JSON.stringify(snapshot.jsonLd).slice(0, 4000)}` : "",
    "",
    "Visible text:",
    snapshot.text || "(no visible text extracted)",
  ]
    .filter(Boolean)
    .join("\n");

  const body = {
    model: model || MODEL,
    max_tokens: 1500,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    output_config: {
      format: {
        type: "json_schema",
        schema: EXTRACTION_SCHEMA,
      },
    },
    messages: [{ role: "user", content: userContent }],
  };

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Claude API ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const textBlock = (data.content || []).find((b) => b.type === "text");
  if (!textBlock) throw new Error("Claude returned no text block");

  let parsed;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch (e) {
    throw new Error(`Could not parse Claude response as JSON: ${textBlock.text.slice(0, 200)}`);
  }
  return parsed;
}

function richText(value) {
  if (!value) return [];
  return [{ type: "text", text: { content: String(value).slice(0, 2000) } }];
}

function titleProp(value) {
  return { title: richText(value) };
}

function urlOrNull(value) {
  if (!value) return { url: null };
  const trimmed = String(value).trim();
  if (!/^https?:\/\//i.test(trimmed)) return { url: null };
  return { url: trimmed };
}

function emailOrNull(value) {
  if (!value) return { email: null };
  return { email: String(value).trim() };
}

function phoneOrNull(value) {
  if (!value) return { phone_number: null };
  return { phone_number: String(value).trim() };
}

function selectOrNull(value) {
  if (!value) return { select: null };
  return { select: { name: String(value).slice(0, 100) } };
}

async function notionFetch(token, path, init = {}) {
  const res = await fetch(`https://api.notion.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Notion API ${res.status}: ${errText}`);
  }
  return res.json();
}

// Build property payload conditionally — only include properties whose
// types match the user's database schema. Detect schema once and cache it.
const schemaCache = new Map();

async function getDbSchema(token, dbId) {
  if (schemaCache.has(dbId)) return schemaCache.get(dbId);
  const db = await notionFetch(token, `/v1/databases/${dbId}`);
  const props = {};
  for (const [name, def] of Object.entries(db.properties || {})) {
    props[name] = def.type;
  }
  schemaCache.set(dbId, props);
  return props;
}

function buildProps(schema, fields) {
  const out = {};
  for (const [name, builder] of Object.entries(fields)) {
    const type = schema[name];
    if (!type) continue;
    const value = builder(type);
    if (value !== undefined) out[name] = value;
  }
  return out;
}

async function saveCompany({ token, dbId, company, sourceUrl }) {
  const schema = await getDbSchema(token, dbId);
  // Find the title property (Notion DBs have exactly one).
  const titleKey = Object.keys(schema).find((k) => schema[k] === "title") || "Name";

  const props = {
    [titleKey]: titleProp(company.name || "Unknown company"),
  };

  const setIf = (key, type, value) => {
    if (schema[key] !== type) return;
    props[key] = value;
  };

  setIf("Website", "url", urlOrNull(company.website || sourceUrl));
  setIf("Industry", "select", selectOrNull(company.industry));
  setIf("Industry", "rich_text", { rich_text: richText(company.industry) });
  setIf("Description", "rich_text", { rich_text: richText(company.description) });
  setIf("Location", "rich_text", { rich_text: richText(company.location) });
  setIf("Phone", "phone_number", phoneOrNull(company.phone));
  setIf("Source URL", "url", urlOrNull(sourceUrl));

  const created = await notionFetch(token, "/v1/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: { database_id: dbId },
      properties: props,
    }),
  });
  return created.id;
}

async function saveContact({ token, dbId, contact, companyName, sourceUrl }) {
  const schema = await getDbSchema(token, dbId);
  const titleKey = Object.keys(schema).find((k) => schema[k] === "title") || "Name";

  const props = {
    [titleKey]: titleProp(contact.name || "Unknown contact"),
  };

  const setIf = (key, type, value) => {
    if (schema[key] !== type) return;
    props[key] = value;
  };

  setIf("Title", "rich_text", { rich_text: richText(contact.title) });
  setIf("Email", "email", emailOrNull(contact.email));
  setIf("Phone", "phone_number", phoneOrNull(contact.phone));
  setIf("LinkedIn", "url", urlOrNull(contact.linkedin));
  setIf("Company", "rich_text", { rich_text: richText(companyName) });
  setIf("Source URL", "url", urlOrNull(sourceUrl));

  const created = await notionFetch(token, "/v1/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: { database_id: dbId },
      properties: props,
    }),
  });
  return created.id;
}

async function handleExtract(snapshot) {
  const cfg = await loadConfig();
  if (!cfg.anthropicKey) throw new Error("Missing Anthropic API key. Open the extension options to set it.");
  return callClaude({ anthropicKey: cfg.anthropicKey, model: cfg.model, snapshot });
}

async function handleSave({ company, contacts, sourceUrl }) {
  const cfg = await loadConfig();
  if (!cfg.notionToken) throw new Error("Missing Notion token. Open the extension options to set it.");
  if (!cfg.companiesDbId) throw new Error("Missing Companies database ID. Open the extension options to set it.");

  const companyId = await saveCompany({
    token: cfg.notionToken,
    dbId: cfg.companiesDbId,
    company,
    sourceUrl,
  });

  const contactIds = [];
  if (Array.isArray(contacts) && contacts.length && cfg.contactsDbId) {
    for (const c of contacts) {
      if (!c.name && !c.email) continue;
      try {
        const id = await saveContact({
          token: cfg.notionToken,
          dbId: cfg.contactsDbId,
          contact: c,
          companyName: company.name,
          sourceUrl,
        });
        contactIds.push(id);
      } catch (e) {
        console.error("Failed to save contact", c, e);
      }
    }
  }

  return { companyId, contactIds, skippedContacts: !cfg.contactsDbId ? contacts.length : 0 };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === "EXTRACT") {
        const data = await handleExtract(msg.snapshot);
        sendResponse({ ok: true, data });
      } else if (msg.type === "SAVE") {
        const data = await handleSave(msg.payload);
        sendResponse({ ok: true, data });
      } else if (msg.type === "CLEAR_SCHEMA_CACHE") {
        schemaCache.clear();
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, error: `Unknown message type: ${msg.type}` });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e.message || String(e) });
    }
  })();
  return true; // keep channel open for async response
});
