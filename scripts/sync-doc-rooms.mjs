#!/usr/bin/env node
// Syncs newly added doc room HTML files under share/ to the Notion Document Hub.
//
// A "doc room" is a top-level HTML file in share/ (e.g. share/walmart-miiplan.html)
// that is NOT a -print.html variant and NOT nested in a subdirectory.
//
// For each new file we extract the <title> and meta description, then create a row
// in the Document Hub data source with Drive Link pointing at BASE_URL + relative path.
//
// Env:
//   NOTION_TOKEN          Notion integration token with access to the Document Hub
//   NOTION_DATA_SOURCE_ID Data source ID for the Document Hub
//   BASE_URL              Public base URL for the site (no trailing slash)
//   ADDED_FILES           Newline-separated list of files added in the push
//                         (produced by tj-actions/changed-files)

import { readFileSync } from "node:fs";
import { basename } from "node:path";

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DATA_SOURCE_ID = process.env.NOTION_DATA_SOURCE_ID;
const BASE_URL = (process.env.BASE_URL || "").replace(/\/+$/, "");
const ADDED_FILES = process.env.ADDED_FILES || "";

if (!NOTION_TOKEN || !DATA_SOURCE_ID || !BASE_URL) {
  console.error("Missing NOTION_TOKEN, NOTION_DATA_SOURCE_ID, or BASE_URL");
  process.exit(1);
}

const docRoomFiles = ADDED_FILES.split(/\r?\n/)
  .map((f) => f.trim())
  .filter(
    (f) =>
      /^share\/[^/]+\.html$/.test(f) && !/-print\.html$/.test(basename(f)),
  );

if (docRoomFiles.length === 0) {
  console.log("No new doc rooms detected.");
  process.exit(0);
}

const decodeEntities = (s) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–");

const extractMeta = (html) => {
  const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
  const descMatch = html.match(
    /<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i,
  );
  return {
    title: titleMatch ? decodeEntities(titleMatch[1].trim()) : null,
    description: descMatch ? decodeEntities(descMatch[1].trim()) : "",
  };
};

const createPage = async (file) => {
  const html = readFileSync(file, "utf8");
  const { title, description } = extractMeta(html);
  const name = title || basename(file, ".html");
  const link = `${BASE_URL}/${file}`;

  const body = {
    parent: { data_source_id: DATA_SOURCE_ID },
    properties: {
      "Doc name": { title: [{ text: { content: name } }] },
      "Drive Link": { url: link },
    },
    children: description
      ? [
          {
            object: "block",
            type: "paragraph",
            paragraph: {
              rich_text: [{ type: "text", text: { content: description } }],
            },
          },
          {
            object: "block",
            type: "paragraph",
            paragraph: {
              rich_text: [
                {
                  type: "text",
                  text: { content: "Open doc room", link: { url: link } },
                },
              ],
            },
          },
        ]
      : [
          {
            object: "block",
            type: "paragraph",
            paragraph: {
              rich_text: [
                {
                  type: "text",
                  text: { content: "Open doc room", link: { url: link } },
                },
              ],
            },
          },
        ],
  };

  const res = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      "Notion-Version": "2025-09-03",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Notion API ${res.status}: ${text}`);
  }
  const json = await res.json();
  console.log(`Created Notion page for ${file} -> ${json.url}`);
};

for (const file of docRoomFiles) {
  await createPage(file);
}
