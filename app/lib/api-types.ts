export type PublicStatsCounters = {
  total_tokens: number;
  messages_count: number;
  recommendations_count: number;
};

export type PublicStatsSummary = {
  all_time: PublicStatsCounters;
  last_24h: PublicStatsCounters;
  generated_at: string;
  cache_ttl_seconds: number;
};

export type GitHubRepoStats = {
  full_name: string;
  html_url: string;
  stargazers_count: number;
  generated_at: string;
  cache_ttl_seconds: number;
};

export type DashboardSummary = {
  saved_sessions_count: number;
  saved_sessions_delta_24h: number;
  saved_messages_count: number;
  saved_messages_delta_24h?: number;
  processed_tokens_total: number;
  processed_tokens_delta_24h: number;
  unique_projects_count: number;
  unique_projects_delta_24h?: number;
  recommendations_count?: number;
  recommendations_delta_24h?: number;
};

export type DailyActivityPoint = {
  day: string;
  sessions_count: number;
  messages_count: number;
  projects_count: number;
  recommendations_count: number;
  processed_tokens_total: number;
};

export type RecommendationMetadata = {
  id: string;
  title: string;
  project_key: string | null;
  session_count: number;
  result_type: "recommendation" | "process_improvement_idea" | "insufficient_evidence" | "legacy";
  intervention_type: "script" | "skill" | "instruction" | "workflow_change" | null;
  created_at: string;
};

export type Recommendation = RecommendationMetadata & {
  preview_markdown: string;
};

export type RecommendationPage = {
  items: Recommendation[];
  page: number;
  page_size: number;
  total: number;
};

export type RecommendationDetail = RecommendationMetadata & {
  report_markdown: string;
};

export type DashboardData = {
  summary: DashboardSummary;
  activity: DailyActivityPoint[];
  recommendations: RecommendationPage;
};

export type TelegramNotificationStatus = "DISABLED" | "PENDING" | "CONNECTED";
export type TelegramNotificationLanguage = "ru" | "en";
export type TelegramNotificationType =
  | "recommendation_created"
  | "recommendation_approved";

export type TelegramNotificationState = {
  enabled: boolean;
  status: TelegramNotificationStatus;
  language: TelegramNotificationLanguage;
  notification_types: TelegramNotificationType[];
  setup_available?: boolean;
  setup_unavailable_reason?: "missing_config" | null;
  telegram_username?: string | null;
  telegram_chat_id?: string | number | null;
  link_expires_at?: string | null;
};

export type TelegramSetupLinkResponse = {
  deep_link_url: string;
  expires_at: string;
  status: "PENDING";
};

