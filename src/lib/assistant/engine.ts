/**
 * Engine registry. Swap the active engine here.
 *
 * Planned: an `LlmAssistantEngine` that POSTs to /api/assistant, where a
 * server-side model call uses tool definitions mirroring ProposedAction.
 * The server returns proposals only; the client still confirms + executes.
 */
import type { AssistantEngine } from "./types";
import { DemoAssistantEngine } from "./demo-engine";

let engine: AssistantEngine | null = null;

export function getAssistantEngine(): AssistantEngine {
  engine ??= new DemoAssistantEngine();
  return engine;
}
