# Menu App

React + Vite meal planner. Single-page app — one component file, serverless API, Redis storage.

## URLs
- **Production:** `menu-app-teal.vercel.app`
- Preview deploys get a unique hash URL; production alias always stays the same.

## Deploy
```bash
cd "C:/Projects/menu-app"
vercel --prod          # production deploy
```
Linked to GitHub at `github.com/pickles-make-code/menu-app` (branch: main). Push first, then deploy.

## Stack
| Layer | Detail |
|-------|--------|
| Frontend | React 18 + Vite, `src/App.jsx` (~3300 lines, single file) |
| API | Vercel serverless, `api/extract.js` (Claude recipe extraction) + `api/store.js` (Redis R/W) |
| Storage | Upstash Redis via `/api/store`, keyed by household code |
| AI | Anthropic Claude — Haiku for URL/text extraction, Sonnet for custom recipe structuring + photo OCR |

## Key files
- `src/App.jsx` — entire frontend: components, state, API calls, styles
- `api/extract.js` — recipe extraction (URL scrape → Claude, photo → Claude, custom text → Claude)
- `api/store.js` — household data read/write to Upstash Redis
- `vercel.json` — routes config

## Architecture

### Household sync
All data is scoped to a household code (stored in localStorage). On load, `loadHousehold(code)` fetches all data from Redis into `_state.cache`. Reads (`sget`) come from cache; writes (`sset`) update cache and debounce-save to Redis (250ms), or immediate for critical actions like list ticks.

### State shape
```
library   — [recipe]         persisted to SK.library
week      — {Mon:[{id,mult,cooked},...], ...}  persisted to SK.menu
shoppingList — [{item,category,combinedAmount,entries,checked,manual?,stuck?}]
cleaning  — [{id,text,checked}]
pharmacy  — [{id,text,checked}]
```

### Shopping list rebuild
`rebuildShoppingList(wk, lib)` is called whenever the menu changes. It:
1. Computes auto items from uncooked recipe ingredients
2. Preserves checked state from previous list
3. Keeps "stuck" items (checked auto items removed from menu)
4. Appends manual items unchanged

**Important:** Uses `shoppingListRef.current` (not the `shoppingList` closure) to avoid stale state when called after async network awaits (e.g. `toggleCookedDay` awaits two saves before calling rebuild).

```js
const shoppingListRef = useRef(shoppingList);
shoppingListRef.current = shoppingList; // sync'd every render
```

### checkedCount
Counts checked items across grocery + cleaning + pharmacy. The single "Clear checked (N)" button at the top of the List tab clears all three at once.

### Banner / toast
`showBanner(msg)` sets a green toast for 3 seconds. It's defined in the App component body (not a hook).

## Import modes
Link → URL scrape + Claude (Haiku) | Custom → Claude structuring (Sonnet) | Photo → base64 + Claude vision (Sonnet) | Freezer → local only

### Model routing in api/extract.js
- URL extraction: Haiku, max_tokens 2000 (needs room for method array on long recipes)
- Custom recipe: Sonnet, max_tokens 800 — must stay Sonnet; Haiku misclassifies freetext ingredients (all fall through to `dry` default)
- Photo OCR: Sonnet, max_tokens 1500

The Book/EPUB import mode was removed — do not re-add it. It made multiple Claude API calls per recipe and was too expensive.

## Recipe shape
```js
{
  id, title, cuisine, platform, sourceUrl,
  prepTime, cookTime, servings, skillLevel,
  ingredients: [{name, amount, category}],
  method: [string],
  favourite, madeIt, menuCount, addedAt,
  status,        // "published" | "dev"
  isFreezer,     // freezer meal flag
  quantity,      // freezer stock count
}
```
`normalizeRecipe()` backfills missing fields.

## Grocery categories
`fruit_veg` | `meat` | `dairy` | `deli` | `dry` | `freezer`

Australian English throughout (zucchini, capsicum, prawns, mince, etc.).

## Skills to prefer
- **`code-simplification`** — `src/App.jsx` is already ~3300 lines. Changes should shrink or hold, not grow it.
- **`debugging-and-error-recovery`** — stale-closure and Redis-sync bugs in shopping-list rebuild have bitten before. Root-cause them, don't add defensive wrappers.
- Skip heavier process (TDD, spec-driven, doubt-driven) — personal single-user SPA, ceremony isn't worth it.
