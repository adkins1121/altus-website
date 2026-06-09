const views = {
  initial: document.getElementById("initial-view"),
  loading: document.getElementById("loading-view"),
  form: document.getElementById("form-view"),
  success: document.getElementById("success-view"),
};

const els = {
  extractBtn: document.getElementById("extractBtn"),
  initialError: document.getElementById("initialError"),
  loadingLabel: document.getElementById("loadingLabel"),
  openOptions: document.getElementById("openOptions"),
  c_name: document.getElementById("c_name"),
  c_website: document.getElementById("c_website"),
  c_industry: document.getElementById("c_industry"),
  c_description: document.getElementById("c_description"),
  c_location: document.getElementById("c_location"),
  c_phone: document.getElementById("c_phone"),
  contactsList: document.getElementById("contactsList"),
  addContact: document.getElementById("addContact"),
  formError: document.getElementById("formError"),
  cancelBtn: document.getElementById("cancelBtn"),
  saveBtn: document.getElementById("saveBtn"),
  doneBtn: document.getElementById("doneBtn"),
  successMessage: document.getElementById("successMessage"),
};

let currentTabUrl = null;

function show(view) {
  for (const v of Object.values(views)) v.classList.add("hidden");
  views[view].classList.remove("hidden");
}

function showError(view, message) {
  const target = view === "initial" ? els.initialError : els.formError;
  target.textContent = message;
  target.classList.remove("hidden");
}

function clearError() {
  els.initialError.classList.add("hidden");
  els.formError.classList.add("hidden");
}

function renderContacts(contacts) {
  els.contactsList.innerHTML = "";
  if (!contacts.length) {
    const empty = document.createElement("div");
    empty.className = "empty-contacts";
    empty.textContent = "No contacts extracted. Add one manually if needed.";
    els.contactsList.appendChild(empty);
    return;
  }
  contacts.forEach((c, idx) => els.contactsList.appendChild(buildContactCard(c, idx)));
}

function buildContactCard(contact, index) {
  const card = document.createElement("div");
  card.className = "contact-card";
  card.dataset.index = String(index);

  const fields = [
    ["name", "Name", "text"],
    ["title", "Title", "text"],
    ["email", "Email", "email"],
    ["phone", "Phone", "text"],
    ["linkedin", "LinkedIn", "url"],
  ];
  for (const [key, label, type] of fields) {
    const lbl = document.createElement("label");
    lbl.textContent = label;
    const input = document.createElement("input");
    input.type = type;
    input.value = contact[key] || "";
    input.dataset.field = key;
    lbl.appendChild(input);
    card.appendChild(lbl);
  }

  const removeBtn = document.createElement("button");
  removeBtn.className = "remove";
  removeBtn.textContent = "✕";
  removeBtn.title = "Remove contact";
  removeBtn.addEventListener("click", () => {
    card.remove();
    if (!els.contactsList.querySelector(".contact-card")) renderContacts([]);
  });
  card.appendChild(removeBtn);

  return card;
}

function collectFormData() {
  const company = {
    name: els.c_name.value.trim(),
    website: els.c_website.value.trim(),
    industry: els.c_industry.value.trim(),
    description: els.c_description.value.trim(),
    location: els.c_location.value.trim(),
    phone: els.c_phone.value.trim(),
  };
  const contacts = [];
  els.contactsList.querySelectorAll(".contact-card").forEach((card) => {
    const c = {};
    card.querySelectorAll("input").forEach((input) => {
      c[input.dataset.field] = input.value.trim();
    });
    contacts.push(c);
  });
  return { company, contacts };
}

function fillForm(extracted) {
  const company = extracted.company || {};
  els.c_name.value = company.name || "";
  els.c_website.value = company.website || "";
  els.c_industry.value = company.industry || "";
  els.c_description.value = company.description || "";
  els.c_location.value = company.location || "";
  els.c_phone.value = company.phone || "";

  const contacts = Array.isArray(extracted.contacts) ? extracted.contacts : [];
  renderContacts(contacts);
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function runExtraction() {
  clearError();
  show("loading");
  els.loadingLabel.textContent = "Reading page…";

  let tab;
  try {
    tab = await getActiveTab();
    if (!tab || !tab.id) throw new Error("No active tab");
    currentTabUrl = tab.url || null;

    if (!/^https?:/i.test(tab.url || "")) {
      throw new Error("This page can't be read (browser internal page).");
    }
  } catch (e) {
    show("initial");
    showError("initial", e.message);
    return;
  }

  let snapshot;
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content/content.js"],
    });
    snapshot = result;
    if (!snapshot) throw new Error("Content script returned nothing");
  } catch (e) {
    show("initial");
    showError("initial", `Couldn't read page: ${e.message}`);
    return;
  }

  els.loadingLabel.textContent = "Asking Claude to extract…";
  const response = await chrome.runtime.sendMessage({ type: "EXTRACT", snapshot });
  if (!response || !response.ok) {
    show("initial");
    showError("initial", response?.error || "Extraction failed");
    return;
  }

  fillForm(response.data);
  show("form");
}

async function runSave() {
  clearError();
  const { company, contacts } = collectFormData();
  if (!company.name) {
    showError("form", "Company name is required.");
    return;
  }

  els.saveBtn.disabled = true;
  els.saveBtn.textContent = "Saving…";

  const response = await chrome.runtime.sendMessage({
    type: "SAVE",
    payload: { company, contacts, sourceUrl: currentTabUrl },
  });

  els.saveBtn.disabled = false;
  els.saveBtn.textContent = "Save to vault";

  if (!response || !response.ok) {
    showError("form", response?.error || "Save failed");
    return;
  }

  const { contactIds, skippedContacts } = response.data;
  let msg = `Company saved`;
  if (contactIds.length) msg += ` with ${contactIds.length} contact${contactIds.length === 1 ? "" : "s"}`;
  msg += ".";
  if (skippedContacts > 0) {
    msg += ` (${skippedContacts} contact${skippedContacts === 1 ? "" : "s"} skipped — set a Contacts DB in settings.)`;
  }
  els.successMessage.textContent = msg;
  show("success");
}

els.extractBtn.addEventListener("click", runExtraction);
els.saveBtn.addEventListener("click", runSave);
els.cancelBtn.addEventListener("click", () => {
  clearError();
  show("initial");
});
els.doneBtn.addEventListener("click", () => window.close());
els.addContact.addEventListener("click", () => {
  // If empty-state was rendered, clear it first
  const empty = els.contactsList.querySelector(".empty-contacts");
  if (empty) els.contactsList.innerHTML = "";
  const idx = els.contactsList.querySelectorAll(".contact-card").length;
  els.contactsList.appendChild(buildContactCard({}, idx));
});
els.openOptions.addEventListener("click", () => chrome.runtime.openOptionsPage());
