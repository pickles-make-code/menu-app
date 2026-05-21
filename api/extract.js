// api/extract.js
// Vercel serverless function — runs server-side, no CORS issues
//
// GET  /api/extract?url=...          → extract recipe from a URL (recipe site, YouTube, TikTok, Instagram)
// POST /api/extract {custom:true}    → structure a custom recipe from user ingredients

// Shared category guidance — used in every prompt so Claude assigns the right
// supermarket-aisle category to every ingredient instead of defaulting to "dry".
const CATEGORY_GUIDE = `IMPORTANT LANGUAGE RULES:
- Use Australian English spelling and naming throughout. Examples: zucchini (NOT courgette), eggplant (NOT aubergine), prawns (NOT shrimp), capsicum (NOT bell pepper), coriander (NOT cilantro), spring onions (NOT scallions), mince (NOT ground meat), tomato sauce (NOT ketchup).
- Capitalise the first letter of every word in the ingredient name (Title Case). E.g. "salmon fillets" → "Salmon Fillets", "garlic cloves" → "Garlic Cloves".

Each ingredient's "category" must be assigned by where it lives in a supermarket. Use exactly one of these IDs:
- fruit_veg: fresh fruits, fresh vegetables, fresh herbs (basil, parsley, coriander, mint, etc.), garlic, ginger, lemons, limes, chillies
- meat: raw meat, poultry, seafood, fish, prawns, mince (anything fresh/uncooked from the butcher or fish counter)
- dairy: milk, cream, butter, yoghurt, cheese, halloumi, feta, mascarpone, ricotta (eggs do NOT go here — eggs are deli)
- deli: cured / cooked meats (prosciutto, salami, bacon, chorizo), eggs, prepared sauces (pesto, hummus, tapenade, harissa), olives, antipasti, fresh pasta and fresh stuffed pasta
- dry: dried pasta, rice, grains, flour, spices, dried herbs, vinegars, condiments, canned/jarred goods (tomatoes, beans, coconut milk), stock, nuts, breadcrumbs
- freezer: frozen vegetables (peas, corn, spinach), frozen fruit/berries, frozen pastry, frozen prawns, ice cream

Examples: "Salmon Fillets" → meat. "Rigatoni" → dry. "Jar Of Pesto" → deli. "Eggs" → deli. "Frozen Peas" → freezer. "Fresh Basil" → fruit_veg. "Parmesan" → dairy. "Zucchini" → fruit_veg.

OMIT these pantry staples — do NOT include them in the ingredients list at all: water, salt, black pepper, ground pepper, olive oil, vegetable oil, cooking oil, canola oil, sunflower oil, cooking spray.`;

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) {
    return res.status(500).json({
      error: "ANTHROPIC_API_KEY not set. Add it in your Vercel project environment variables.",
    });
  }

  // ── MODE A: Custom recipe ──────────────────────────────────
  if (req.method === "POST" && req.body?.custom) {
    return handleCustom(req, res, ANTHROPIC_KEY);
  }

  // ── MODE B: Photo extraction (cookbook page / recipe card photos) ──
  if (req.method === "POST" && Array.isArray(req.body?.photos) && req.body.photos.length > 0) {
    return handlePhotos(req, res, ANTHROPIC_KEY);
  }

  // ── MODE C: URL extraction ─────────────────────────────────
  const url = req.query?.url || req.body?.url;
  if (!url) return res.status(400).json({ error: "No URL provided." });

  try {
    const gathered = await gatherFromUrl(url);
    if (!gathered.raw || gathered.raw.trim().length < 20) {
      return res.status(422).json({
        error: gathered.platform === "Instagram"
          ? "Instagram doesn't expose enough info publicly. Try a TikTok, YouTube, or web recipe link — or use Custom Recipe."
          : "Couldn't find recipe content on that page. Try a different link or use Custom Recipe.",
        _source: gathered.platform,
      });
    }
    const prompt = buildExtractPrompt(gathered);
    const data = await callClaude(prompt, ANTHROPIC_KEY);
    return res.status(200).json({
      ...data,
      _source: gathered.platform,
    });
  } catch (err) {
    console.error("Extract failed:", err.message);
    return res.status(500).json({ error: err.message });
  }
}

