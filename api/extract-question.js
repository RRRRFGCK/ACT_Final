export default async function handler(request, response) {
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

    const openaiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
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
                  "Use LaTeX for exponents, matrices, subscripts, Greek letters, probabilities, and equations.",
                  "Keep option labels as A, B, C, D, E when present.",
                  "If a visible tick, x mark, bracket, highlight, or handwritten mark clearly indicates an answer, put that label in correctAnswer.",
                  "If no answer is visibly marked, solve the question and put the best option label in correctAnswer.",
                  "Put the final answer in answer.",
                  "Write a concise Chinese explanation in explanation, including the key formula and steps.",
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
      })
    });

    const data = await openaiResponse.json();
    if (!openaiResponse.ok) {
      response.status(openaiResponse.status).json({ error: data.error?.message || "OpenAI request failed." });
      return;
    }

    const outputText = extractOutputText(data);
    response.status(200).json(parseJsonOutput(outputText));
  } catch (error) {
    response.status(500).json({ error: error.message || "Extraction failed." });
  }
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


