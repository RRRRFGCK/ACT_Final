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

    const extractModelUsed = getExtractModel();
    const solveModelUsed = getSolveModel();
    const extracted = await extractQuestionFromImage(apiKey, imageDataUrl, extractModelUsed);
    const relevantChunks = findRelevantMaterialChunks(extracted, 5);
    const located = relevantChunks.length
      ? await locateLectureContext(apiKey, extracted, relevantChunks, extractModelUsed)
      : {};
    const solved = await solveWithLectureContext(apiKey, extracted, relevantChunks, located, solveModelUsed);

    response.status(200).json({
      ...extracted,
      ...located,
      ...solved,
      sourceRefs: located.sourceRefs || solved.sourceRefs || relevantChunks.map((chunk) => chunk.ref),
      modelUsed: `extract+chapter ${extractModelUsed} / answer+explanation ${solveModelUsed}`,
      extractModelUsed,
      solveModelUsed,
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

function getExtractModel() {
  return process.env.OPENAI_EXTRACT_MODEL || "gpt-4.1-mini";
}

function getSolveModel() {
  return process.env.OPENAI_SOLVE_MODEL || process.env.OPENAI_MODEL || "gpt-5.5";
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
              "Do not leave blanks for mathematical variables, numbers, antenna counts, angles, matrix symbols, vectors, subscripts, or directions. If the image contains N, M, theta, phi, d, lambda, R, x, s, or similar values, transcribe them explicitly.",
              "Use LaTeX for exponents, matrices, subscripts, Greek letters, probabilities, covariance matrices, vectors, and equations. Wrap every mathematical expression in $...$ so it can be rendered by MathJax, for example $\\sqrt{4^2 + 1.5^2} = 4.272$.",
              "For matrices, prefer LaTeX such as $\\begin{bmatrix} ... \\end{bmatrix}$ with rows separated by \\\\ and columns by &. Do not output MATLAB copy instructions as the only matrix representation.",
              "Keep option labels as A, B, C, D, E when present.",
              "If a visible tick, x mark, bracket, highlight, or handwritten mark clearly indicates an answer, put that label in correctAnswer; otherwise leave correctAnswer empty.",
              "Do not solve the question in this step. Leave answer and explanation empty unless they are explicitly visible in the image.",
              "Still prioritize accurate transcription of the visible question and options. If any required value is unreadable, write [unreadable] rather than leaving a blank."
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

async function locateLectureContext(apiKey, extracted, chunks, modelUsed = getExtractModel()) {
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
              "Locate this Imperial CSP Advanced Communication Theory question in the lecture context.",
              "Do not solve the question and do not generate an explanation.",
              "Return only valid JSON with this schema:",
              "{\"chapter\": string, \"knowledgePoint\": string, \"sourceRefs\": string[]}",
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

async function solveWithLectureContext(apiKey, extracted, chunks, located, modelUsed = getSolveModel()) {
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
              "Only this step should solve the question and write the explanation.",
              "Use the provided lecture location and context when helpful.",
              "Return only valid JSON with this schema:",
              "{\"correctAnswer\": string, \"answer\": string, \"explanation\": string}",
              "The answer field must contain only the final answer value/content, not the option label and not a sentence like 'correct answer is B'.",
              "The explanation must be in Chinese and start with a short source line like: 课件定位：ACT_2 Diversity Theory, page 12；知识点：...",
              "After the main solution, add an option-by-option section when useful. For each option whose underlying knowledge point, formula, assumption, or common trap differs, explain briefly why it is correct or wrong.",
              "If several options differ only by numerical substitution, keep the comparison concise. If options reflect different concepts or formulas, explain them in more detail.",
              "Use clear labels like A、B、C、D in the explanation section, but keep the answer field as final content only.",
              "Use MathJax-ready LaTeX with $...$ around math. Do not leave empty math delimiters or incomplete formulas.",
              "Use real line breaks in JSON strings, not literal \\n text. Never output visible \\n or \\t sequences in the explanation.",
              "If the lecture context is not enough, say 基于课件相关页和题目推导 in the explanation, but still answer if possible.",
              "Question JSON:",
              JSON.stringify(extracted),
              "Lecture location JSON:",
              JSON.stringify(located || {}),
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









