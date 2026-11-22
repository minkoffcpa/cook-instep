// Fetches a recipe web page and pulls out the recipe.
// Most recipe sites embed a schema.org "Recipe" object (JSON-LD) for Google;
// when it's there we send only that, which is cleaner and cheaper than the whole page.

const MAX_PAGE_CHARS = 200_000;

export function checkUrl(raw) {
  let url;
  try {
    url = new URL(String(raw).trim());
  } catch {
    throw new UserError("That doesn't look like a web address. Copy the full link, starting with https://");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new UserError("Only web links (https://...) can be imported.");
  }
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^[\d.]+$/.test(host) ||
    host.includes(":")
  ) {
    throw new UserError("That address can't be imported. Use the recipe's normal web link.");
  }
  return url;
}

export async function fetchRecipePage(raw) {
  const url = checkUrl(raw);
  let res;
  try {
    res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; InstepRecipes/0.1; recipe importer)",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
  } catch {
    throw new UserError("Couldn't reach that website. Check the link, or copy the recipe text and use Paste instead.");
  }
  if (!res.ok) {
    throw new UserError(
      `The website refused the request (error ${res.status}). Some sites block apps from reading them. Copy the recipe text and use Paste instead.`
    );
  }
  const html = await res.text();

  const recipe = findJsonLdRecipe(html);
  if (recipe) {
    return { kind: "structured", url: url.href, content: JSON.stringify(trimRecipe(recipe), null, 1) };
  }

  const text = htmlToText(html);
  if (text.length < 200) {
    throw new UserError("That page didn't have readable recipe text. Copy the recipe and use Paste instead.");
  }
  return {
    kind: "page-text",
    url: url.href,
    content: text.slice(0, MAX_PAGE_CHARS),
    truncated: text.length > MAX_PAGE_CHARS,
  };
}

export function findJsonLdRecipe(html) {
  const re = /<script[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    let data;
    try {
      data = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const found = searchForRecipe(data);
    if (found) return found;
  }
  return null;
}

function searchForRecipe(node, depth = 0) {
  if (!node || typeof node !== "object" || depth > 6) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const r = searchForRecipe(item, depth + 1);
      if (r) return r;
    }
    return null;
  }
  const type = node["@type"];
  const types = Array.isArray(type) ? type : [type];
  if (types.includes("Recipe") && (node.recipeIngredient || node.recipeInstructions)) return node;
  for (const key of ["@graph", "mainEntity", "itemListElement"]) {
    if (node[key]) {
      const r = searchForRecipe(node[key], depth + 1);
      if (r) return r;
    }
  }
  return null;
}

function trimRecipe(r) {
  const keep = [
    "name", "description", "recipeYield", "prepTime", "cookTime", "totalTime",
    "recipeIngredient", "recipeInstructions", "recipeCategory", "recipeCuisine",
  ];
  const out = {};
  for (const k of keep) if (r[k] != null) out[k] = r[k];
  return out;
}

export function htmlToText(html) {
  return html
    .replace(/<(script|style|noscript|svg|nav|footer|header|aside|form|iframe)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

export class UserError extends Error {}
