import { GoogleGenAI } from "@google/genai";
import type { Feed, RiskScore, Allocation } from "../shared/types.js";

// The brain narrates each decision in plain language. It reuses the Aegis Gemini
// setup, Vertex with application default credentials, model gemini-3.5-flash. The
// rationale is additive, a failure here never blocks a cycle, the allocation always
// comes from the bounded decideAllocation function, the model only explains it.
const MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";
const LOCATION = process.env.GEMINI_LOCATION ?? "global";

function project(): string {
  return (
    process.env.GOOGLE_CLOUD_PROJECT ??
    process.env.GCP_PROJECT ??
    "project-2e209fc7-df34-4bcc-925"
  );
}

// Plain style, no AI tells, no dashes or parentheses or hyphen jargon.
const STYLE =
  "Write one short plain sentence. No dashes, no parentheses, no hyphenated jargon. " +
  "State why this allocation fits the current price move and risk.";

export async function explainDecision(
  feed: Feed,
  risk: RiskScore,
  alloc: Allocation,
): Promise<string> {
  const fallback = `Risk ${risk.score} on a ${feed.changePct24h.toFixed(
    2,
  )} percent move, so the vault holds ${alloc.conservative} conservative and ${
    alloc.growth
  } growth.`;
  const TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS ?? 8000);
  try {
    const ai = new GoogleGenAI({ vertexai: true, project: project(), location: LOCATION });
    const prompt =
      `${STYLE}\n` +
      `Asset CSPR price ${feed.price}, 24h move ${feed.changePct24h.toFixed(2)} percent. ` +
      `Risk score ${risk.score} out of 100. ` +
      `Chosen allocation conservative ${alloc.conservative} growth ${alloc.growth}.`;
    const call = ai.models.generateContent({ model: MODEL, contents: prompt });
    const timeout = new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error("gemini timeout")), TIMEOUT_MS),
    );
    const resp: any = await Promise.race([call, timeout]);
    const text = (resp.text ?? "").trim();
    return text.length > 0 ? text : fallback;
  } catch {
    return fallback;
  }
}
