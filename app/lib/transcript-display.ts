import type { TranscriptEvent, TranscriptSession } from "./transcript-types";

export function sourceName(value: string) {
  return /claude/i.test(value) ? "Claude Code" : /codex/i.test(value) ? "Codex" : value || "Agent";
}
export function sessionTitle(session: TranscriptSession) {
  return session.first_user_message_preview?.trim() || `${projectName(session.project_key)} · ${new Date(session.first_seen_at).toLocaleDateString("en", { month: "short", day: "numeric" })}`;
}
export function projectName(value: string) {
  return value.replace(/\\/g, "/").replace(/\/$/, "").split("/").filter(Boolean).pop() || value || "No project";
}
export function eventLabel(event: TranscriptEvent) {
  if ((event.actor_type || event.actor || "").toUpperCase() === "USER" || event.role === "user") return "You";
  if ((event.actor_type || event.actor || "").toUpperCase() === "TOOL") return event.tool_name || "Tool result";
  if (event.event_kind === "tool_call") return event.tool_name || "Tool call";
  if ((event.actor_type || event.actor || "").toUpperCase() === "ASSISTANT" || event.role === "assistant") return "Assistant";
  return event.event_type?.replace(/[_-]/g, " ") || "Event";
}
export function eventTone(event: TranscriptEvent) {
  if (event.status === "FAILED" || event.event_kind === "problem") return "error";
  if ((event.actor_type || event.actor || "").toUpperCase() === "USER" || event.role === "user") return "user";
  if ((event.actor_type || event.actor || "").toUpperCase() === "TOOL" || event.event_kind === "tool_call") return "tool";
  if ((event.actor_type || event.actor || "").toUpperCase() === "ASSISTANT") return "assistant";
  return "system";
}
export function shortTime(value: string | null) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";
}
export function duration(value: number | null) {
  return value == null ? null : value < 1000 ? `${value} ms` : `${(value / 1000).toFixed(value < 10000 ? 1 : 0)} s`;
}
export function mergeEvents(previous: TranscriptEvent[], incoming: TranscriptEvent[], limit = 100) {
  const events = new Map(previous.map(event => [event.id, event]));
  incoming.forEach(event => events.set(event.id, event));
  return [...events.values()].sort((a, b) => {
    const left = BigInt(a.event_seq_decimal), right = BigInt(b.event_seq_decimal);
    return left < right ? -1 : left > right ? 1 : a.id.localeCompare(b.id);
  }).slice(-limit);
}
export function queryPath(base: string, values: Record<string, string | number | null | undefined>) {
  const query = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => { if (value !== null && value !== undefined && value !== "") query.set(key, String(value)); });
  return `${base}${query.size ? `?${query}` : ""}`;
}
