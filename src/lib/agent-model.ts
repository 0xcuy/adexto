/**
 * Which model answers a market's chat panel, and how the market page names it.
 *
 * A market record stores `agentModel` as free text written at launch, for example
 * "0G Router (glm-5.3)" or, on three early markets, "0G Router (glm-5.3 · Intel TDX attested)".
 * The chat call used to ignore it and always ask for glm-5.3, so a market launched with another
 * model showed one name and answered with another. Both now come from this function: the first
 * known model id found in the stored text, or glm-5.3 when there is none.
 *
 * The label names the model and where it runs, and nothing else. Attestation is not repeated
 * here: the router reports Intel TDX for these models, ADEXTO does not verify the quote, and
 * that caveat lives on /docs where it can be stated in full.
 *
 * Keep the ids in step with `MODELS` in src/app/studio/page.tsx and `AGENT_MODEL_IDS` in
 * src/lib/og-attestation.ts.
 */
const KNOWN_MODELS = [
  // Longest id first: "0gm-1.0-35b-a3b-sia" contains "0gm-1.0-35b-a3b".
  { id: "0gm-1.0-35b-a3b-sia", name: "0GM-1.0 SIA" },
  { id: "0gm-1.0-35b-a3b", name: "0GM-1.0 35B" },
  { id: "glm-5.3", name: "GLM-5.3" },
] as const;

const DEFAULT_MODEL = KNOWN_MODELS[2];

export function marketChatModel(agentModel: string | null | undefined): { id: string; label: string } {
  const text = String(agentModel ?? "").toLowerCase();
  const model = KNOWN_MODELS.find((m) => text.includes(m.id)) ?? DEFAULT_MODEL;
  return { id: model.id, label: `Chat: ${model.name} on 0G Router` };
}
