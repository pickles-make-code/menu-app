import { useState, useEffect, useCallback, useRef } from "react";

// ─── Storage keys ─────────────────────────────────────────────
const SK = {
  library: "menu_library_v2",
  menu: "menu_week_v2",
  list: "menu_list_v2",
};

// ─── Constants ────────────────────────────────────────────────
const DAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];

const GROCERY_CATS = [
  { id: "fruit_veg",   label: "Fruit & Veg",        icon: "🥦" },
  { id: "meat",        label: "Meat / Seafood",      icon: "🥩" },
  { id: "dairy",       label: "Dairy",               icon: "🧀" },
  { id: "deli",        label: "Deli",                icon: "🍖" },
  { id: "dry",         label: "Dry & Packaged",      icon: "🫙" },
  { id: "freezer",     label: "Freezer",             icon: "🧊" },
];

const CUISINES = [
  "Italian","Asian","Mexican","Mediterranean","Indian","Middle Eastern",
  "American","French","Japanese","Thai","Greek","Spanish","Other"
];
const SKILL_LEVELS = ["Easy","Medium","Advanced"];

// ─── Helpers ─────────────────────────────────────────────────
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }

function detectPlatform(url) {
  if (/instagram\.com/i.test(url)) return "instagram";
  if (/tiktok\.com/i.test(url)) return "tiktok";
  if (/youtube\.com|youtu\.be/i.test(url)) return "youtube";
  return "unknown";
}

function platformLabel(p) {
  return { instagram:"Instagram", tiktok:"TikTok", youtube:"YouTube" }[p] || "Link";
}

function platformIcon(p) {
  return { instagram:"📸", tiktok:"🎵", youtube:"▶️" }[p] || "🔗";
}

// Convert cooking.guru URL for a given source URL
function cookingGuruUrl(sourceUrl) {
  const encoded = encodeURIComponent(sourceUrl);
  return `https://cooking.guru/recipe?url=${encoded}`;
}

// Fetch recipe via /api/extract (our Vercel serverless function — no CORS)
async function fetchViaAPI(url) {
  const res = await fetch(`/api/extract?url=${encodeURIComponent(url)}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || "Extraction failed");
  return data;
}

async function generateCustomRecipe(details) {
  const res = await fetch("/api/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ custom: true, ...details }),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || "Could not generate recipe");
  return data;
}

// ─── Storage (localStorage — works on any browser/device) ────
async function sget(key) {
  try {
    const val = localStorage.getItem(key);
    return val ? JSON.parse(val) : null;
  } catch { return null; }
}
async function sset(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

// ─── CSS Variables injected globally ─────────────────────────
const THEME = `
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=DM+Sans:wght@300;400;500;600&display=swap');

  :root {
    --bg:        #1c1a18;
    --bg2:       #242220;
    --bg3:       #2c2a27;
    --bg4:       #343230;
    --border:    rgba(255,255,255,0.07);
    --border2:   rgba(255,255,255,0.12);
    --text:      #f0ebe3;
    --text2:     #a89f94;
    --text3:     #6b6560;
    --accent:    #d4884a;
    --accent2:   #e8a96a;
    --accentbg:  rgba(212,136,74,0.12);
    --accentbg2: rgba(212,136,74,0.2);
    --green:     #6db580;
    --greenbg:   rgba(109,181,128,0.12);
    --red:       #c0524a;
    --redbg:     rgba(192,82,74,0.12);
    --radius:    14px;
    --radius2:   10px;
    --radius3:   8px;
    --shadow:    0 4px 24px rgba(0,0,0,0.4);
    --shadow2:   0 2px 12px rgba(0,0,0,0.3);
  }

  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
  body { background: var(--bg); color: var(--text); font-family: 'DM Sans', sans-serif; }

  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes fadeUp { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:none; } }
  @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.5; } }

  .fade-up { animation: fadeUp 0.3s ease forwards; }

  input, textarea, select {
    background: var(--bg3);
    color: var(--text);
    border: 1.5px solid var(--border2);
    border-radius: var(--radius3);
    font-family: 'DM Sans', sans-serif;
    font-size: 14px;
    outline: none;
    transition: border-color 0.2s;
  }
  input:focus, textarea:focus, select:focus { border-color: var(--accent); }
  input::placeholder, textarea::placeholder { color: var(--text3); }

  button { font-family: 'DM Sans', sans-serif; cursor: pointer; border: none; }

  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--bg4); border-radius: 2px; }
