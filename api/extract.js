// api/extract.js
// Vercel serverless function — runs server-side, no CORS issues
//
// GET  /api/extract?url=...          → extract recipe from social link via cooking.guru
// POST /api/extract {custom:true}    → structure a custom recipe from user ingredients

// Shared category guidance — used in every prompt so Claude assigns the right
// supermarket-aisle category to every ingredient instead of defaulting to "dry".
const CATEGORY_GUIDE = `Each ingredient's "category" must be assigned by where it lives in a supermarket. Use exactly one of these IDs:
- fruit_veg: fresh fruits, fresh vegetables, fresh herbs (basil, parsley, coriander, mint, etc.), garlic, ginger, lemons, limes, chillies
- meat: raw meat, poultry, seafood, fish, prawns, mince (anything fresh/uncooked from the butcher or fish counter)
- dairy: milk, cream, butter, yogurt, cheese, eggs, halloumi, feta, mascarpone, ricotta
- deli: cured / cooked meats (prosciutto, salami, bacon, chorizo), prepared sauces (pesto, hummus, tapenade, harissa), olives, antipasti, fresh pasta and fresh stuffed pasta
- dry: dried pasta, rice, grains, flour, sugar, salt, spices, dried herbs, oils, vinegars, condiments, canned/jarred goods (tomatoes, beans, coconut milk), stock, nuts, breadcrumbs
- freezer: frozen vegetables (peas, corn, spinach), frozen fruit/berries, frozen pastry, frozen prawns, ice cream

Examples: "salmon fillets" → meat. "rigatoni" → dry. "jar of pesto" → deli. "frozen peas" → freezer. "fresh basil" → fruit_veg. "parmesan" → dairy.`;

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

  // ── MODE B: Social media link extraction ───────────────────
  const url = req.query?.url || req.body?.url;
  if (!url) return res.status(400).json({ error: "No URL provided." });

  const platform = /instagram/.test(url) ? "Instagram"
    : /tiktok/.test(url) ? "TikTok"
    : /youtube|youtu\.be/.test(url) ? "YouTube"
    : "social media";

  // Step 1: Try cooking.guru (server-side, no CORS)
  let recipeText = "";
  let guruSuccess = false;
  try {
    const guruRes = await fetch(
      `https://cooking.guru/recipe?url=${encodeURIComponent(url)}`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; MenuApp/1.0)",
          "Accept": "text/html,application/xhtml+xml",
        },
        signal: AbortSignal.timeout(15000),
      }
    );
    if (guruRes.ok) {
      const html = await guruRes.text();
      recipeText = html
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&amp;/g, "&").replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ").trim().slice(0, 5000);
      guruSuccess = recipeText.length > 200;
    }
  } catch (e) {
    console.log("cooking.guru failed:", e.message);
  }

  // Step 2: Claude extracts structured recipe
  const prompt = guruSuccess
    ? `You are a recipe extraction AI. Here is text from a ${platform} recipe page extracted via cooking.guru:

"""
${recipeText}
"""

Extract the recipe and return ONLY valid JSON:
{
  "title": "Recipe Title",
  "cuisine": "one of: Italian/Asian/Mexican/Mediterranean/Indian/Middle Eastern/American/French/Japanese/Thai/Greek/Spanish/Other",
  "prepTime": 15,
  "cookTime": 30,
  "servings": 4,
  "skillLevel": "Easy|Medium|Advanced",
  "ingredients": [
    {"item": "Chicken thighs", "amount": "600g", "category": "meat"}
  ]
}

${CATEGORY_GUIDE}

Rules:
- ALL amounts must be metric (g, kg, ml, L). Countable items (eggs, cloves) stay as numbers.
- Return 6-16 ingredients. No method in JSON.
- If no clear recipe found, return {"error": "No recipe found in page content"}`

    : `You are a recipe extraction AI. Could not fetch content from this ${platform} URL: ${url}

Use any clues in the URL (title slug, channel, keywords) to infer the most likely recipe.

Return ONLY valid JSON:
{
  "title": "Recipe Title",
  "cuisine": "one of: Italian/Asian/Mexican/Mediterranean/Indian/Middle Eastern/American/French/Japanese/Thai/Greek/Spanish/Other",
  "prepTime": 15,
  "cookTime": 30,
  "servings": 4,
  "skillLevel": "Easy|Medium|Advanced",
  "ingredients": [
    {"item": "Chicken thighs", "amount": "600g", "category": "meat"}
  ]
}

${CATEGORY_GUIDE}

Rules:
- ALL amounts must be metric. Countable items stay as numbers.
- Return 6-16 ingredients. No method.
- If you truly cannot determine a recipe, return {"error": "Cannot determine recipe — please add it manually"}`;

  try {
    const data = await callClaude(prompt, ANTHROPIC_KEY);
    return res.status(200).json({
      ...data,
      _source: guruSuccess ? "cooking.guru" : "url-inference",
    });
  } catch (err) {
    console.error("Extract failed:", err.message, "| guruSuccess:", guruSuccess, "| textLen:", recipeText.length);
    return res.status(500).json({
      error: err.message,
      _guruSuccess: guruSuccess,
      _textLen: recipeText.length,
      _textPreview: recipeText.slice(0, 800),
    });
  }
}

// ── Shared: call Claude API ───────────────────────────────────
async function callClaude(prompt, apiKey) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1200,
      messages: [{ role: "user", content: prompt }],
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
