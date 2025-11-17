import axios from "axios";
import * as cheerio from "cheerio";
import { writeFileSync } from "fs";
import { join } from "path";

const __dirname = new URL(".", import.meta.url).pathname;

interface Issue {
  date: string;
  url: string;
  question: string;
}

const BASE = "https://jamesclear.com";
const LISTING_URL = `${BASE}/3-2-1`;

async function fetchHtml(url: string): Promise<string> {
  const resp = await axios.get(url);
  return resp.data;
}

async function getIssueLinks(): Promise<string[]> {
  const html = await fetchHtml(LISTING_URL);
  const $ = cheerio.load(html);
  const links: string[] = [];

  $("a").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    console.log("Found link:", href);

    const match = href.match(/\/3-2-1/i);

    if (match) {
      links.push(href);
    }
  });

  return Array.from(new Set(links));
}

async function extractQuestion(issueUrl: string): Promise<string | null> {
  const html = await fetchHtml(issueUrl);
  const $ = cheerio.load(html);

  // Find the heading "1 QUESTION FOR YOU" (case-insensitive)
  const heading = $("h2")
    .filter((_, el) => {
      return $(el).text().trim().toUpperCase().includes("1 QUESTION FOR YOU");
    })
    .first();

  if (!heading || heading.length === 0) {
    console.warn("No question heading found on", issueUrl);
    return null;
  }

  // The question is likely in the next <p>
  const p = heading.nextAll("p").first();
  if (!p || p.length === 0) {
    console.warn("No paragraph after heading on", issueUrl);
    return null;
  }

  const text = p.text().trim();
  return text;
}

function extractDateFromUrl(url: string): string {
  // Example: https://jamesclear.com/3-2-1/november-13-2025
  const parts = url.split("/");
  const last = parts[parts.length - 1];

  return last || ""; // e.g. "november-13-2025"
}

async function main() {
  console.log("Fetching issue links...");
  const issueLinks = await getIssueLinks();
  console.log("Found", issueLinks.length, "issues");

  const results: Issue[] = [];

  for (const url of issueLinks) {
    console.log("Processing", url);
    const question = await extractQuestion(url);

    const date = extractDateFromUrl(url);
    console.log("Extracted question:", question, "for date:", date);

    results.push({ date, url, question: question ?? "" });
    // Optional: add a short delay to be polite
    await new Promise((r) => setTimeout(r, 200)); // 200ms
  }

  // Write to a file in the same folder as this script
  const outPath = join(__dirname, "..", "questions.json");
  writeFileSync(outPath, JSON.stringify(results, null, 2), {
    encoding: "utf-8",
  });

  console.log("Done! Wrote", results.length, "questions to", outPath);
}

main().catch((err) => {
  console.error("Error in scraper:", err);
  process.exit(1);
});
