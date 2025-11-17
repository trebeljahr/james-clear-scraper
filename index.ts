import axios from "axios";
import * as cheerio from "cheerio";
import { promises as fs } from "fs";
import { join } from "path";

const __dirname = new URL(".", import.meta.url).pathname;

interface Issue {
  date: string;
  url: string;
  question: string;
}

const BASE = "https://jamesclear.com";
const LISTING_URL = `${BASE}/3-2-1`;
const OUT_FILE = join(__dirname, "questions.json");

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

    const match = href.match(/\/3-2-1\//i);

    if (match) {
      links.push(href);
    }
  });

  return Array.from(new Set(links));
}

async function extractQuestion(issueUrl: string): Promise<string | null> {
  const html = await fetchHtml(issueUrl);
  const $ = cheerio.load(html);

  const heading = $("h2")
    .filter((_, el) =>
      $(el).text().trim().toUpperCase().includes("1 QUESTION FOR YOU")
    )
    .first();

  if (!heading || heading.length === 0) {
    console.warn("No question heading found on", issueUrl);
    return null;
  }

  const questionParts: string[] = [];
  const siblings = heading.nextAll();

  siblings.each((_, el) => {
    const elem = $(el);
    if (!elem.is("p")) {
      return;
    }

    const text = elem.text().trim();
    const lower = text.toLowerCase();

    const isSignOff =
      (lower.startsWith("until next") && lower.includes("james clear")) ||
      lower.startsWith("until next week") ||
      lower.startsWith("until next time") ||
      lower.startsWith("cheers") ||
      !!lower.match(/^sincerely[, ]*james clear/) ||
      !!lower.match(/^yours truly[, ]*james clear/);

    if (isSignOff) {
      return false; // break out of the .each()
    }

    questionParts.push(text);
  });

  if (questionParts.length === 0) {
    console.warn("Found heading but no question paragraphs:", issueUrl);
    return null;
  }

  return questionParts.join("\n\n");
}

function extractDateFromUrl(url: string): string {
  const parts = url.split("/");
  return parts[parts.length - 1]; // e.g. "november-13-2025"
}

async function loadExisting(): Promise<Issue[]> {
  try {
    const data = await fs.readFile(OUT_FILE, { encoding: "utf-8" });
    return JSON.parse(data) as Issue[];
  } catch (err: any) {
    if (err.code === "ENOENT") {
      // File does not exist yet
      return [];
    }
    throw err;
  }
}

async function saveAll(all: Issue[]): Promise<void> {
  await fs.writeFile(OUT_FILE, JSON.stringify(all, null, 2), {
    encoding: "utf-8",
  });
}

async function main() {
  const force = process.argv.includes("--force");

  console.log("Loading existing questions...");
  const existing = await loadExisting();
  const existingByUrl = new Set(existing.map((i) => i.url));

  console.log("Fetching issue links...");
  const issueLinks = await getIssueLinks();

  console.log("Total issues found:", issueLinks.length);

  // Filter links
  const toScrape = issueLinks.filter((url) => {
    return force || !existingByUrl.has(url);
  });

  console.log("Issues to scrape:", toScrape.length);

  const newResults: Issue[] = [];

  for (const url of toScrape) {
    console.log("Processing", url);
    const question = await extractQuestion(url);
    const date = extractDateFromUrl(url);
    newResults.push({ date, url, question: question ?? "" });

    // Be polite / throttle
    await new Promise((r) => setTimeout(r, 50));
  }

  console.log("New issues extracted:", newResults.length);

  const all = force ? newResults : [...existing, ...newResults];

  const allOrdered = all.sort((a, b) => {
    const date1 = new Date(a.date);
    const date2 = new Date(b.date);
    if (date1 < date2) return -1;
    if (date1 > date2) return 1;
    return 0;
  });

  if (newResults.length === 0 && !force) {
    console.log("No new issues to save. Exiting.");
    return;
  }

  await saveAll(allOrdered);

  console.log(`Wrote ${newResults.length} issues to ${OUT_FILE}`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
