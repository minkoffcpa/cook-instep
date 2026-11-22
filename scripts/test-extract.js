// Usage: node scripts/test-extract.js <recipe url>
// Shows what the converter would send to the AI for a web link (no AI call, no cost).
import { fetchRecipePage } from "../lib/extract.js";
const url = process.argv[2];
if (!url) { console.error("Give a recipe URL"); process.exit(1); }
const page = await fetchRecipePage(url);
console.log("kind:", page.kind, "| chars:", page.content.length, page.truncated ? "(truncated)" : "");
console.log(page.content.slice(0, 1500));
