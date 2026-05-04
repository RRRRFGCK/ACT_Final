const fs = require("fs");
const path = require("path");

let materialIndexCache = null;

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    response.status(500).json({ error: "OPENAI_API_KEY is not configured in Vercel." });
    return;
  }

  try {
    const { imageDataUrl } = request.body || {};
    if (!imageDataUrl || !imageDataUrl.startsWith("data:image/")) {
      response.status(400).json({ error: "Missing imageDataUrl." });
      return;
    }

    const modelUsed = getOpenAIModel();
    const extracted = await extractQuestionFromImage(apiKey, imageDataUrl, modelUsed);
    const relevantChunks = findRelevantMaterialChunks(extracted, 5);
    const enriched = relevantChunks.length
      ? await enrichWithLectureContext(apiKey, extracted, relevantChunks, modelUsed)
      : extracted;

    response.status(200).json({
      ...extracted,
      ...enriched,
      sourceRefs: enriched.sourceRefs || relevantChunks.map((chunk) => chunk.ref),
      modelUsed,
      matchedMaterials: relevantChunks.map((chunk) => ({
        ref: chunk.ref,
        lecture: chunk.lecture,
        title: chunk.title,
        page: chunk.page
      }))
    });
  } catch (error) {
    response.status(500).json({ error: error.message || "Extraction failed." });
  }
};

function getOpenAIModel() {
  return process.env.OPENAI_MODEL || "gpt-5.5";
}

async function extractQuestionFromImage(apiKey, imageDataUrl, modelUsed) {
  const openaiResponse = await callOpenAI(apiKey, {
    model: modelUsed,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: [
              "Extract this multiple-choice practice question from the image. The original image will be displayed to students, so the question text can be a clean searchable transcription/index rather than a perfect redraw of diagrams.",
              "Return only valid JSON, with no markdown fences.",
              "Schema: {\"question\": string, \"options\": [{\"label\": \"A\", \"text\": string}], \"correctAnswer\": string, \"answer\": string, \"explanation\": string, \"notes\": string}.",
              "Extract every visible option as a separate options array item. Preserve mathematical notation carefully.",
              "Use LaTeX for exponents, matrices, subscripts, Greek letters, probabilities, and equations. Wrap every mathematical expression in $...$ so it can be rendered by MathJax, for example $\\sqrt{4^2 + 1.5^2} = 4.272$.",
              "Keep option labels as A, B, C, D, E when present.",
              "If a visible tick, x mark, bracket, highlight, or handwritten mark clearly indicates an answer, put that label in correctAnswer.",
              "If no answer is visibly marked, solve the question and put the best option label in correctAnswer.",
              "Put only the final answer value/content in answer, not a sentence and not the option label. For example, use \"60.625\" or \"6.25 \\times 10^{-6}\", not \"The correct answer is B\" and not \"B\".",
              "Write a concise Chinese explanation in explanation, including the key formula and steps. The explanation may mention the option label, but answer must not.",
              "Still prioritize accurate transcription of the visible question and options."
            ].join(" ")
          },
          {
            type: "input_image",
            image_url: imageDataUrl,
            detail: "high"
          }
        ]
      }
    ]
  });

  return parseJsonOutput(extractOutputText(openaiResponse));
}

async function enrichWithLectureContext(apiKey, extracted, chunks, modelUsed = getOpenAIModel()) {
  const context = chunks.map((chunk, index) => [
    `[${index + 1}] ${chunk.ref}`,
    chunk.content
  ].join("\n")).join("\n\n---\n\n");

  const response = await callOpenAI(apiKey, {
    model: modelUsed,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: [
              "You are helping with Imperial CSP Advanced Communication Theory revision.",
              "Use the provided lecture context to refine the answer and explanation for this multiple-choice question.",
              "Return only valid JSON with this schema:",
              "{\"correctAnswer\": string, \"answer\": string, \"chapter\": string, \"knowledgePoint\": string, \"sourceRefs\": string[], \"explanation\": string}",
              "The answer field must contain only the final answer value/content, not the option label and not a sentence like 'correct answer is B'.",
              "The explanation must be in Chinese and start with a short source line like: 课件定位：ACT_2 Diversity Theory, page 12；知识点：...",
              "Use MathJax-ready LaTeX with $...$ around math.",
              "If the lecture context is not enough, say 基于课件相关页和题目推导 in the explanation, but still answer if possible.",
              "Question JSON:",
              JSON.stringify(extracted),
              "Lecture context:",
              context
            ].join("\n")
          }
        ]
      }
    ]
  });

  return parseJsonOutput(extractOutputText(response));
}

async function callOpenAI(apiKey, body) {
  const openaiResponse = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const data = await openaiResponse.json();
  if (!openaiResponse.ok) {
    throw new Error(data.error?.message || "OpenAI request failed.");
  }
  return data;
}

function loadMaterialIndex() {
  if (materialIndexCache) return materialIndexCache;
  const indexPath = path.join(process.cwd(), "materials-index.json");
  if (!fs.existsSync(indexPath)) {
    materialIndexCache = { chunks: [] };
    return materialIndexCache;
  }
  materialIndexCache = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  return materialIndexCache;
}

function findRelevantMaterialChunks(extracted, limit = 5) {
  const index = loadMaterialIndex();
  const query = [
    extracted.question,
    (extracted.options || []).map((option) => option.text).join(" "),
    extracted.answer,
    extracted.explanation
  ].join(" ");
  const queryTokens = tokenSet(query);
  if (!queryTokens.size) return [];

  return (index.chunks || [])
    .map((chunk) => {
      const content = `${chunk.title} ${chunk.content}`;
      const tokens = tokenSet(content);
      let overlap = 0;
      queryTokens.forEach((token) => {
        if (tokens.has(token)) overlap += token.length > 5 ? 2 : 1;
      });
      const phraseBoost = importantPhrases(query).filter((phrase) => content.toLowerCase().includes(phrase)).length * 4;
      return { ...chunk, score: overlap + phraseBoost };
    })
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function tokenSet(text) {
  const stop = new Set(["the", "and", "for", "with", "this", "that", "which", "from", "have", "over", "then", "where", "are", "is", "of", "to", "in", "a", "an"]);
  return new Set(String(text || "")
    .toLowerCase()
    .replace(/\\[a-z]+/g, " ")
    .match(/[a-z0-9_]{3,}/g)
    ?.filter((token) => !stop.has(token)) || []);
}

function importantPhrases(text) {
  const lower = String(text || "").toLowerCase();
  const phrases = [
    "diversity", "mimo", "miso", "simo", "array receiver", "beamforming", "localisation", "localization",
    "maximum ratio", "selection combining", "awgn", "gaussian", "noise", "transition matrix", "correlation",
    "rayleigh", "rician", "channel capacity", "outage", "alamouti", "matched filter", "mrc", "doa"
  ];
  return phrases.filter((phrase) => lower.includes(phrase));
}

function extractOutputText(data) {
  if (data.output_text) return data.output_text;
  return (data.output || [])
    .flatMap((item) => item.content || [])
    .map((content) => content.text || "")
    .filter(Boolean)
    .join("\n");
}

function parseJsonOutput(text) {
  const cleaned = String(text || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("AI did not return valid JSON.");
  }
}