// ─── Custom recipe handler ────────────────────────────────────
async function handleCustom(req, res, ANTHROPIC_KEY) {
  const { title, ingredients, method } = req.body;
  if (!title || !ingredients) {
    return res.status(400).json({ error: "Title and ingredients are required." });
  }

  const prompt = `You are a recipe AI. Categorise and structure this custom recipe.
Title: ${title}
Ingredients: ${ingredients}
${method ? `Method (use this to accurately estimate prep time, cook time, and skill level only):\n${method}` : ""}

Return ONLY valid JSON, no markdown, no explanation:
{
  "title": "${title}",
  "cuisine": "one of: Italian/Asian/Mexican/Mediterranean/Indian/Middle Eastern/American/French/Japanese/Thai/Greek/Spanish/Other",
  "prepTime": 15,
  "cookTime": 30,
  "servings": 4,
  "skillLevel": "Easy|Medium|Advanced",
  "ingredients": [
    {"item": "salmon fillets", "amount": "2", "category": "meat"},
    {"item": "rigatoni", "amount": "300g", "category": "dry"}
  ]
}

${CATEGORY_GUIDE}

Rules:
- Use ONLY the ingredients the user provided. Do not add extras.
- Convert all amounts to metric (g, kg, ml, L).
- Infer cuisine, skill level, and times from the title, ingredients, and method.
- Do NOT return the method in the JSON output.`;

  try {
    const data = await callClaude(prompt, ANTHROPIC_KEY);
    return res.status(200).json(data);
  } catch (err) {
    console.error("Custom recipe failed:", err.message);
    return res.status(500).json({ error: err.message });
  }
}

