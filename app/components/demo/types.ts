export type Theme = "light" | "dark";
export type AgentKey = "codex" | "claude";
export type DemoScreen = "agent" | "analysis" | "penelopa";

export type BaseStep = {
  hold?: number;
};

export type PhaseStep = BaseStep & {
  type: "phase";
  index: string;
  label: string;
  progress?: number;
};

export type ComposeStep = BaseStep & {
  type: "compose";
  mode: "type" | "paste";
  text: string;
  duration?: number;
  label?: string;
};

export type SendStep = BaseStep & {
  type: "send";
  label?: string;
};

export type ReasoningStep = BaseStep & {
  type: "reasoning";
  label: string;
  text: string;
  duration?: number;
};

export type ToolStep = BaseStep & {
  type: "tool";
  name: string;
  input: string;
  result: string;
  duration?: number;
};

export type MessageStep = BaseStep & {
  type: "message";
  role: "assistant" | "user";
  label: string;
  text: string;
  duration?: number;
  variant?: "final";
  points?: string[];
};

export type AnalysisStep = BaseStep & {
  type: "analysis";
  progress?: number;
};

export type ScreenStep = BaseStep & {
  type: "screen";
  screen: DemoScreen;
};

export type ScrollStep = BaseStep & {
  type: "scroll";
  target: number;
  duration?: number;
};

export type CopyStep = BaseStep & {
  type: "copy";
  duration?: number;
};

export type CompleteStep = BaseStep & {
  type: "complete";
  progress?: number;
};

export type DemoStep =
  | PhaseStep
  | ComposeStep
  | SendStep
  | ReasoningStep
  | ToolStep
  | MessageStep
  | AnalysisStep
  | ScreenStep
  | ScrollStep
  | CopyStep
  | CompleteStep;

export type RecommendationBlock =
  | { type: "heading"; level: 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "quote"; text: string }
  | { type: "list"; items: string[] };

export type AgentConfig = {
  label: string;
  mark: string;
  model: string;
  composerPlaceholder: string;
  accentLight: string;
  accentDark: string;
  flow: DemoStep[];
};

export type ConversationItem =
  | {
      id: string;
      kind: "message";
      role: "assistant" | "user";
      label: string;
      text: string;
      streaming?: boolean;
      variant?: "final";
      points?: string[];
    }
  | {
      id: string;
      kind: "reasoning";
      label: string;
      text: string;
      streaming?: boolean;
      complete: boolean;
    }
  | {
      id: string;
      kind: "tool";
      name: string;
      input: string;
      result: string;
      state: "running" | "complete";
      hasResult: boolean;
    };

export type ComposerState = {
  text: string;
  empty: boolean;
  ready: boolean;
  streaming: boolean;
  pasting: boolean;
  sending: boolean;
};

export type AnalysisState = {
  title: string;
  copy: string;
  status: string;
  resolving: boolean;
  cycle: number;
};

export type CopyState = "idle" | "pressed" | "copied";
