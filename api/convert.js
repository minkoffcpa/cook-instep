// POST /api/convert
// Body (JSON), one of:
//   { "url": "https://..." }
//   { "text": "pasted recipe..." }
//   { "images": [{ "media_type": "image/jpeg", "data": "<base64>" }, ...] }
// Returns { recipe, source } or { error }.

import Anthropic from "@anthropic-ai/sdk";
import { fetchRecipePage, UserError } from "../lib/extract.js";
import { SYSTEM_PROMPT, RECIPE_SCHEMA } from "../lib/prompt.js";

const client = new Anthropic();
const MAX_IMAGES = 6;
const MAX_TEXT_CHARS = 100_000;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST." });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const { content, source } = await buildInput(body);

    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: RECIPE_SCHEMA },
      },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content }],
    });

    if (response.stop_reason === "refusal") {
      return res.status(422).json({ error: "The AI declined to process this. Try a different recipe or paste just the recipe text." });
    }
    if (response.stop_reason === "max_tokens") {
      return res.status(422).json({ error: "This recipe was too long to convert in one go. Try importing one recipe at a time." });
    }

    const textBlock = response.content.find((b) => b.type === "text");
    const recipe = textBlock ? JSON.parse(textBlock.text) : null;
    if (!recipe) throw new Error("No recipe in response");
    if (!recipe.is_recipe) {
      return res.status(422).json({ error: `That doesn't look like a recipe (it looked like: ${recipe.title}).` });
    }

    if (source.truncated) {
      recipe.warnings.unshift("The web page was very long, so only the first part was read. Check that nothing is missing.");
    }

    console.log("convert ok", {
      source: source.kind,
      input_tokens: response.usage?.input_tokens,
      output_tokens: response.usage?.output_tokens,
    });
    return res.status(200).json({ recipe, source: { kind: source.kind, url: source.url ?? null } });
  } catch (err) {
    if (err instanceof UserError) return res.status(400).json({ error: err.message });
    if (err instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: "Too many conversions at once. Wait a minute and try again." });
    }
    if (err instanceof Anthropic.AuthenticationError) {
      console.error("Anthropic auth error: check ANTHROPIC_API_KEY in Vercel settings");
      return res.status(500).json({ error: "The app's AI key isn't set up correctly." });
    }
    if (err instanceof Anthropic.APIError) {
      console.error("Anthropic API error", err.status, err.message);
      return res.status(502).json({ error: "The AI service had a problem. Try again in a moment." });
    }
    console.error("convert failed", err);
    return res.status(500).json({ error: "Something went wrong converting this recipe. Try again." });
  }
}

async function buildInput(body) {
  if (body.url) {
    const page = await fetchRecipePage(body.url);
    const intro =
      page.kind === "structured"
        ? `Here is the recipe data from ${page.url}:`
        : `Here is the text of the web page ${page.url}. Find the recipe in it and ignore everything else on the page (stories, ads, comments, other recipes):`;
    return {
      source: page,
      content: [{ type: "text", text: `${intro}\n\n${page.content}` }],
    };
  }

  if (body.text) {
    const text = String(body.text).trim();
    if (text.length < 40) throw new UserError("That's too short to be a recipe. Paste the whole recipe, including the ingredients.");
    if (text.length > MAX_TEXT_CHARS) throw new UserError("That's too much text. Paste just one recipe.");
    return {
      source: { kind: "text" },
      content: [{ type: "text", text: `Here is a recipe the user pasted:\n\n${text}` }],
    };
  }

  if (Array.isArray(body.images) && body.images.length) {
    if (body.images.length > MAX_IMAGES) throw new UserError(`Use at most ${MAX_IMAGES} photos per recipe.`);
    const blocks = body.images.map((img, i) => {
      if (!IMAGE_TYPES.has(img?.media_type) || typeof img?.data !== "string") {
        throw new UserError(`Photo ${i + 1} isn't a supported image.`);
      }
      return { type: "image", source: { type: "base64", media_type: img.media_type, data: img.data } };
    });
    const n = blocks.length;
    return {
      source: { kind: "photos" },
      content: [
        ...blocks,
        {
          type: "text",
          text:
            n === 1
              ? "This is a photo of a cookbook page. Convert the recipe on it."
              : `These are ${n} photos of cookbook pages, in order. Together they hold one recipe. Convert it.`,
        },
      ],
    };
  }

  throw new UserError("Add a link, some recipe text, or a photo.");
}
