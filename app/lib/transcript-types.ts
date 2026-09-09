export type CursorPage<T> = { items: T[]; next_cursor: string | null; truncated?: boolean };
export type TranscriptSession = {
  id: string; project_id: string; project_key: string; source: string;
  session_key: string; external_session_id: string | null;
  first_seen_at: string; last_seen_at: string; event_count: number; segment_count: number;
  final_segment_seen: boolean; storage_state: string; exact_payload_available: boolean;
  first_user_message_preview?: string | null; latest_event_seq_decimal?: string | null;
  analysis_run_id?: string | null; analysis_watermark_decimal?: string | null;
};
export type TranscriptEvent = {
  id: string; session_id: string; event_seq_decimal: string; epoch?: number;
  event_kind: string; event_type?: string; actor_type?: string; actor?: string; role: string | null;
  tool_name: string | null; tool_call_id: string | null; status: string | null;
  duration_ms: number | null; occurred_at: string | null; ingested_at: string;
  content_text: string | null; exact_payload_available: boolean;
  content_text_truncated?: boolean; payload_json_truncated?: boolean;
};
export type ContentSection = {
  id: string; kind: string; format: string; label: string; preview: string;
  total_chars: number; tool_call_id: string | null; tool_name?: string | null;
};
export type EventDetail = {
  event: TranscriptEvent; is_current?: boolean; content_version: string | null; sections: ContentSection[];
  next_sections_cursor: string | null;
};
export type ContentChunk = { content_version: string; text: string; next_cursor: string | null; complete: boolean };
export type RelatedEvent = { event_id: string; section_id: string; tool_call_id?: string; direction?: string; kind?: string; tool_name?: string | null; label?: string };
export type ProcessStep = {
  id: string; ordinal: number; kind: string; status: string; title: string; summary: string | null;
  tool_name: string | null; occurred_at: string | null; ended_at: string | null; confidence: number;
  resources: { id: string; resource_type: string; display_name: string; uri: string | null; role: string }[];
};
export type ProcessTimeline = {
  analysis_run_id: string; freshness_watermark_decimal: string; steps: ProcessStep[];
  links: { id: string; source_step_id: string; target_step_id: string; kind: string }[];
  next_cursor: string | null; truncated: boolean;
};
export type ProcessEvidence = { id: string; event_id: string; snippet_text: string; event_seq_decimal: string; event_kind: string; occurred_at: string | null };
export type EventTail = {
  items: TranscriptEvent[]; tail_cursor: string; history_cursor: string | null;
  has_more: boolean; reset_required: boolean; latest_event_seq_decimal?: string | null;
  analysis_run_id: string | null; analysis_watermark_decimal?: string | null;
};
