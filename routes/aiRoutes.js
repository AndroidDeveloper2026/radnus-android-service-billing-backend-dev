const express = require("express");
const jwt = require("jsonwebtoken");
const { tools, runTool } = require("../services/aiTools");

const router = express.Router();

// Model names change over time. Set GEMINI_MODEL in .env to override the primary model.
// If the primary model is busy/overloaded, we automatically fall back to the next ones.
const PRIMARY_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const FALLBACK_MODELS = (process.env.GEMINI_FALLBACK_MODELS ||
  "gemini-3.7-flash,gemini-3.5-flash,gemini-3.5-flash-lite")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);
const MODELS = [PRIMARY_MODEL, ...FALLBACK_MODELS.filter((m) => m !== PRIMARY_MODEL)];
const geminiUrl = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

// Admin only for now
const ALLOWED_ROLES = ["admin"];

// Convert the tools defined in aiTools.js into Gemini's format
const functionDeclarations = tools.map((t) => ({
  name: t.name,
  description: t.description,
  parameters: t.input_schema,
}));

/* ---------- JWT check ---------- */
function auth(req, res, next) {
  try {
    const h = req.headers.authorization || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Login required" });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!ALLOWED_ROLES.includes(decoded.role)) {
      return res.status(403).json({ error: "This feature is for admins only." });
    }
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callGemini(body) {
  const TRIES_PER_MODEL = 2;
  const TIMEOUT_MS = 20000; // if a model doesn't answer in 20s, give up on it
  let lastErr;

  for (const model of MODELS) {
    for (let attempt = 1; attempt <= TRIES_PER_MODEL; attempt++) {
      console.log(`Calling Gemini model ${model} (attempt ${attempt})...`);
      let r, data;
      try {
        r = await fetch(geminiUrl(model), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": process.env.GEMINI_API_KEY,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        data = await r.json();
      } catch (netErr) {
        lastErr = netErr;
        lastErr.status = 503;
        if (netErr.name === "TimeoutError" || netErr.name === "AbortError") {
          // model is hanging -> don't wait again, go to next model
          console.log(`Gemini ${model} timed out after ${TIMEOUT_MS / 1000}s, trying next model...`);
          break;
        }
        console.log(`Gemini network error on ${model}: ${netErr.message} (attempt ${attempt}/${TRIES_PER_MODEL})`);
        await sleep(1000 * attempt);
        continue;
      }

      if (r.ok) {
        if (model !== PRIMARY_MODEL) console.log(`Answered using fallback model: ${model}`);
        return data;
      }

      lastErr = new Error(data?.error?.message || `Gemini HTTP ${r.status}`);
      lastErr.status = r.status;

      // 500/503 = temporary overload -> short retry on same model, then next model
      if ([500, 503].includes(r.status)) {
        console.log(`Gemini ${model} busy (HTTP ${r.status}), attempt ${attempt}/${TRIES_PER_MODEL}...`);
        if (attempt < TRIES_PER_MODEL) await sleep(1000 * attempt + Math.random() * 500);
        continue;
      }

      // 429 = this model's quota is used up, 404 = model not available for this key.
      // Retrying the same model is useless, so jump straight to the next model.
      if ([429, 404].includes(r.status)) {
        console.log(`Gemini ${model} unavailable (HTTP ${r.status}), trying next model...`);
        break;
      }

      // 400 / 401 / 403 etc = our own request or key problem. Fallback won't help.
      throw lastErr;
    }
  }

  throw lastErr;
}

router.post("/ask", auth, async (req, res) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: "AI key not configured" });
    }

    const question = String(req.body.question || "").slice(0, 500).trim();
    if (!question) return res.status(400).json({ error: "Question required" });

    const history = (Array.isArray(req.body.history) ? req.body.history : [])
      .slice(-6)
      .filter((m) => m && ["user", "assistant"].includes(m.role))
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: String(m.content).slice(0, 1500) }],
      }));

    const system = `You are "Ask Radnus AI", a business insights assistant for Radnus service (mobile repair) billing software.
Today is ${new Date().toISOString().slice(0, 10)}. Currency is INR (₹).
Use ONLY the provided tools for numbers. Never guess or invent figures. If a tool returns nothing, say there is no data for that period.
Convert phrases like "this month", "last week", "yesterday" into exact from/to dates (YYYY-MM-DD).
"Profit" means service charge (income minus spare and others).
Only one store exists right now; if asked to compare stores, say store-wise data is not available yet.
Reply short and simple, in the same language as the question (English, Tamil or Tanglish). Plain text only. For several rows use "-" lists.`;

    const contents = [...history, { role: "user", parts: [{ text: question }] }];
    let answer = "";

    for (let i = 0; i < 4; i++) {
      const data = await callGemini({
        systemInstruction: { parts: [{ text: system }] },
        contents,
        tools: [{ functionDeclarations }],
        generationConfig: { maxOutputTokens: 800, temperature: 0.2 },
      });

      const content = data.candidates?.[0]?.content;
      const parts = content?.parts || [];
      const calls = parts.filter((p) => p.functionCall);

      if (calls.length === 0) {
        answer = parts.map((p) => p.text || "").join("").trim();
        break;
      }

      // The model's tool-call message must be sent back as-is
      contents.push(content);

      const responseParts = [];
      for (const p of calls) {
        let out;
        try {
          out = await runTool(p.functionCall.name, p.functionCall.args || {});
        } catch (e) {
          console.error("AI TOOL ERROR:", p.functionCall.name, e.message);
          out = { error: "Query failed" };
        }
        responseParts.push({
          functionResponse: {
            name: p.functionCall.name,
            response: { result: out },
          },
        });
      }
      contents.push({ role: "user", parts: responseParts });
    }

    res.json({
      answer: answer || "Sorry, I could not prepare an answer. Please try again.",
    });
  } catch (err) {
    console.error("AI ERROR:", err.message);
    if (err.status === 429) {
      return res.status(429).json({
        error: "Today's free AI limit has been reached. Please try again tomorrow.",
      });
    }
    if (err.status === 503 || err.status === 500) {
      return res.status(503).json({
        error: "AI is very busy right now. Please try again in a minute.",
      });
    }
    res.status(500).json({ error: "AI service error" });
  }
});

module.exports = router;