// ─── URL detection ────────────────────────────────────────────
function detectSource(url) {
  if (/cooking\.guru\/share\//i.test(url)) return "cooking_guru_share";
  if (/instagram\.com/i.test(url)) return "instagram";
  if (/tiktok\.com/i.test(url)) return "tiktok";
  if (/youtube\.com|youtu\.be/i.test(url)) return "youtube";
  return "web";
}

// Extract the platform's native video ID from a URL — used to look up
// already-converted recipes on cooking.guru.
function extractVideoId(url, source) {
  if (source === "cooking_guru_share") {
    const m = /cooking\.guru\/share\/([A-Za-z0-9_-]+)/i.exec(url);
    return m ? m[1] : null;
  }
  if (source === "instagram") {
    const m = /instagram\.com\/(?:reel|p|reels|tv)\/([A-Za-z0-9_-]+)/i.exec(url);
    return m ? m[1] : null;
  }
  if (source === "tiktok") {
    const m = /tiktok\.com\/(?:@[^/]+\/video|v)\/(\d+)/i.exec(url);
    return m ? m[1] : null;
  }
  if (source === "youtube") {
    // youtube.com/watch?v=ID, youtu.be/ID, youtube.com/shorts/ID
    const m1 = /[?&]v=([A-Za-z0-9_-]{6,})/.exec(url);
    if (m1) return m1[1];
    const m2 = /youtu\.be\/([A-Za-z0-9_-]{6,})/.exec(url);
    if (m2) return m2[1];
    const m3 = /youtube\.com\/shorts\/([A-Za-z0-9_-]{6,})/.exec(url);
    if (m3) return m3[1];
  }
  return null;
}

// ─── Cooking.guru shared recipe lookup ────────────────────────
// Returns null if cooking.guru hasn't converted that video, otherwise raw data.
async function fetchCookingGuruShare(videoId) {
  if (!videoId) return null;
  try {
    const r = await fetch(`https://api.cooking.guru/shareRecipe?videoID=${encodeURIComponent(videoId)}`, {
      headers: { "Accept": "application/json", "User-Agent": UA },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return null;
    const data = await r.json();
    if (!data || !data.title) return null;
    return data;
  } catch (e) {
    return null;
  }
}

// Turn cooking.guru's shareRecipe response into the gathered-content shape Claude expects
function gatheredFromCookingGuru(data, platformLabel) {
  const ingredients = (data.ingredients || [])
    .map((i) => typeof i === "string" ? i : i.item || i.name || "")
    .filter(Boolean);
  const instructions = (data.instructions || [])
    .map((ins, i) => {
      if (typeof ins === "string") return `${i + 1}. ${ins}`;
      const stepNum = ins.step || (i + 1);
      const stepText = ins.text || ins.name || "";
      return stepText ? `${stepNum}. ${stepText}` : "";
    })
    .filter(Boolean)
    .join("\n");
  const meta = data.metadata || {};
  return {
    platform: platformLabel,
    kind: "cooking_guru",
    title: data.title || "",
    raw: [
      data.title && `Title: ${data.title}`,
      data.author && `Source: ${data.author}${data.authorHandle ? ` (@${data.authorHandle})` : ""}`,
      meta.mealType && `Meal type: ${meta.mealType}`,
      meta.cookingMethod && `Cooking method: ${meta.cookingMethod}`,
      meta.cookTime && `Cook time: ${meta.cookTime}`,
      meta.prepTime && `Prep time: ${meta.prepTime}`,
      meta.difficulty && `Difficulty: ${meta.difficulty}`,
      meta.servings && `Servings: ${meta.servings}`,
      ingredients.length && `\nIngredients:\n${ingredients.join("\n")}`,
      instructions && `\nInstructions:\n${instructions}`,
    ].filter(Boolean).join("\n"),
  };
}

// ─── Main URL gatherer ────────────────────────────────────────
async function gatherFromUrl(url) {
  const source = detectSource(url);

  // Special: cooking.guru share URL — go straight to their public API
  if (source === "cooking_guru_share") {
    const videoId = extractVideoId(url, source);
    const data = await fetchCookingGuruShare(videoId);
    if (data) return gatheredFromCookingGuru(data, "CookingGuru");
    throw new Error("Cooking.guru hasn't converted this video yet, or the link is invalid.");
  }

  // For social platforms: try cooking.guru first (often has it), fall back to our own scraping
  if (source === "instagram" || source === "tiktok" || source === "youtube") {
    const platformLabel = { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube" }[source];
    const videoId = extractVideoId(url, source);
    if (videoId) {
      const cgData = await fetchCookingGuruShare(videoId);
      if (cgData) return gatheredFromCookingGuru(cgData, platformLabel);
    }
    // Fallback to native scraping
    if (source === "youtube") return await gatherYouTube(url);
    if (source === "tiktok") return await gatherTikTok(url);
    if (source === "instagram") return await gatherInstagram(url);
  }

  return await gatherWebRecipe(url);
}

// ─── YouTube via oEmbed + page scrape ─────────────────────────
async function gatherYouTube(url) {
  let title = "", author = "";
  // oEmbed (cheap, no auth)
  try {
    const r = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`, {
      signal: AbortSignal.timeout(10000),
    });
    if (r.ok) {
      const j = await r.json();
      title = j.title || "";
      author = j.author_name || "";
    }
  } catch (e) {
    console.log("YT oEmbed failed:", e.message);
  }
  // Description via page scrape
  let description = "";
  try {
    const html = await fetchHtml(url);
    description = extractMeta(html, "og:description") || extractMeta(html, "description") || "";
  } catch (e) {
    console.log("YT page scrape failed:", e.message);
  }
  return {
    platform: "YouTube",
    kind: "video",
    title,
    raw: [
      title && `Title: ${title}`,
      author && `Channel: ${author}`,
      description && `Description: ${description}`,
    ].filter(Boolean).join("\n\n"),
  };
}

// ─── TikTok via oEmbed ────────────────────────────────────────
async function gatherTikTok(url) {
  let title = "", author = "";
  try {
    const r = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (r.ok) {
      const j = await r.json();
      // TikTok's oEmbed "title" is actually the caption — the most useful field
      title = j.title || "";
      author = j.author_name || "";
    }
  } catch (e) {
    console.log("TikTok oEmbed failed:", e.message);
  }
  return {
    platform: "TikTok",
    kind: "video",
    title,
    raw: [
      author && `Creator: ${author}`,
      title && `Caption: ${title}`,
    ].filter(Boolean).join("\n\n"),
  };
}

// ─── Instagram (best effort — meta tags only) ─────────────────
async function gatherInstagram(url) {
  let title = "", description = "";
  try {
    const html = await fetchHtml(url);
    title = extractMeta(html, "og:title") || "";
    description = extractMeta(html, "og:description") || "";
  } catch (e) {
    console.log("IG scrape failed:", e.message);
  }
  return {
    platform: "Instagram",
    kind: "video",
    title,
    raw: [
      title && `Title: ${title}`,
      description && `Caption: ${description}`,
    ].filter(Boolean).join("\n\n"),
  };
}

// ─── Generic web recipe (JSON-LD preferred, falls back to meta) ──
async function gatherWebRecipe(url) {
  const html = await fetchHtml(url);

  // 1) Try JSON-LD schema.org/Recipe — the gold standard
  const recipes = extractJsonLdRecipes(html);
  if (recipes.length > 0) {
    const r = recipes[0];
    const ingredients = (Array.isArray(r.recipeIngredient) ? r.recipeIngredient : []).filter(Boolean);
    const instructions = flattenInstructions(r.recipeInstructions);
    const prepMin = parseIsoDuration(r.prepTime);
    const cookMin = parseIsoDuration(r.cookTime);
    const totalMin = parseIsoDuration(r.totalTime);
    return {
      platform: "Web",
      kind: "recipe_page",
      title: r.name || "",
      raw: [
        r.name && `Title: ${r.name}`,
        r.description && `Description: ${r.description}`,
        r.recipeCuisine && `Cuisine: ${r.recipeCuisine}`,
        r.recipeYield && `Servings: ${r.recipeYield}`,
        prepMin && `Prep: ${prepMin} min`,
        cookMin && `Cook: ${cookMin} min`,
        !cookMin && totalMin && `Total: ${totalMin} min`,
        ingredients.length && `\nIngredients:\n${ingredients.join("\n")}`,
        instructions && `\nInstructions:\n${instructions}`,
      ].filter(Boolean).join("\n"),
      _hints: {
        prepTime: prepMin,
        cookTime: cookMin,
        servings: parseServings(r.recipeYield),
        cuisine: typeof r.recipeCuisine === "string" ? r.recipeCuisine : null,
      },
    };
  }

  // 2) Fallback: og meta tags + visible text excerpt
  const title = extractMeta(html, "og:title") || extractTitle(html) || "";
  const description = extractMeta(html, "og:description") || "";
  const bodyText = stripToText(html).slice(0, 3000);

  return {
    platform: "Web",
    kind: "web_page",
    title,
    raw: [
      title && `Title: ${title}`,
      description && `Description: ${description}`,
      bodyText && `\nPage content:\n${bodyText}`,
    ].filter(Boolean).join("\n"),
  };
}

// ─── HTML / metadata helpers ──────────────────────────────────
async function fetchHtml(url) {
  const r = await fetch(url, {
    headers: {
      "User-Agent": UA,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
      "Upgrade-Insecure-Requests": "1",
    },
    signal: AbortSignal.timeout(15000),
    redirect: "follow",
  });
  if (r.status === 402 || r.status === 403 || r.status === 429) {
    throw new Error(`This site blocks automated requests (HTTP ${r.status}). Workaround: convert the recipe on cooking.guru first, then paste the cooking.guru share URL here.`);
  }
  if (!r.ok) throw new Error(`Page fetch failed: ${r.status}`);
  return await r.text();
}

function extractMeta(html, name) {
  // Try property="..." then name="..."
  const patterns = [
    new RegExp(`<meta\\s+(?:[^>]*?\\s)?property=["']${escapeRegex(name)}["'][^>]*?content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta\\s+(?:[^>]*?\\s)?content=["']([^"']*)["'][^>]*?property=["']${escapeRegex(name)}["']`, "i"),
    new RegExp(`<meta\\s+(?:[^>]*?\\s)?name=["']${escapeRegex(name)}["'][^>]*?content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta\\s+(?:[^>]*?\\s)?content=["']([^"']*)["'][^>]*?name=["']${escapeRegex(name)}["']`, "i"),
  ];
  for (const p of patterns) {
    const m = p.exec(html);
    if (m) return decodeEntities(m[1]);
  }
  return "";
}

function extractTitle(html) {
  const m = /<title[^>]*>([^<]+)<\/title>/i.exec(html);
  return m ? decodeEntities(m[1].trim()) : "";
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&#x27;/g, "'").replace(/&apos;/g, "'");
}

function stripToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .split("\n").map(s => s.trim()).filter(Boolean).join("\n")
    .replace(/[ \t]+/g, " ");
}

// ─── JSON-LD recipe extraction ────────────────────────────────
function extractJsonLdRecipes(html) {
  const recipes = [];
  const regex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1].trim());
      collectRecipes(data, recipes);
    } catch (e) {
      // Some sites embed multiple JSON objects or have HTML inside — try a relaxed parse
      try {
        const cleaned = match[1].trim().replace(/^﻿/, "");
        const data = JSON.parse(cleaned);
        collectRecipes(data, recipes);
      } catch (e2) {
        // skip silently
      }
    }
  }
  return recipes;
}

function collectRecipes(node, out) {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const item of node) collectRecipes(item, out);
    return;
  }
  if (typeof node !== "object") return;
  const type = node["@type"];
  const isRecipe = type === "Recipe" || (Array.isArray(type) && type.includes("Recipe"));
  if (isRecipe) out.push(node);
  if (node["@graph"]) collectRecipes(node["@graph"], out);
  if (node.mainEntity) collectRecipes(node.mainEntity, out);
  if (node.itemListElement) collectRecipes(node.itemListElement, out);
}

