# Instep Recipes

Recipes with the amount of each ingredient written into the step where it's used, so you never scroll back to the ingredient list.

## What's here

| Path | What it is |
|---|---|
| `public/index.html` | The app: import a recipe by link, photos or pasted text; cook view with inline amounts; batch scaling; grocery list |
| `public/mockup.html` | The original macaroni salad mockup |
| `api/convert.js` | Server function (Vercel) that sends the recipe to Claude and returns it in Instep format |
| `lib/prompt.js` | Instructions and output format for the conversion |
| `lib/extract.js` | Reads recipe web pages (uses the site's built-in recipe data when present) |
| `scripts/test-extract.js` | `node scripts/test-extract.js <url>` shows what a link import would read, without calling the AI |

## Setup

Hosted on Vercel. One environment variable is required: `ANTHROPIC_API_KEY`.

Recipes and the grocery list are stored in the phone's browser for now (no accounts or database yet).

## Known limits

- Some publishers (Allrecipes, Serious Eats, Simply Recipes and other Dotdash Meredith sites) block automated readers. The app switches to Paste for those.