`;

// ─── Sub-components ──────────────────────────────────────────

function Spinner({ size = 18 }) {
  return <div style={{
    width: size, height: size,
    border: `2px solid rgba(255,255,255,0.1)`,
    borderTopColor: "var(--accent)",
    borderRadius: "50%",
    animation: "spin 0.7s linear infinite",
    display: "inline-block",
  }} />;
}

function Badge({ children, color = "var(--accent)" }) {
  return <span style={{
    fontSize: 10, fontWeight: 600, letterSpacing: "0.6px",
    textTransform: "uppercase", color,
    background: color === "var(--accent)" ? "var(--accentbg)" : "rgba(109,181,128,0.12)",
    borderRadius: 4, padding: "2px 7px",
  }}>{children}</span>;
}

function Tag({ children }) {
  return <span style={{
    fontSize: 11, color: "var(--text2)",
    background: "var(--bg4)", borderRadius: 4,
    padding: "2px 8px",
  }}>{children}</span>;
}

// Recipe card (library)
function RecipeCard({ recipe, onAddToMenu, onToggleFav, onDelete, onEdit, isOnMenu }) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState(null);
  const [servMult, setServMult] = useState(1);
  const [confirmDel, setConfirmDel] = useState(false);

  function startEdit() {
    setEditData({
      title: recipe.title,
      cuisine: recipe.cuisine,
      skillLevel: recipe.skillLevel,
      prepTime: recipe.prepTime,
      cookTime: recipe.cookTime,
      ingredients: recipe.ingredients.map((i) => ({ ...i })),
      // Raw text for the textareas — only parsed on save so typing/Enter behave normally
      ingredientsText: recipe.ingredients
        .map((i) => `${i.amount} ${i.item}, ${i.category}`)
        .join("\n"),
      methodText: (recipe.method || []).join("\n"),
    });
    setEditing(true);
  }

  function saveEdit() {
    // Parse the ingredients textarea on save (not on every keystroke)
    const parsedIngredients = (editData.ingredientsText || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [main, cat] = line.split(",");
        const parts = (main || "").trim().split(/\s+/);
        const amount = parts[0] || "";
        const item = parts.slice(1).join(" ");
        return { amount: amount.trim(), item: item.trim(), category: (cat || "dry").trim() };
      });
    const parsedMethod = (editData.methodText || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const { ingredientsText, methodText, ...rest } = editData;
    onEdit({ ...recipe, ...rest, ingredients: parsedIngredients, method: parsedMethod });
    setEditing(false);
    setEditData(null);
  }

  const totalTime = (recipe.prepTime || 0) + (recipe.cookTime || 0);

  return (
    <div style={{
      background: "var(--bg2)", borderRadius: "var(--radius)",
      border: `1.5px solid ${isOnMenu ? "var(--accent)" : "var(--border)"}`,
      overflow: "hidden", transition: "border-color 0.2s",
    }} className="fade-up">
      {/* Card header */}
      <div
        style={{ padding: "16px 18px", cursor: "pointer" }}
        onClick={() => !editing && setExpanded((e) => !e)}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
              {recipe.favourite && <span style={{ fontSize: 14 }}>⭐</span>}
              <span style={{
                fontFamily: "'Playfair Display', serif",
                fontSize: 16, fontWeight: 600, color: "var(--text)",
              }}>{recipe.title}</span>
              {isOnMenu && <Badge color="var(--green)">On menu</Badge>}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {recipe.cuisine && <Tag>{recipe.cuisine}</Tag>}
              {totalTime > 0 && <Tag>⏱ {totalTime} min</Tag>}
              {recipe.skillLevel && <Tag>{recipe.skillLevel}</Tag>}
            </div>
          </div>

          {/* Action icons */}
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
            <button
              style={{ background: "none", fontSize: 16, padding: 4, color: recipe.favourite ? "#f5c842" : "var(--text3)", transition: "color 0.2s" }}
              onClick={() => onToggleFav(recipe.id)}
              title={recipe.favourite ? "Remove from favourites" : "Add to favourites"}
            >★</button>
            <button
              style={{ background: "none", fontSize: 15, padding: 4, color: "var(--text3)", transition: "color 0.2s" }}
              onClick={startEdit}
              title="Edit recipe"
            >✎</button>
            {confirmDel ? (
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <button style={{ background: "var(--red)", color: "#fff", borderRadius: 6, padding: "3px 10px", fontSize: 12, fontWeight: 600 }} onClick={() => onDelete(recipe.id)}>Delete</button>
                <button style={{ background: "var(--bg4)", color: "var(--text2)", borderRadius: 6, padding: "3px 10px", fontSize: 12 }} onClick={() => setConfirmDel(false)}>Cancel</button>
              </div>
            ) : (
              <button
                style={{ background: "none", fontSize: 15, padding: 4, color: "var(--text3)" }}
                onClick={() => setConfirmDel(true)}
                title="Delete recipe"
              >🗑</button>
            )}
          </div>
        </div>
      </div>

      {/* Editing mode */}
      {editing && editData && (
        <div style={{ padding: "0 18px 16px", borderTop: "1px solid var(--border)" }} onClick={(e) => e.stopPropagation()}>
          <div style={{ fontSize: 11, color: "var(--accent)", fontWeight: 600, letterSpacing: "0.8px", textTransform: "uppercase", padding: "12px 0 10px" }}>Editing Recipe</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
            <div>
              <div style={labelStyle}>Title</div>
              <input style={{ ...inputStyle, width: "100%" }} value={editData.title} onChange={(e) => setEditData({ ...editData, title: e.target.value })} />
            </div>
            <div>
              <div style={labelStyle}>Cuisine</div>
              <select style={{ ...inputStyle, width: "100%", padding: "9px 10px" }} value={editData.cuisine} onChange={(e) => setEditData({ ...editData, cuisine: e.target.value })}>
                {CUISINES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <div style={labelStyle}>Skill Level</div>
              <select style={{ ...inputStyle, width: "100%", padding: "9px 10px" }} value={editData.skillLevel} onChange={(e) => setEditData({ ...editData, skillLevel: e.target.value })}>
                {SKILL_LEVELS.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <div style={labelStyle}>Prep / Cook (min)</div>
              <div style={{ display: "flex", gap: 6 }}>
                <input type="number" style={{ ...inputStyle, width: "50%", padding: "9px 10px" }} value={editData.prepTime} onChange={(e) => setEditData({ ...editData, prepTime: +e.target.value })} />
                <input type="number" style={{ ...inputStyle, width: "50%", padding: "9px 10px" }} value={editData.cookTime} onChange={(e) => setEditData({ ...editData, cookTime: +e.target.value })} />
              </div>
            </div>
          </div>
          <div style={labelStyle}>Ingredients (one per line: "amount item, category")</div>
          <textarea
            style={{ ...inputStyle, width: "100%", padding: "10px", minHeight: 120, resize: "vertical", fontSize: 12, lineHeight: 1.7 }}
            value={editData.ingredientsText}
            onChange={(e) => setEditData({ ...editData, ingredientsText: e.target.value })}
          />
          <div style={{ ...labelStyle, marginTop: 12 }}>Method <span style={{ color: "var(--text3)", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(one step per line, optional)</span></div>
          <textarea
            style={{ ...inputStyle, width: "100%", padding: "10px", minHeight: 120, resize: "vertical", fontSize: 12, lineHeight: 1.7 }}
            value={editData.methodText}
            onChange={(e) => setEditData({ ...editData, methodText: e.target.value })}
            placeholder={"Season chicken and marinate for 30 mins\nHeat oil in pan over high heat\nCook chicken 5 mins each side..."}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button style={{ ...btnStyle, background: "var(--accent)", color: "#fff", flex: 1 }} onClick={saveEdit}>Save changes</button>
            <button style={{ ...btnStyle, background: "var(--bg4)", color: "var(--text2)" }} onClick={() => { setEditing(false); setEditData(null); }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Expanded view */}
      {expanded && !editing && (
        <div style={{ padding: "0 18px 18px", borderTop: "1px solid var(--border)" }}>
          {/* Serving multiplier */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 0 10px" }}>
            <span style={{ fontSize: 12, color: "var(--text2)" }}>Servings: {(recipe.servings || 4) * servMult}</span>
            <div style={{ display: "flex", gap: 4 }}>
              {[1, 2, 3, 4].map((m) => (
                <button
                  key={m}
                  style={{
                    padding: "4px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600,
                    background: servMult === m ? "var(--accent)" : "var(--bg4)",
                    color: servMult === m ? "#fff" : "var(--text2)",
                  }}
                  onClick={(e) => { e.stopPropagation(); setServMult(m); }}
                >×{m}</button>
              ))}
            </div>
          </div>

          {/* Ingredients */}
          <div style={{ marginBottom: 12 }}>
            <div style={labelStyle}>Ingredients</div>
            {recipe.ingredients?.map((ing, i) => {
              const amt = multiplyAmount(ing.amount, servMult);
              return (
                <div key={i} style={{ display: "flex", gap: 12, padding: "5px 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
                  <span style={{ color: "var(--accent2)", fontWeight: 500, minWidth: 70, flexShrink: 0 }}>{amt}</span>
                  <span style={{ color: "var(--text2)" }}>{ing.item}</span>
                </div>
              );
            })}
          </div>

          {/* Method — only shown if user wrote one */}
          {recipe.method?.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={labelStyle}>Method</div>
              {recipe.method.map((step, i) => (
                <div key={i} style={{ display: "flex", gap: 10, padding: "5px 0", fontSize: 13 }}>
                  <span style={{ color: "var(--accent)", fontWeight: 700, flexShrink: 0, width: 18 }}>{i + 1}.</span>
                  <span style={{ color: "var(--text2)", lineHeight: 1.5 }}>{step}</span>
                </div>
              ))}
            </div>
          )}

          <button
            style={{ ...btnStyle, background: "var(--accent)", color: "#fff", width: "100%" }}
            onClick={(e) => { e.stopPropagation(); onAddToMenu(recipe); }}
          >
            {isOnMenu ? "+ Add to another day" : "+ Add to this week's menu"}
          </button>
        </div>
      )}
    </div>
  );
}

// Day card for Menu tab
function DayCard({ day, recipe, onAdd, onRemove, onSwap }) {
  const [isOver, setIsOver] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // Reset dragging state whenever the recipe in this day changes
  // (handles the case where the source element re-renders mid-drag and onDragEnd doesn't fire)
  useEffect(() => {
    setIsDragging(false);
  }, [recipe?.id]);

  function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (!isOver) setIsOver(true);
  }
  function handleDragLeave() {
    setIsOver(false);
  }
  function handleDrop(e) {
    e.preventDefault();
    setIsOver(false);
    const fromDay = e.dataTransfer.getData("text/plain");
    if (fromDay && fromDay !== day) onSwap(fromDay, day);
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        background: isOver ? "var(--accentbg)" : "var(--bg2)",
        borderRadius: "var(--radius)",
        border: `1.5px ${isOver ? "dashed var(--accent)" : `solid ${recipe ? "var(--border2)" : "var(--border)"}`}`,
        overflow: "hidden",
        transition: "border-color 0.15s, background 0.15s",
      }}>
      <div style={{
        padding: "10px 16px",
        background: "var(--bg3)",
        borderBottom: "1px solid var(--border)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.8px", textTransform: "uppercase", color: "var(--accent)" }}>
          {day}
        </span>
        {recipe && (
          <button style={{ background: "none", fontSize: 13, color: "var(--text3)", padding: 2 }} onClick={() => onRemove(day)}>✕</button>
        )}
      </div>

      {recipe ? (
        <div
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData("text/plain", day);
            e.dataTransfer.effectAllowed = "move";
            setIsDragging(true);
          }}
          onDragEnd={() => setIsDragging(false)}
          style={{
            padding: "14px 16px",
            cursor: "grab",
            userSelect: "none",
            opacity: isDragging ? 0.4 : 1,
            transition: "opacity 0.15s",
          }}
          title="Drag to swap with another day"
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span style={{ color: "var(--text3)", fontSize: 14, lineHeight: 1, cursor: "grab" }}>⋮⋮</span>
            <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 15, fontWeight: 600, color: "var(--text)" }}>
              {recipe.title}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginLeft: 22 }}>
            {recipe.cuisine && <Tag>{recipe.cuisine}</Tag>}
            {((recipe.prepTime || 0) + (recipe.cookTime || 0)) > 0 && (
              <Tag>⏱ {(recipe.prepTime || 0) + (recipe.cookTime || 0)} min</Tag>
            )}
            {recipe.skillLevel && <Tag>{recipe.skillLevel}</Tag>}
          </div>
        </div>
      ) : (
        <button
          style={{
            width: "100%", padding: "20px 16px",
            background: "none", color: "var(--text3)",
            fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            transition: "color 0.2s, background 0.2s",
          }}
          onClick={() => onAdd(day)}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--accent)"; e.currentTarget.style.background = "var(--accentbg)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text3)"; e.currentTarget.style.background = "none"; }}
        >
          <span style={{ fontSize: 18, lineHeight: 1 }}>+</span> Add recipe
        </button>
      )}
    </div>
  );
}

// Ingredient amount multiplier helper
function multiplyAmount(amount, mult) {
  if (!amount || mult === 1) return amount;
  const match = amount.match(/^([\d.]+)\s*(.*)$/);
  if (!match) return amount;
  const num = parseFloat(match[1]) * mult;
  const unit = match[2];
  const rounded = Number.isInteger(num) ? num : parseFloat(num.toFixed(1));
  return `${rounded}${unit ? " " + unit : ""}`;
}

// Combine identical ingredients across recipes
function buildShoppingList(recipes) {
  const combined = {};
  for (const recipe of recipes) {
    for (const ing of (recipe.ingredients || [])) {
      const key = ing.item.toLowerCase().trim();
      const cat = ing.category || "dry";
      if (!combined[key]) {
        combined[key] = { item: ing.item, category: cat, entries: [] };
      }
      combined[key].entries.push({ amount: ing.amount, recipe: recipe.title });
    }
  }
  // Parse and sum amounts where possible
  const result = Object.values(combined).map((entry) => {
    const totals = {};
    let allNumeric = true;
    for (const e of entry.entries) {
      const match = (e.amount || "").match(/^([\d.]+)\s*(.*)$/);
      if (match) {
        const num = parseFloat(match[1]);
        const unit = match[2].trim().toLowerCase();
        totals[unit] = (totals[unit] || 0) + num;
      } else { allNumeric = false; }
    }
    let combinedAmount = entry.entries.map((e) => e.amount).join(" + ");
    if (allNumeric && Object.keys(totals).length === 1) {
      const [unit, total] = Object.entries(totals)[0];
      const rounded = Number.isInteger(total) ? total : parseFloat(total.toFixed(1));
      combinedAmount = `${rounded}${unit ? " " + unit : ""}`;
    }
    return {
      item: entry.item,
      category: entry.category,
      combinedAmount,
      entries: entry.entries,
      checked: false,
    };
  });
  return result;
}

// ─── Shared styles ────────────────────────────────────────────
const btnStyle = {
  padding: "10px 18px", borderRadius: "var(--radius3)",
  fontSize: 13, fontWeight: 600, transition: "opacity 0.2s, background 0.2s",
};
const inputStyle = {
  padding: "9px 12px", width: "100%",
};
const labelStyle = {
  fontSize: 11, fontWeight: 600, color: "var(--text3)",
  textTransform: "uppercase", letterSpacing: "0.8px",
  marginBottom: 6, marginTop: 2, display: "block",
};

// ─── Import page ──────────────────────────────────────────────
function ImportPage({ library, onImported, showBanner }) {
  const [mode, setMode] = useState("link"); // "link" | "custom"
  const [url, setUrl] = useState("");
  const [customName, setCustomName] = useState("");
  const [customIngredients, setCustomIngredients] = useState("");
  const [customMethod, setCustomMethod] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [stage, setStage] = useState(""); // progress message

  async function handleImport() {
    if (!url.trim()) return;
    const platform = detectPlatform(url.trim());
    if (platform === "unknown") { setError("Please enter an Instagram, TikTok or YouTube link."); return; }
    if (library.find((r) => r.sourceUrl === url.trim())) { setError("This link is already in your library."); return; }
    setError(""); setLoading(true);
    try {
      setStage(`Sending to cooking.guru to extract recipe...`);
      await new Promise((r) => setTimeout(r, 600));
      setStage("Extracting ingredients...");
      const data = await fetchViaAPI(url.trim());
      setStage("Saving to your library...");
      const recipe = {
        id: uid(),
        sourceUrl: url.trim(),
        platform,
        title: customName.trim() || data.title,
        cuisine: data.cuisine || "Other",
        prepTime: data.prepTime || 0,
        cookTime: data.cookTime || 0,
        servings: data.servings || 4,
        skillLevel: data.skillLevel || "Medium",
        ingredients: data.ingredients || [],
        favourite: false,
        menuCount: 0,
        addedAt: Date.now(),
      };
      onImported(recipe);
      setUrl(""); setCustomName(""); setStage("");
      showBanner(`"${recipe.title}" added to your library!`);
    } catch (e) {
      setError("Could not extract recipe. Try again or use the custom recipe option.");
    }
    setLoading(false); setStage("");
  }

  async function handleCustom() {
    if (!customName.trim() || !customIngredients.trim()) { setError("Please enter a title and ingredients."); return; }
    setError(""); setLoading(true);
    try {
      setStage("Generating recipe details...");
      const data = await generateCustomRecipe({ title: customName, ingredients: customIngredients, method: customMethod });
      const recipe = {
        id: uid(), sourceUrl: null, platform: "custom",
        title: customName.trim(),
        cuisine: data.cuisine || "Other",
        prepTime: data.prepTime || 0,
        cookTime: data.cookTime || 0,
        servings: data.servings || 4,
        skillLevel: data.skillLevel || "Medium",
        ingredients: data.ingredients || [],
        method: customMethod.trim() ? customMethod.trim().split("\n").filter(Boolean) : [],
        favourite: false, menuCount: 0, addedAt: Date.now(),
      };
      onImported(recipe);
      setCustomName(""); setCustomIngredients(""); setCustomMethod(""); setStage("");
      showBanner(`"${recipe.title}" added to your library!`);
    } catch (e) {
      setError("Could not generate recipe. Please check your inputs.");
    }
    setLoading(false); setStage("");
  }

  return (
    <div style={{ padding: "0 0 40px" }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 26, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>Import</div>
        <div style={{ fontSize: 13, color: "var(--text2)" }}>Add a recipe from social media or create your own</div>
      </div>

      {/* Mode switcher */}
      <div style={{ display: "flex", background: "var(--bg3)", borderRadius: "var(--radius2)", padding: 4, marginBottom: 24, gap: 4 }}>
        {[["link","🔗 From Link"],["custom","✏️ Custom Recipe"]].map(([id, label]) => (
          <button key={id} style={{
            flex: 1, padding: "9px", borderRadius: "var(--radius3)",
            fontSize: 13, fontWeight: 600,
            background: mode === id ? "var(--accent)" : "transparent",
            color: mode === id ? "#fff" : "var(--text2)",
            transition: "all 0.2s",
          }} onClick={() => { setMode(id); setError(""); }}>
            {label}
          </button>
        ))}
      </div>

      {/* Link import */}
      {mode === "link" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <div style={labelStyle}>Social Media Link</div>
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ position: "relative", flex: 1 }}>
                <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 16, pointerEvents: "none" }}>🔗</span>
                <input
                  style={{ ...inputStyle, paddingLeft: 36 }}
                  placeholder="Instagram, TikTok or YouTube URL..."
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !loading && handleImport()}
                  disabled={loading}
                />
              </div>
            </div>
          </div>
          <div>
            <div style={labelStyle}>Custom name <span style={{ color: "var(--text3)", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(optional — we'll detect it)</span></div>
            <input style={inputStyle} placeholder="e.g. Spicy Salmon Bowl" value={customName} onChange={(e) => setCustomName(e.target.value)} disabled={loading} />
          </div>

          <div style={{ background: "var(--bg3)", borderRadius: "var(--radius2)", padding: "12px 14px", fontSize: 12, color: "var(--text2)", lineHeight: 1.7, border: "1px solid var(--border)" }}>
            <span style={{ color: "var(--accent)", fontWeight: 600 }}>How it works:</span> Your link is sent to cooking.guru which reads the video and extracts the full recipe — then it's saved to your library.
            <br />Works with <span style={{ color: "var(--text)" }}>Instagram Reels</span>, <span style={{ color: "var(--text)" }}>TikTok</span> and <span style={{ color: "var(--text)" }}>YouTube</span>.
          </div>

          {loading && (
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", background: "var(--accentbg)", borderRadius: "var(--radius2)", border: "1px solid var(--border2)" }}>
              <Spinner />
              <span style={{ fontSize: 13, color: "var(--accent2)" }}>{stage}</span>
            </div>
          )}
          {error && <div style={{ fontSize: 13, color: "var(--red)", padding: "10px 14px", background: "var(--redbg)", borderRadius: "var(--radius3)" }}>{error}</div>}

          <button
            style={{
              ...btnStyle, background: loading || !url.trim() ? "var(--bg4)" : "var(--accent)",
              color: loading || !url.trim() ? "var(--text3)" : "#fff",
              cursor: loading || !url.trim() ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            }}
            onClick={handleImport}
            disabled={loading || !url.trim()}
          >
            {loading ? <><Spinner size={15} /> Extracting recipe...</> : "Extract & save recipe →"}
          </button>
        </div>
      )}

      {/* Custom recipe */}
      {mode === "custom" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <div style={labelStyle}>Recipe Title *</div>
            <input style={inputStyle} placeholder="e.g. Mum's Bolognese" value={customName} onChange={(e) => setCustomName(e.target.value)} disabled={loading} />
          </div>
          <div>
            <div style={labelStyle}>Ingredients * <span style={{ color: "var(--text3)", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(one per line, with amounts)</span></div>
            <textarea
              style={{ ...inputStyle, minHeight: 140, resize: "vertical", lineHeight: 1.7 }}
              placeholder={"500g chicken thighs\n2 cups jasmine rice\n3 garlic cloves\n400ml coconut milk"}
              value={customIngredients}
              onChange={(e) => setCustomIngredients(e.target.value)}
              disabled={loading}
            />
          </div>
          <div>
            <div style={labelStyle}>Method <span style={{ color: "var(--text3)", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(write your own steps)</span></div>
            <textarea
              style={{ ...inputStyle, minHeight: 100, resize: "vertical", lineHeight: 1.7 }}
              placeholder={"1. Season chicken and marinate for 30 mins\n2. Heat oil in pan over high heat\n3. Cook chicken 5 mins each side..."}
              value={customMethod}
              onChange={(e) => setCustomMethod(e.target.value)}
              disabled={loading}
            />
          </div>

          {loading && (
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", background: "var(--accentbg)", borderRadius: "var(--radius2)", border: "1px solid var(--border2)" }}>
              <Spinner />
              <span style={{ fontSize: 13, color: "var(--accent2)" }}>{stage}</span>
            </div>
          )}
          {error && <div style={{ fontSize: 13, color: "var(--red)", padding: "10px 14px", background: "var(--redbg)", borderRadius: "var(--radius3)" }}>{error}</div>}

          <button
            style={{
              ...btnStyle, background: loading || !customName.trim() || !customIngredients.trim() ? "var(--bg4)" : "var(--accent)",
              color: loading || !customName.trim() || !customIngredients.trim() ? "var(--text3)" : "#fff",
              cursor: loading || !customName.trim() || !customIngredients.trim() ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            }}
            onClick={handleCustom}
            disabled={loading || !customName.trim() || !customIngredients.trim()}
          >
            {loading ? <><Spinner size={15} /> Saving recipe...</> : "Save to library →"}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("menu");
  const [library, setLibrary] = useState([]);
  const [week, setWeek] = useState(() => Object.fromEntries(DAYS.map((d) => [d, null]))); // {day: recipeId | null}
  const [shoppingList, setShoppingList] = useState([]); // [{item,category,combinedAmount,entries,checked}]
  const [storageReady, setStorageReady] = useState(false);
  const [banner, setBanner] = useState("");
  const [bannerTimer, setBannerTimer] = useState(null);

  // Library UI state
  const [libSection, setLibSection] = useState("all"); // "all" | "favourites" | cuisine name
  const [libSearch, setLibSearch] = useState("");

  // Menu: recipe picker modal
  const [pickerDay, setPickerDay] = useState(null); // day string or null

  // List: breakdown toggle per item
  const [expandedItems, setExpandedItems] = useState({});

  // ── Persistence ──
  useEffect(() => {
    async function load() {
      const lib = await sget(SK.library);
      const wk = await sget(SK.menu);
      const sl = await sget(SK.list);
      if (lib) setLibrary(lib);
      if (wk) setWeek(wk);
      if (sl) setShoppingList(sl);
      setStorageReady(true);
    }
    load();
  }, []);

  const saveLibrary = useCallback(async (lib) => { await sset(SK.library, lib); }, []);
  const saveWeek = useCallback(async (wk) => { await sset(SK.menu, wk); }, []);
  const saveList = useCallback(async (sl) => { await sset(SK.list, sl); }, []);

  function showBanner(msg) {
    setBanner(msg);
    if (bannerTimer) clearTimeout(bannerTimer);
    const t = setTimeout(() => setBanner(""), 4000);
    setBannerTimer(t);
  }

  // ── Library ops ──
  async function addToLibrary(recipe) {
    const updated = [recipe, ...library];
    setLibrary(updated); await saveLibrary(updated);
  }

  async function updateRecipe(updated) {
    const lib = library.map((r) => r.id === updated.id ? updated : r);
    setLibrary(lib); await saveLibrary(lib);
    // Update shopping list if this recipe is on menu
    rebuildShoppingList(week, lib);
  }

  async function deleteRecipe(id) {
    const lib = library.filter((r) => r.id !== id);
    setLibrary(lib); await saveLibrary(lib);
    // Remove from week if present
    const newWeek = { ...week };
    for (const day of DAYS) { if (newWeek[day] === id) newWeek[day] = null; }
    setWeek(newWeek); await saveWeek(newWeek);
    rebuildShoppingList(newWeek, lib);
  }

  async function toggleFav(id) {
    const lib = library.map((r) => r.id === id ? { ...r, favourite: !r.favourite } : r);
    setLibrary(lib); await saveLibrary(lib);
  }

  // ── Week / menu ops ──
  async function assignDay(day, recipeId) {
    const newWeek = { ...week, [day]: recipeId };
    setWeek(newWeek); setPickerDay(null);
    await saveWeek(newWeek);
    // Bump menuCount
    const lib = library.map((r) => {
      if (r.id !== recipeId) return r;
      const count = (r.menuCount || 0) + 1;
      return { ...r, menuCount: count, favourite: count >= 3 ? true : r.favourite };
    });
    setLibrary(lib); await saveLibrary(lib);
    rebuildShoppingList(newWeek, lib);
  }

  async function removeFromDay(day) {
    const newWeek = { ...week, [day]: null };
    setWeek(newWeek); await saveWeek(newWeek);
    rebuildShoppingList(newWeek, library);
  }

  // Swap (or move) the recipe between two days
  async function swapDays(fromDay, toDay) {
    if (fromDay === toDay) return;
    const newWeek = { ...week, [fromDay]: week[toDay], [toDay]: week[fromDay] };
    setWeek(newWeek);
    await saveWeek(newWeek);
    rebuildShoppingList(newWeek, library);
  }

  function rebuildShoppingList(wk, lib) {
    const assigned = DAYS.map((d) => wk[d]).filter(Boolean);
    const recipes = assigned.map((id) => lib.find((r) => r.id === id)).filter(Boolean);
    const list = buildShoppingList(recipes).map((item) => {
      const existing = shoppingList.find((i) => i.item.toLowerCase() === item.item.toLowerCase());
      return { ...item, checked: existing?.checked || false };
    });
    setShoppingList(list);
    saveList(list);
  }

  async function toggleListItem(idx) {
    const updated = shoppingList.map((item, i) => i === idx ? { ...item, checked: !item.checked } : item);
    setShoppingList(updated); await saveList(updated);
  }

  // ── Handle new import ──
  async function handleImported(recipe) {
    await addToLibrary(recipe);
    // Prompt: add to menu?
    setPickerDay("__new__");
    setPendingRecipe(recipe);
  }

  const [pendingRecipe, setPendingRecipe] = useState(null);

  // ── Derived ──
  const recipeById = (id) => library.find((r) => r.id === id);
  const menuRecipeIds = new Set(DAYS.map((d) => week[d]).filter(Boolean));

  const libFiltered = library.filter((r) => {
    const matchSearch = !libSearch || r.title.toLowerCase().includes(libSearch.toLowerCase());
    if (!matchSearch) return false;
    if (libSection === "favourites") return r.favourite;
    if (libSection === "all") return true;
    return r.cuisine === libSection;
  });

  const usedCuisines = [...new Set(library.map((r) => r.cuisine).filter(Boolean))];
  const whatsNew = [...library].sort((a, b) => b.addedAt - a.addedAt).slice(0, 5);
  const checkedCount = shoppingList.filter((i) => i.checked).length;

  const TABS = [
    { id: "menu", label: "Menu", icon: "📅" },
    { id: "library", label: "Library", icon: "📚" },
    { id: "list", label: "List", icon: "🛒" },
    { id: "import", label: "Import", icon: "＋" },
  ];

  return (
    <>
      <style>{THEME}</style>
      <div style={{ minHeight: "100vh", background: "var(--bg)", paddingBottom: 80 }}>

        {/* Header */}
        <header style={{
          position: "sticky", top: 0, zIndex: 100,
          background: "rgba(28,26,24,0.95)", backdropFilter: "blur(16px)",
          borderBottom: "1px solid var(--border)",
        }}>
          <div style={{ maxWidth: 680, margin: "0 auto", padding: "0 16px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 0 0" }}>
              <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 22, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.5px" }}>
                Menu<span style={{ color: "var(--accent)" }}>.</span>
              </div>
              {tab === "list" && shoppingList.length > 0 && (
                <div style={{ fontSize: 12, color: "var(--text2)", fontWeight: 500 }}>
                  <span style={{ color: "var(--accent)", fontWeight: 700 }}>{checkedCount}</span>/{shoppingList.length} items
                </div>
              )}
            </div>
            {/* Tab bar */}
            <div style={{ display: "flex", marginTop: 10 }}>
              {TABS.map((t) => (
                <button key={t.id} onClick={() => setTab(t.id)} style={{
                  flex: 1, padding: "10px 4px 12px",
                  border: "none", borderBottom: `2.5px solid ${tab === t.id ? "var(--accent)" : "transparent"}`,
                  background: "transparent",
                  fontSize: 12, fontWeight: 600, letterSpacing: "0.3px",
                  color: tab === t.id ? "var(--accent)" : "var(--text3)",
                  transition: "all 0.2s",
                }}>
                  <span style={{ marginRight: 5 }}>{t.icon}</span>{t.label}
                </button>
              ))}
            </div>
          </div>
        </header>

        {/* Banner */}
        {banner && (
          <div style={{
            position: "fixed", top: 80, left: "50%", transform: "translateX(-50%)",
            background: "var(--green)", color: "#fff",
            borderRadius: "var(--radius2)", padding: "10px 20px",
            fontSize: 13, fontWeight: 600, zIndex: 200,
            boxShadow: "var(--shadow)", animation: "fadeUp 0.3s ease",
            whiteSpace: "nowrap",
          }}>✓ {banner}</div>
        )}

        {/* Recipe picker modal (for "add to menu" after import) */}
        {pendingRecipe && pickerDay === "__new__" && (
          <div style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 300,
            display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
          }}>
            <div style={{ background: "var(--bg2)", borderRadius: "var(--radius)", padding: 24, width: "100%", maxWidth: 400, boxShadow: "var(--shadow)" }}>
              <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 18, fontWeight: 600, marginBottom: 6 }}>
                "{pendingRecipe.title}" added!
              </div>
              <div style={{ fontSize: 13, color: "var(--text2)", marginBottom: 18 }}>Add it to this week's menu?</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                {DAYS.map((d) => (
                  <button key={d} style={{
                    padding: "9px 12px", borderRadius: "var(--radius3)",
                    background: week[d] ? "var(--bg4)" : "var(--bg3)",
                    color: week[d] ? "var(--text3)" : "var(--text)",
                    fontSize: 13, fontWeight: 500,
                    border: `1.5px solid ${week[d] ? "var(--border)" : "var(--border2)"}`,
                    cursor: week[d] ? "not-allowed" : "pointer",
                    textAlign: "left",
                  }} onClick={() => { if (!week[d]) { assignDay(d, pendingRecipe.id); setPendingRecipe(null); setPickerDay(null); setTab("menu"); }}}
                  >
                    {d} {week[d] ? <span style={{ color: "var(--text3)", fontSize: 11 }}>(taken)</span> : ""}
                  </button>
                ))}
              </div>
              <button style={{ ...btnStyle, background: "var(--bg4)", color: "var(--text2)", width: "100%" }}
                onClick={() => { setPendingRecipe(null); setPickerDay(null); }}>
                Skip — just save to library
              </button>
            </div>
          </div>
        )}

        {/* Recipe picker modal (for menu day add) */}
        {pickerDay && pickerDay !== "__new__" && (
          <div style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 300,
            display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
          }} onClick={() => setPickerDay(null)}>
            <div style={{
              background: "var(--bg2)", borderRadius: "var(--radius)", padding: 20,
              width: "100%", maxWidth: 420, maxHeight: "80vh", overflow: "hidden",
              display: "flex", flexDirection: "column", boxShadow: "var(--shadow)",
            }} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <div>
                  <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 17, fontWeight: 600 }}>Pick a recipe</div>
                  <div style={{ fontSize: 12, color: "var(--accent)", marginTop: 2 }}>{pickerDay}</div>
                </div>
                <button style={{ background: "none", fontSize: 18, color: "var(--text3)", padding: 4 }} onClick={() => setPickerDay(null)}>✕</button>
              </div>
              {library.length === 0 ? (
                <div style={{ fontSize: 13, color: "var(--text2)", textAlign: "center", padding: "30px 0" }}>
                  No recipes in your library yet.<br />
                  <span style={{ color: "var(--accent)" }}>Go to Import to add one.</span>
                </div>
              ) : (
                <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
                  {library.map((r) => {
                    const onDays = Object.entries(week)
                      .filter(([d, id]) => id === r.id && d !== pickerDay)
                      .map(([d]) => d);
                    return (
                      <div key={r.id} style={{
                        padding: "12px 14px", borderRadius: "var(--radius3)",
                        background: "var(--bg3)",
                        border: `1.5px solid ${week[pickerDay] === r.id ? "var(--accent)" : "var(--border)"}`,
                        cursor: "pointer", transition: "border-color 0.15s",
                      }} onClick={() => assignDay(pickerDay, r.id)}>
                        <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{r.title}</div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {r.cuisine && <Tag>{r.cuisine}</Tag>}
                          {((r.prepTime || 0) + (r.cookTime || 0)) > 0 && <Tag>⏱ {(r.prepTime || 0) + (r.cookTime || 0)} min</Tag>}
                          {r.skillLevel && <Tag>{r.skillLevel}</Tag>}
                          {onDays.length > 0 && (
                            <Tag>📅 already on {onDays.map((d) => d.slice(0, 3)).join(", ")}</Tag>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Main content */}
        <div style={{ maxWidth: 680, margin: "0 auto", padding: "20px 16px" }}>

          {/* ══ MENU TAB ══ */}
          {tab === "menu" && (
            <div className="fade-up">
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 26, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>This Week</div>
                <div style={{ fontSize: 13, color: "var(--text2)" }}>
                  {DAYS.filter((d) => week[d]).length} of 7 nights planned
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {DAYS.map((day) => (
                  <DayCard
                    key={day}
                    day={day}
                    recipe={week[day] ? recipeById(week[day]) : null}
                    onAdd={(d) => setPickerDay(d)}
                    onRemove={removeFromDay}
                    onSwap={swapDays}
                  />
                ))}
              </div>
              {DAYS.some((d) => week[d]) && (
                <button
                  style={{ ...btnStyle, background: "var(--accent)", color: "#fff", width: "100%", marginTop: 16, fontSize: 14 }}
                  onClick={() => { rebuildShoppingList(week, library); setTab("list"); showBanner("Shopping list updated!"); }}
                >
                  🛒 Build shopping list from this week
                </button>
              )}
            </div>
          )}

          {/* ══ LIBRARY TAB ══ */}
          {tab === "library" && (
            <div className="fade-up">
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 26, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>Library</div>
                <div style={{ fontSize: 13, color: "var(--text2)" }}>{library.length} recipe{library.length !== 1 ? "s" : ""} saved</div>
              </div>

              {/* Search */}
              {library.length > 0 && (
                <input style={{ ...inputStyle, marginBottom: 16 }} placeholder="Search recipes..." value={libSearch} onChange={(e) => setLibSearch(e.target.value)} />
              )}

              {/* What's new */}
              {!libSearch && whatsNew.length > 0 && (
                <div style={{ marginBottom: 24 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: 10 }}>What's New</div>
                  <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 4 }}>
                    {whatsNew.map((r) => (
                      <div key={r.id} style={{
                        flexShrink: 0, width: 160, background: "var(--bg3)",
                        borderRadius: "var(--radius2)", padding: "12px 14px",
                        border: "1px solid var(--border2)",
                      }}>
                        <div style={{ fontSize: 11, color: platformColor(r.platform) || "var(--accent)", marginBottom: 4 }}>
                          {platformIcon(r.platform)} {platformLabel(r.platform)}
                        </div>
                        <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 13, fontWeight: 600, lineHeight: 1.3 }}>{r.title}</div>
                        {r.cuisine && <div style={{ fontSize: 11, color: "var(--text2)", marginTop: 4 }}>{r.cuisine}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Section tabs */}
              {library.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
                  {["all", "favourites", ...usedCuisines].map((s) => (
                    <button key={s} style={{
                      padding: "5px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600,
                      background: libSection === s ? "var(--accent)" : "var(--bg3)",
                      color: libSection === s ? "#fff" : "var(--text2)",
                      border: `1.5px solid ${libSection === s ? "var(--accent)" : "var(--border)"}`,
                      textTransform: s === "all" || s === "favourites" ? "capitalize" : "none",
                      transition: "all 0.15s",
                    }} onClick={() => setLibSection(s)}>
                      {s === "favourites" ? "⭐ Favourites" : s === "all" ? "All" : s}
                    </button>
                  ))}
                </div>
              )}

              {/* Recipe cards */}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {libFiltered.map((r) => (
                  <RecipeCard
                    key={r.id}
                    recipe={r}
                    isOnMenu={menuRecipeIds.has(r.id)}
                    onAddToMenu={(recipe) => setPickerDay(DAYS.find((d) => !week[d]) || DAYS[0])}
                    onToggleFav={toggleFav}
                    onDelete={deleteRecipe}
                    onEdit={updateRecipe}
                  />
                ))}
              </div>

              {library.length === 0 && storageReady && (
                <div style={{ textAlign: "center", padding: "60px 20px" }}>
                  <div style={{ fontSize: 48, marginBottom: 16 }}>📚</div>
                  <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 20, marginBottom: 8 }}>Your library is empty</div>
                  <div style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.6, maxWidth: 280, margin: "0 auto 20px" }}>
                    Import a recipe from Instagram, TikTok or YouTube — or create your own.
                  </div>
                  <button style={{ ...btnStyle, background: "var(--accent)", color: "#fff" }} onClick={() => setTab("import")}>
                    Go to Import →
                  </button>
                </div>
              )}

              {library.length > 0 && libFiltered.length === 0 && (
                <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text2)", fontSize: 13 }}>
                  No recipes match "{libSearch || libSection}"
                </div>
              )}
            </div>
          )}

          {/* ══ LIST TAB ══ */}
          {tab === "list" && (
            <div className="fade-up">
              <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 20 }}>
                <div>
                  <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 26, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>Shopping List</div>
                  <div style={{ fontSize: 13, color: "var(--text2)" }}>
                    {DAYS.filter((d) => week[d]).length} recipes · {shoppingList.length} items
                  </div>
                </div>
                {checkedCount > 0 && (
                  <button style={{ ...btnStyle, background: "var(--bg3)", color: "var(--text2)", padding: "7px 14px", fontSize: 12 }}
                    onClick={async () => {
                      const updated = shoppingList.filter((i) => !i.checked);
                      setShoppingList(updated); await saveList(updated);
                    }}>
                    Clear checked ({checkedCount})
                  </button>
                )}
              </div>

              {shoppingList.length === 0 ? (
                <div style={{ textAlign: "center", padding: "60px 20px" }}>
                  <div style={{ fontSize: 48, marginBottom: 16 }}>🛒</div>
                  <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 20, marginBottom: 8 }}>List is empty</div>
                  <div style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.6, maxWidth: 280, margin: "0 auto 20px" }}>
                    Plan your week on the Menu tab, then build your shopping list.
                  </div>
                  <button style={{ ...btnStyle, background: "var(--accent)", color: "#fff" }} onClick={() => setTab("menu")}>Go to Menu →</button>
                </div>
              ) : (
                GROCERY_CATS.map((cat) => {
                  const catItems = shoppingList.filter((i) => i.category === cat.id);
                  if (catItems.length === 0) return null;
                  return (
                    <div key={cat.id} style={{ marginBottom: 24 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                        <span style={{ fontSize: 16 }}>{cat.icon}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "1px" }}>{cat.label}</span>
                        <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
                        <span style={{ fontSize: 11, color: "var(--text3)" }}>
                          {catItems.filter((i) => i.checked).length}/{catItems.length}
                        </span>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {catItems.map((item, idx) => {
                          const globalIdx = shoppingList.findIndex((i) => i === item);
                          const isExpanded = expandedItems[item.item];
                          const hasBreakdown = item.entries?.length > 1;
                          return (
                            <div key={item.item} style={{
                              background: "var(--bg2)", borderRadius: "var(--radius3)",
                              border: `1.5px solid ${item.checked ? "var(--border)" : "var(--border2)"}`,
                              overflow: "hidden", transition: "border-color 0.2s",
                            }}>
                              <div
                                style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 14px", cursor: "pointer" }}
                                onClick={() => toggleListItem(globalIdx)}
                              >
                                <div style={{
                                  width: 20, height: 20, borderRadius: 5,
                                  border: `2px solid ${item.checked ? "var(--accent)" : "var(--border2)"}`,
                                  background: item.checked ? "var(--accent)" : "transparent",
                                  display: "flex", alignItems: "center", justifyContent: "center",
                                  flexShrink: 0, transition: "all 0.15s",
                                }}>
                                  {item.checked && <span style={{ color: "#fff", fontSize: 11, fontWeight: 700 }}>✓</span>}
                                </div>
                                <span style={{
                                  fontSize: 13, fontWeight: 600,
                                  color: item.checked ? "var(--text3)" : "var(--accent2)",
                                  minWidth: 70, flexShrink: 0,
                                  textDecoration: item.checked ? "line-through" : "none",
                                }}>
                                  {item.combinedAmount}
                                </span>
                                <span style={{
                                  flex: 1, fontSize: 14,
                                  color: item.checked ? "var(--text3)" : "var(--text)",
                                  textDecoration: item.checked ? "line-through" : "none",
                                  transition: "all 0.15s",
                                }}>{item.item}</span>
                                {hasBreakdown && (
                                  <button
                                    style={{ background: "none", fontSize: 11, color: "var(--text3)", padding: "2px 6px", borderRadius: 4, border: "1px solid var(--border)" }}
                                    onClick={(e) => { e.stopPropagation(); setExpandedItems((prev) => ({ ...prev, [item.item]: !prev[item.item] })); }}
                                  >
                                    {isExpanded ? "▲" : "▼"}
                                  </button>
                                )}
                              </div>
                              {isExpanded && hasBreakdown && (
                                <div style={{ borderTop: "1px solid var(--border)", padding: "8px 14px 10px 46px" }}>
                                  {item.entries.map((e, i) => (
                                    <div key={i} style={{ display: "flex", gap: 12, fontSize: 12, color: "var(--text2)", padding: "2px 0" }}>
                                      <span style={{ color: "var(--text3)", minWidth: 60, flexShrink: 0 }}>{e.amount}</span>
                                      <span>{e.recipe}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* ══ IMPORT TAB ══ */}
          {tab === "import" && (
            <ImportPage library={library} onImported={handleImported} showBanner={showBanner} />
          )}
        </div>
      </div>
    </>
  );
}

function platformColor(p) {
  return { instagram: "#E1306C", tiktok: "#69C9D0", youtube: "#FF0000", custom: "var(--accent)" }[p] || "var(--text2)";
}
