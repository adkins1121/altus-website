// Runs in the page context on demand via chrome.scripting.executeScript.
// Returns a structured snapshot of useful signals on the page.
(function extractPageSnapshot() {
  const MAX_TEXT = 12000;

  const meta = (name) => {
    const el =
      document.querySelector(`meta[name="${name}"]`) ||
      document.querySelector(`meta[property="${name}"]`);
    return el ? el.getAttribute("content") : null;
  };

  const jsonLd = [];
  document.querySelectorAll('script[type="application/ld+json"]').forEach((el) => {
    try {
      const parsed = JSON.parse(el.textContent);
      jsonLd.push(parsed);
    } catch (_) {}
  });

  const mailtos = new Set();
  const tels = new Set();
  const socials = new Set();
  document.querySelectorAll("a[href]").forEach((a) => {
    const href = a.getAttribute("href") || "";
    if (href.startsWith("mailto:")) {
      mailtos.add(href.replace(/^mailto:/, "").split("?")[0].trim());
    } else if (href.startsWith("tel:")) {
      tels.add(href.replace(/^tel:/, "").trim());
    } else if (/linkedin\.com|twitter\.com|x\.com|facebook\.com|instagram\.com/i.test(href)) {
      socials.add(href);
    }
  });

  let text = "";
  const main = document.querySelector("main") || document.body;
  if (main) {
    text = main.innerText.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT) + "\n…[truncated]";
  }

  return {
    url: location.href,
    title: document.title,
    description: meta("description") || meta("og:description"),
    siteName: meta("og:site_name"),
    metaTags: {
      ogTitle: meta("og:title"),
      ogType: meta("og:type"),
      author: meta("author"),
    },
    jsonLd,
    emails: Array.from(mailtos),
    phones: Array.from(tels),
    socialLinks: Array.from(socials),
    text,
  };
})();
