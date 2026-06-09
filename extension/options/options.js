const FIELDS = ["anthropicKey", "notionToken", "companiesDbId", "contactsDbId", "model"];

const els = Object.fromEntries(FIELDS.map((f) => [f, document.getElementById(f)]));
const status = document.getElementById("status");
const saveBtn = document.getElementById("saveBtn");
const testBtn = document.getElementById("testBtn");

function setStatus(message, kind) {
  status.textContent = message;
  status.classList.remove("hidden", "ok", "error");
  status.classList.add(kind);
}

function clearStatus() {
  status.classList.add("hidden");
}

function normalizeDbId(raw) {
  if (!raw) return "";
  return raw.trim().replace(/-/g, "").toLowerCase();
}

function loadSettings() {
  chrome.storage.local.get(FIELDS, (cfg) => {
    for (const f of FIELDS) {
      if (cfg[f] !== undefined) els[f].value = cfg[f];
    }
    if (!els.model.value) els.model.value = "claude-haiku-4-5";
  });
}

function saveSettings() {
  clearStatus();
  const payload = {
    anthropicKey: els.anthropicKey.value.trim(),
    notionToken: els.notionToken.value.trim(),
    companiesDbId: normalizeDbId(els.companiesDbId.value),
    contactsDbId: normalizeDbId(els.contactsDbId.value),
    model: els.model.value,
  };

  if (payload.companiesDbId && payload.companiesDbId.length !== 32) {
    setStatus("Companies database ID must be 32 hex characters.", "error");
    return;
  }
  if (payload.contactsDbId && payload.contactsDbId.length !== 32) {
    setStatus("Contacts database ID must be 32 hex characters.", "error");
    return;
  }

  chrome.storage.local.set(payload, () => {
    // Force schema cache refresh in the worker.
    chrome.runtime.sendMessage({ type: "CLEAR_SCHEMA_CACHE" }, () => {});
    setStatus("Settings saved.", "ok");
  });
}

async function testConnection() {
  clearStatus();
  testBtn.disabled = true;
  testBtn.textContent = "Testing…";

  const cfg = {
    anthropicKey: els.anthropicKey.value.trim(),
    notionToken: els.notionToken.value.trim(),
    companiesDbId: normalizeDbId(els.companiesDbId.value),
    contactsDbId: normalizeDbId(els.contactsDbId.value),
  };

  const errors = [];

  if (cfg.anthropicKey) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/models", {
        headers: {
          "x-api-key": cfg.anthropicKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
      });
      if (!res.ok) errors.push(`Anthropic: ${res.status} ${res.statusText}`);
    } catch (e) {
      errors.push(`Anthropic: ${e.message}`);
    }
  } else {
    errors.push("Anthropic: missing API key");
  }

  if (cfg.notionToken && cfg.companiesDbId) {
    try {
      const res = await fetch(`https://api.notion.com/v1/databases/${cfg.companiesDbId}`, {
        headers: {
          Authorization: `Bearer ${cfg.notionToken}`,
          "Notion-Version": "2022-06-28",
        },
      });
      if (!res.ok) errors.push(`Notion (Companies DB): ${res.status} — make sure the integration is invited to this database.`);
    } catch (e) {
      errors.push(`Notion (Companies DB): ${e.message}`);
    }
  } else if (!cfg.notionToken) {
    errors.push("Notion: missing token");
  } else {
    errors.push("Notion: missing Companies DB ID");
  }

  if (cfg.notionToken && cfg.contactsDbId) {
    try {
      const res = await fetch(`https://api.notion.com/v1/databases/${cfg.contactsDbId}`, {
        headers: {
          Authorization: `Bearer ${cfg.notionToken}`,
          "Notion-Version": "2022-06-28",
        },
      });
      if (!res.ok) errors.push(`Notion (Contacts DB): ${res.status} — make sure the integration is invited.`);
    } catch (e) {
      errors.push(`Notion (Contacts DB): ${e.message}`);
    }
  }

  testBtn.disabled = false;
  testBtn.textContent = "Test connection";

  if (errors.length) {
    setStatus(`Some checks failed:\n• ${errors.join("\n• ")}`, "error");
  } else {
    setStatus("All connections look good.", "ok");
  }
}

saveBtn.addEventListener("click", saveSettings);
testBtn.addEventListener("click", testConnection);
document.addEventListener("DOMContentLoaded", loadSettings);