function flattenInstructions(ri) {
  if (!ri) return "";
  if (typeof ri === "string") return ri;
  if (Array.isArray(ri)) {
    return ri.map((step, i) => {
      if (typeof step === "string") return `${i + 1}. ${step}`;
      if (step.text) return `${i + 1}. ${step.text}`;
      if (step.name) return `${i + 1}. ${step.name}`;
      if (step.itemListElement) return flattenInstructions(step.itemListElement);
      return "";
    }).filter(Boolean).join("\n");
  }
  return "";
}

function parseIsoDuration(iso) {
  if (!iso || typeof iso !== "string") return 0;
  // PT15M, PT1H30M, PT2H, etc.
  const m = /^P(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(iso);
  if (!m) return 0;
  const h = parseInt(m[1] || "0", 10);
  const min = parseInt(m[2] || "0", 10);
  return h * 60 + min;
}

function parseServings(y) {
  if (!y) return null;
  if (typeof y === "number") return y;
  if (Array.isArray(y)) y = y[0];
  if (typeof y !== "string") return null;
  const m = /(\d+)/.exec(y);
  return m ? parseInt(m[1], 10) : null;
}

// ─── Final Claude prompt builder ──────────────────────────────
function buildExtractPrompt(gathered) {
  const hints = gathered._hints || {};
  const hintLine = [
    hints.prepTime && `Prep time: ${hints.prepTime} min`,
    hints.cookTime && `Cook time: ${hints.cookTime} min`,
    hints.servings && `Servings: ${hints.servings}`,
    hints.cuisine && `Cuisine: ${hints.cuisine}`,
  ].filter(Boolean).join(", ");

  return `You are a recipe extraction AI. Below is content gathered from a ${gathered.platform} ${gathered.kind === "recipe_page" ? "recipe page" : "video / page"}.

${gathered.raw}

${hintLine ? `Use these explicit hints if present: ${hintLine}.` : ""}

Return ONLY valid JSON, no markdown, no explanation:
{
  "title": "Recipe Title",
  "cuisine": "one of: Italian/Asian/Mexican/Mediterranean/Indian/Middle Eastern/American/French/Japanese/Thai/Greek/Spanish/Other",
  "prepTime": 15,
  "cookTime": 30,
  "servings": 4,
  "skillLevel": "Easy|Medium|Advanced",
  "ingredients": [
    {"item": "Chicken thighs", "amount": "600g", "category": "meat"}
  ],
  "method": [
    "Season the chicken thighs with salt and pepper.",
    "Heat oil in a pan over medium-high heat.",
    "Cook the chicken 5 minutes each side until golden."
  ]
}

${CATEGORY_GUIDE}

Rules:
- ALL amounts must be metric (g, kg, ml, L). Countable items (eggs, cloves) stay as numbers.
- Return 6-25 ingredients.
- "method" is an array of clear, concise step strings. Use the instructions from the source content if present. If none are available, return an empty array [].
- If you genuinely cannot identify a recipe in the content above, return {"error": "Couldn't find a clear recipe in this content"}`;
}

// ─── Shared: call Claude API ───────────────────────────────────
// `content` may be a plain prompt string or an array of content blocks (for vision).
async function callClaude(content, apiKey) {
  const messageContent = typeof content === "string"
    ? content
    : content; // array of {type:"image"|"text",...}

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      messages: [{ role: "user", content: messageContent }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Claude API error ${res.status}: ${await res.text()}`);
  }

  const d = await res.json();
  const text = d.content?.map((b) => b.text || "").join("") || "{}";
  const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
  if (parsed.error) throw new Error(parsed.error);
  return parsed;
}

// ─── Photo recipe handler ────────────────────────────────────
// Accepts { photos: [base64String, ...] } where each base64 is the JPEG body
// (no `data:image/jpeg;base64,` prefix). Sends them to Claude vision.
async function handlePhotos(req, res, ANTHROPIC_KEY) {
  const { photos, customName } = req.body;
  if (!Array.isArray(photos) || photos.length === 0) {
    return res.status(400).json({ error: "At least one photo is required." });
  }
  if (photos.length > 8) {
    return res.status(400).json({ error: "Up to 8 photos per recipe — please combine into fewer images." });
  }

  // Build vision content: all images first, then the extraction prompt.
  const imageBlocks = photos.map((b64) => ({
    type: "image",
    source: { type: "base64", media_type: "image/jpeg", data: b64 },
  }));

  const prompt = `These ${photos.length} ${photos.length === 1 ? "image is" : "images are"} ${photos.length === 1 ? "a photo" : "photos (cookbook spread / sequential pages)"} of a single recipe. Read everything visible and extract the recipe.

${customName ? `User-provided title hint: "${customName}". Use this if it matches what you see.\n` : ""}
Return ONLY valid JSON, no markdown, no explanation:
{
  "title": "Recipe Title",
  "cuisine": "one of: Italian/Asian/Mexican/Mediterranean/Indian/Middle Eastern/American/French/Japanese/Thai/Greek/Spanish/Other",
  "prepTime": 15,
  "cookTime": 30,
  "servings": 4,
  "skillLevel": "Easy|Medium|Advanced",
  "ingredients": [
    {"item": "Chicken Thighs", "amount": "600g", "category": "meat"}
  ],
  "method": [
    "Step 1 text...",
    "Step 2 text..."
  ]
}

${CATEGORY_GUIDE}

Rules:
- ALL amounts must be metric (g, kg, ml, L). Countable items (eggs, cloves) stay as numbers.
- If multiple images are provided, treat them as one recipe (e.g. ingredients on page 1, method on page 2).
- "method" is an array of clear step strings. Use the printed instructions if visible. Empty array if none.
- If you cannot read a recipe clearly, return {"error": "Couldn't read a recipe in these photos. Try a clearer shot."}`;

  const visionContent = [...imageBlocks, { type: "text", text: prompt }];

  try {
    const data = await callClaude(visionContent, ANTHROPIC_KEY);
    return res.status(200).json({ ...data, _source: "Photo" });
  } catch (err) {
    console.error("Photo extract failed:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
