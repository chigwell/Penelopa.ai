"use client";

import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, Copy, LogOut, Moon, RefreshCw, Send, Sun } from "lucide-react";

type Theme = "light" | "dark";
type AgentKey = "codex" | "claude";
type DemoScreen = "agent" | "analysis" | "penelopa";

type BaseStep = {
  hold?: number;
};

type PhaseStep = BaseStep & {
  type: "phase";
  index: string;
  label: string;
  progress?: number;
};

type ComposeStep = BaseStep & {
  type: "compose";
  mode: "type" | "paste";
  text: string;
  duration?: number;
  label?: string;
};

type SendStep = BaseStep & {
  type: "send";
  label?: string;
};

type ReasoningStep = BaseStep & {
  type: "reasoning";
  label: string;
  text: string;
  duration?: number;
};

type ToolStep = BaseStep & {
  type: "tool";
  name: string;
  input: string;
  result: string;
  duration?: number;
};

type MessageStep = BaseStep & {
  type: "message";
  role: "assistant" | "user";
  label: string;
  text: string;
  duration?: number;
  variant?: "final";
  points?: string[];
};

type AnalysisStep = BaseStep & {
  type: "analysis";
  progress?: number;
};

type ScreenStep = BaseStep & {
  type: "screen";
  screen: DemoScreen;
};

type ScrollStep = BaseStep & {
  type: "scroll";
  target: number;
  duration?: number;
};

type CopyStep = BaseStep & {
  type: "copy";
  duration?: number;
};

type CompleteStep = BaseStep & {
  type: "complete";
  progress?: number;
};

type DemoStep =
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

type RecommendationBlock =
  | { type: "heading"; level: 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "quote"; text: string }
  | { type: "list"; items: string[] };

type AgentConfig = {
  label: string;
  mark: string;
  model: string;
  composerPlaceholder: string;
  accentLight: string;
  accentDark: string;
  flow: DemoStep[];
};

type ConversationItem =
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

type ComposerState = {
  text: string;
  empty: boolean;
  ready: boolean;
  streaming: boolean;
  pasting: boolean;
  sending: boolean;
};

type PenelopaHowItWorksDemoProps = {
  theme: Theme;
  onToggleTheme: () => void;
};

const DEMO_CONFIG = {
  settings: {
    defaultAgent: "codex" as AgentKey,
    autoplay: true,
    intersectionThreshold: 0.35,
    speed: 1.2,
    userTypingMultiplier: 1.8,
  },
  section: {
    eyebrow: "Demo",
    title: "Your agent gets better\nafter every run.",
    summary:
      "Penelopa turns real Codex and Claude Code work into reusable skills, checks, and prompts your agent can apply next time.",
  },
  labels: {
    phaseFormat: "{index} / {label}",
    workspaceConnected: "Workspace connected",
    explorer: "Explorer",
    repositoryContext: "Repository context enabled",
    copy: "Copy recommendation",
    copied: "Copied",
    copyToast: "Copied for your agent",
    complete: "Improvement applied",
    replay: "Replay demo",
    dashboard: "Dashboard",
  },
  brand: {
    name: "Penelopa.ai",
    logoUrl: "/penelopa-ai.png",
  },
  project: {
    name: "weather-dashboard",
    branch: "main",
    files: [
      { name: "src", kind: "folder", depth: 0 },
      { name: "weather", kind: "folder", depth: 1 },
      { name: "parser.ts", kind: "file", depth: 2, active: true },
      { name: "fixtures.ts", kind: "file", depth: 2 },
      { name: "components", kind: "folder", depth: 1 },
      { name: "WeatherCard.tsx", kind: "file", depth: 2 },
      { name: "tests/weather-parser.test.ts", kind: "file", depth: 0 },
      { name: "scripts", kind: "folder", depth: 0 },
    ],
  },
  analysis: {
    eyebrow: "Penelopa.ai / Auto-improve",
    tokens: [
      "forecast parser",
      "unit conversion",
      "missing temp",
      "empty rain",
      "timezone label",
      "fixture gap",
      "WeatherCard",
      "same check again",
      "session #05",
      "session #09",
      "validation pattern",
      "skill candidate",
    ],
    stages: [
      {
        title: "Spotting the repeated work.",
        copy: "Penelopa reads how the agent checks weather API responses, fixes edge cases and tests the forecast card.",
        status: "Reviewing session",
        duration: 1200,
      },
      {
        title: "Finding the reusable step.",
        copy: "The same checks appear across weather dashboard tasks: missing temperatures, mixed units, empty rain and timezone drift.",
        status: "Detecting pattern",
        duration: 1400,
      },
      {
        title: "Turning it into a skill.",
        copy: "Penelopa packages those checks into a short validation workflow your agent can reuse before changing weather code.",
        status: "Drafting improvement",
        duration: 1500,
      },
    ],
    resolveDuration: 900,
  },
  recommendation: {
    eyebrow: "Recommendation",
    title: "Create a weather data validation skill",
    metadata: [
      "WEATHER-DASHBOARD",
      "9 SESSIONS",
      "04 SEP 2026",
      "IMPROVEMENT / SKILL + CHECKS",
    ],
    copyExcerpt:
      "Create a reusable weather data validation skill. It should check units, missing temperatures, empty precipitation, timezone labels and API fixture coverage before a weather UI change is considered complete.",
    report: [
      {
        type: "heading",
        level: 2,
        text: "Observed pattern",
      },
      {
        type: "paragraph",
        text: "Across 9 coding sessions, the agent kept rediscovering the same weather API checks before updating the dashboard: normalize Celsius and Fahrenheit, guard missing temperatures, handle empty precipitation, label local time correctly and run the forecast-card fixture tests.",
      },
      {
        type: "quote",
        text: "The agent is doing the right checks, but it has to remember them from scratch every time.",
      },
      {
        type: "heading",
        level: 2,
        text: "Recommended intervention",
      },
      {
        type: "list",
        items: [
          "Add a project skill at .codex/skills/weather-data-validation/SKILL.md with the canonical weather data checks.",
          "Add scripts/check_weather_data.ts to validate API fixtures, unit conversion and missing-value fallbacks.",
          "Make the forecast-card fixture tests part of the skill's completion criteria, not an optional follow-up.",
        ],
      },
      {
        type: "heading",
        level: 2,
        text: "Expected result",
      },
      {
        type: "paragraph",
        text: "Future agents start with a ready weather checklist instead of rediscovering it. Fixes get smaller, forecast cards stay readable and every completed task leaves the next one easier.",
      },
      {
        type: "heading",
        level: 3,
        text: "Suggested invocation",
      },
      {
        type: "paragraph",
        text: "Run `npm test -- weather-parser.test.ts`, then check the London, Phoenix and rainy-day fixtures before presenting the final answer.",
      },
    ] satisfies RecommendationBlock[],
  },
  agents: {
    codex: {
      label: "Codex",
      mark: "C",
      model: "GPT-5.6 Codex",
      composerPlaceholder: "Ask Codex to follow up",
      accentLight: "#516a57",
      accentDark: "#abc5b1",
      flow: [
        {
          type: "phase",
          index: "01",
          label: "Session",
          progress: 0.03,
          hold: 250,
        },
        {
          type: "compose",
          mode: "type",
          text: "The weather card shows 72°C for Phoenix and leaves the rain value blank. Trace the parser and make the smallest safe fix.",
          duration: 1100,
          hold: 180,
        },
        {
          type: "send",
          label: "You",
          hold: 520,
        },
        {
          type: "reasoning",
          label: "Reasoning",
          text: "I will check the weather API shape and parser tests first, then normalize only the units and empty rain fallback.",
          duration: 1050,
          hold: 260,
        },
        {
          type: "tool",
          name: "rg",
          input: 'rg "temperature|unit|precipitation|forecast" src tests -n',
          result:
            "src/weather/parser.ts:42  temperature = reading.temp\nsrc/weather/parser.ts:58  precipitationMm = reading.rain\nsrc/components/WeatherCard.tsx:31  formatTemperature(...)",
          duration: 950,
          hold: 220,
        },
        {
          type: "tool",
          name: "read_file",
          input: "src/weather/parser.ts:34-78",
          result:
            "The parser trusts the provider unit flag and renders missing rain values directly.",
          duration: 900,
          hold: 260,
        },
        {
          type: "reasoning",
          label: "Reasoning",
          text: "The display should normalize to the selected unit and treat missing rain as 0 mm. I will keep the UI unchanged and patch the parser boundary.",
          duration: 1150,
          hold: 240,
        },
        {
          type: "tool",
          name: "apply_patch",
          input:
            "src/weather/parser.ts\nsrc/weather/fixtures.ts\ntests/weather-parser.test.ts",
          result:
            "+ normalized provider units before display\n+ defaulted empty precipitation to 0 mm\n+ added fixtures for hot, cold and no-rain forecasts",
          duration: 1050,
          hold: 260,
        },
        {
          type: "tool",
          name: "npm test",
          input: "npm test -- weather-parser.test.ts",
          result: "12 passed in 0.84s",
          duration: 1100,
          hold: 300,
        },
        {
          type: "message",
          role: "assistant",
          label: "Codex",
          variant: "final",
          text: "Fixed the weather card by normalizing the parser output before it reaches the UI.",
          points: [
            "Phoenix now renders as 72°F instead of 72°C.",
            "Missing rain values display as 0 mm.",
            "Added fixture coverage for hot, cold and no-rain forecasts.",
          ],
          duration: 760,
          hold: 1350,
        },
        {
          type: "analysis",
          progress: 0.4,
          hold: 180,
        },
        {
          type: "phase",
          index: "03",
          label: "Recommendation",
          progress: 0.57,
          hold: 200,
        },
        {
          type: "screen",
          screen: "penelopa",
          hold: 1050,
        },
        {
          type: "scroll",
          target: 0.48,
          duration: 1900,
          hold: 720,
        },
        {
          type: "copy",
          duration: 820,
          hold: 850,
        },
        {
          type: "screen",
          screen: "agent",
          hold: 650,
        },
        {
          type: "phase",
          index: "04",
          label: "Applied",
          progress: 0.72,
          hold: 160,
        },
        {
          type: "compose",
          mode: "paste",
          text: "Apply this Penelopa recommendation to the repository:\n\n“Create a reusable weather data validation skill. Check units, missing temperatures, empty precipitation, timezone labels and API fixtures before changing weather UI code.”",
          duration: 520,
          hold: 380,
        },
        {
          type: "send",
          label: "You",
          hold: 540,
        },
        {
          type: "reasoning",
          label: "Reasoning",
          text: "I will turn the recommendation into repository-owned instructions plus a small fixture check, then cover it so future agents can trust it.",
          duration: 1050,
          hold: 250,
        },
        {
          type: "tool",
          name: "write_file",
          input:
            ".codex/skills/weather-data-validation/SKILL.md\nscripts/check_weather_data.ts\ntests/check-weather-data.test.ts",
          result:
            "Created the reusable workflow, deterministic fixture checks and test coverage.",
          duration: 1050,
          hold: 230,
        },
        {
          type: "tool",
          name: "run_checker",
          input: "npm run check:weather-data",
          result: "units        ok\nmissing temp ok\nrain fallback ok\ntimezone     ok",
          duration: 1050,
          hold: 230,
        },
        {
          type: "tool",
          name: "npm test",
          input: "npm test -- check-weather-data.test.ts weather-parser.test.ts",
          result: "18 passed in 1.12s",
          duration: 950,
          hold: 280,
        },
        {
          type: "message",
          role: "assistant",
          label: "Codex",
          variant: "final",
          text: "The weather validation workflow is now part of the repository.",
          points: [
            "Future sessions get the same weather data checklist up front.",
            "One command checks units, missing values and timezone labels.",
            "Tests protect the checker and the parser fix.",
          ],
          duration: 780,
          hold: 800,
        },
        {
          type: "complete",
          progress: 1,
        },
      ],
    },
    claude: {
      label: "Claude",
      mark: "✦",
      model: "Claude Code",
      composerPlaceholder: "Ask Claude to follow up",
      accentLight: "#9a5c43",
      accentDark: "#e0a084",
      flow: [
        {
          type: "phase",
          index: "01",
          label: "Session",
          progress: 0.03,
          hold: 250,
        },
        {
          type: "compose",
          mode: "type",
          text: "The forecast card mixes Celsius and Fahrenheit on some cities. Please investigate without widening the change.",
          duration: 1150,
          hold: 180,
        },
        {
          type: "send",
          label: "You",
          hold: 520,
        },
        {
          type: "reasoning",
          label: "Reasoning",
          text: "I will inspect the weather parser contract, compare the provider fixtures and keep the fix at the narrowest reliable boundary.",
          duration: 1000,
          hold: 250,
        },
        {
          type: "tool",
          name: "Grep",
          input: "pattern: temperature|unit|precipitation\npath: src/weather",
          result: "Matched parser.ts and fixtures.ts. Provider units are inconsistent across cities.",
          duration: 950,
          hold: 220,
        },
        {
          type: "tool",
          name: "Read",
          input: "src/weather/parser.ts lines 34-78",
          result: "The parser passes through provider values instead of normalizing them for the selected display unit.",
          duration: 900,
          hold: 250,
        },
        {
          type: "reasoning",
          label: "Reasoning",
          text: "This belongs at the parser boundary. I will normalize temperatures once, preserve the component API and add fixtures for the tricky cases.",
          duration: 1100,
          hold: 230,
        },
        {
          type: "tool",
          name: "Edit",
          input: "parser.ts + fixtures.ts + weather parser tests",
          result: "Added unit normalization, rain fallback handling and fixture coverage.",
          duration: 1050,
          hold: 250,
        },
        {
          type: "tool",
          name: "Bash",
          input: "npm test -- weather-parser.test.ts",
          result: "12 passed in 0.81s",
          duration: 1050,
          hold: 300,
        },
        {
          type: "message",
          role: "assistant",
          label: "Claude",
          variant: "final",
          text: "Resolved the mixed-unit weather bug at the parser boundary.",
          points: [
            "Forecast cards now receive one normalized display value.",
            "Missing rain is handled before rendering.",
            "Fixtures cover the cities that previously drifted.",
          ],
          duration: 760,
          hold: 1350,
        },
        {
          type: "analysis",
          progress: 0.4,
          hold: 180,
        },
        {
          type: "phase",
          index: "03",
          label: "Recommendation",
          progress: 0.57,
          hold: 200,
        },
        {
          type: "screen",
          screen: "penelopa",
          hold: 1050,
        },
        {
          type: "scroll",
          target: 0.48,
          duration: 1900,
          hold: 720,
        },
        {
          type: "copy",
          duration: 820,
          hold: 850,
        },
        {
          type: "screen",
          screen: "agent",
          hold: 650,
        },
        {
          type: "phase",
          index: "04",
          label: "Applied",
          progress: 0.72,
          hold: 160,
        },
        {
          type: "compose",
          mode: "paste",
          text: "Apply this Penelopa recommendation to the repository:\n\n“Create a reusable weather data validation skill. Check units, missing temperatures, empty precipitation, timezone labels and API fixtures before changing weather UI code.”",
          duration: 520,
          hold: 380,
        },
        {
          type: "send",
          label: "You",
          hold: 540,
        },
        {
          type: "reasoning",
          label: "Reasoning",
          text: "I will encode this as project memory plus a fixture checker, with focused tests so the workflow remains dependable across future sessions.",
          duration: 1050,
          hold: 250,
        },
        {
          type: "tool",
          name: "Write",
          input:
            ".claude/skills/weather-data-validation/SKILL.md\nscripts/check_weather_data.ts\ntests/check-weather-data.test.ts",
          result: "Created the skill, checker and test coverage.",
          duration: 1050,
          hold: 230,
        },
        {
          type: "tool",
          name: "Bash",
          input: "npm run check:weather-data",
          result: "units        ok\nmissing temp ok\nrain fallback ok\ntimezone     ok",
          duration: 1050,
          hold: 230,
        },
        {
          type: "tool",
          name: "Bash",
          input: "npm test -- check-weather-data.test.ts weather-parser.test.ts",
          result: "18 passed in 1.08s",
          duration: 950,
          hold: 280,
        },
        {
          type: "message",
          role: "assistant",
          label: "Claude",
          variant: "final",
          text: "Applied. Weather data validation is now a reusable project capability.",
          points: [
            "The skill explains when and how to run the weather checks.",
            "The script verifies units, missing values and timezone labels.",
            "The combined focused suite passes.",
          ],
          duration: 780,
          hold: 800,
        },
        {
          type: "complete",
          progress: 1,
        },
      ],
    },
  } satisfies Record<AgentKey, AgentConfig>,
};

const TOKEN_POSITIONS = [
  ["6%", "14%", "-90px", "38px", "470px", "210px", "4.8s", "-0.2s"],
  ["72%", "11%", "110px", "20px", "-340px", "245px", "5.4s", "-1.7s"],
  ["3%", "44%", "-120px", "0px", "500px", "20px", "5.7s", "-2.4s"],
  ["78%", "48%", "130px", "-10px", "-400px", "0px", "4.6s", "-0.9s"],
  ["11%", "78%", "-70px", "90px", "430px", "-260px", "6.1s", "-3.4s"],
  ["69%", "79%", "90px", "100px", "-300px", "-270px", "5.1s", "-2.1s"],
  ["25%", "5%", "0px", "-80px", "180px", "280px", "4.9s", "-3.7s"],
  ["58%", "3%", "0px", "-90px", "-80px", "310px", "5.6s", "-1.2s"],
  ["19%", "57%", "-120px", "20px", "260px", "-40px", "4.3s", "-2.8s"],
  ["62%", "63%", "120px", "30px", "-180px", "-70px", "5.8s", "-4.2s"],
  ["38%", "91%", "-20px", "100px", "70px", "-320px", "5.2s", "-1.9s"],
  ["47%", "10%", "10px", "-100px", "0px", "250px", "4.7s", "-3.1s"],
] as const;

const INITIAL_ANALYSIS_STAGE = DEMO_CONFIG.analysis.stages[0];

function createInitialComposer(agentKey: AgentKey): ComposerState {
  return {
    text: DEMO_CONFIG.agents[agentKey].composerPlaceholder,
    empty: true,
    ready: false,
    streaming: false,
    pasting: false,
    sending: false,
  };
}

function renderTitle(text: string) {
  return text.split("\n").map((line, index, lines) => (
    <span key={`${line}-${index}`}>
      {line}
      {index < lines.length - 1 ? (
        <>
          <br />{" "}
        </>
      ) : null}
    </span>
  ));
}

function renderInlineCode(text: string) {
  return text.split(/(`[^`]+`)/g).map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return <code key={`${part}-${index}`}>{part.slice(1, -1)}</code>;
    }

    return <span key={`${part}-${index}`}>{part}</span>;
  });
}

function isAbortError(error: unknown) {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (typeof error === "object" &&
      error !== null &&
      "name" in error &&
      (error as { name?: string }).name === "AbortError")
  );
}

export default function PenelopaHowItWorksDemo({
  theme,
  onToggleTheme,
}: PenelopaHowItWorksDemoProps) {
  const [activeAgent, setActiveAgent] = useState<AgentKey>(DEMO_CONFIG.settings.defaultAgent);
  const [screen, setScreen] = useState<DemoScreen>("agent");
  const [phase, setPhase] = useState({ index: "01", label: "Session" });
  const [progress, setProgress] = useState(0);
  const [conversation, setConversation] = useState<ConversationItem[]>([]);
  const [composer, setComposer] = useState<ComposerState>(() =>
    createInitialComposer(DEMO_CONFIG.settings.defaultAgent),
  );
  const [analysis, setAnalysis] = useState({
    title: INITIAL_ANALYSIS_STAGE.title,
    copy: INITIAL_ANALYSIS_STAGE.copy,
    status: INITIAL_ANALYSIS_STAGE.status,
    resolving: false,
    cycle: 0,
  });
  const [copyState, setCopyState] = useState<"idle" | "pressed" | "copied">("idle");
  const [toastVisible, setToastVisible] = useState(false);
  const [finishVisible, setFinishVisible] = useState(false);

  const rootRef = useRef<HTMLElement | null>(null);
  const conversationRef = useRef<HTMLDivElement | null>(null);
  const recommendationScrollerRef = useRef<HTMLDivElement | null>(null);
  const activeControllerRef = useRef<AbortController | null>(null);
  const activeAgentRef = useRef<AgentKey>(DEMO_CONFIG.settings.defaultAgent);
  const pendingComposerRef = useRef<{ role: "user"; label: string; text: string } | null>(null);
  const itemIdRef = useRef(0);
  const progressRef = useRef(0);
  const reducedMotionRef = useRef(false);
  const hasAutoplayedRef = useRef(false);

  const activeAgentConfig = DEMO_CONFIG.agents[activeAgent];
  const phaseText = DEMO_CONFIG.labels.phaseFormat
    .replace("{index}", phase.index)
    .replace("{label}", phase.label);
  const copyButtonLabel = copyState === "copied" ? DEMO_CONFIG.labels.copied : DEMO_CONFIG.labels.copy;
  const ThemeIcon = theme === "dark" ? Sun : Moon;
  const agentAccent = theme === "dark" ? activeAgentConfig.accentDark : activeAgentConfig.accentLight;
  const rootStyle = useMemo(
    () => ({ "--pd-agent-accent": agentAccent }) as CSSProperties,
    [agentAccent],
  );

  function nextItemId() {
    itemIdRef.current += 1;
    return `pd-item-${itemIdRef.current}`;
  }

  function updateProgress(nextProgress: number) {
    const safeValue = Math.min(1, Math.max(0, Number(nextProgress) || 0));
    progressRef.current = safeValue;
    setProgress(safeValue);
  }

  function resetComposer(agentKey: AgentKey) {
    pendingComposerRef.current = null;
    setComposer(createInitialComposer(agentKey));
  }

  function resetCopyState() {
    setCopyState("idle");
    setToastVisible(false);
  }

  function resetDemo(agentKey: AgentKey) {
    setScreen("agent");
    setPhase({ index: "01", label: "Session" });
    updateProgress(0);
    setConversation([]);
    setFinishVisible(false);
    setAnalysis((current) => ({
      title: INITIAL_ANALYSIS_STAGE.title,
      copy: INITIAL_ANALYSIS_STAGE.copy,
      status: INITIAL_ANALYSIS_STAGE.status,
      resolving: false,
      cycle: current.cycle + 1,
    }));
    resetComposer(agentKey);
    resetCopyState();

    if (conversationRef.current) {
      conversationRef.current.scrollTop = 0;
    }

    if (recommendationScrollerRef.current) {
      recommendationScrollerRef.current.scrollTop = 0;
    }
  }

  function updateConversationItem(id: string, patch: Partial<ConversationItem>) {
    setConversation((items) =>
      items.map((item) => (item.id === id ? ({ ...item, ...patch } as ConversationItem) : item)),
    );
  }

  function speedAdjusted(milliseconds: number) {
    const motionFactor = reducedMotionRef.current ? 0.08 : 1;
    return Math.max(1, (milliseconds * motionFactor) / DEMO_CONFIG.settings.speed);
  }

  function delay(milliseconds: number, signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException("Demo restarted", "AbortError"));
        return;
      }

      const timeoutId = window.setTimeout(resolve, speedAdjusted(milliseconds));
      signal.addEventListener(
        "abort",
        () => {
          window.clearTimeout(timeoutId);
          reject(new DOMException("Demo restarted", "AbortError"));
        },
        { once: true },
      );
    });
  }

  function assertActive(signal: AbortSignal) {
    if (signal.aborted) {
      throw new DOMException("Demo restarted", "AbortError");
    }
  }

  async function typeText(
    updateText: (text: string, streaming: boolean) => void,
    text: string,
    duration: number,
    signal: AbortSignal,
    durationMultiplier = 1,
  ) {
    assertActive(signal);
    updateText("", true);

    if (reducedMotionRef.current || duration <= 50) {
      updateText(text, false);
      return;
    }

    const segments = text.match(/\S+\s*|\s+/g) || [text];
    const interval = Math.max(14, (duration * durationMultiplier) / Math.max(segments.length, 1));
    let currentText = "";

    for (const segment of segments) {
      assertActive(signal);
      currentText += segment;
      updateText(currentText, true);
      await delay(interval, signal);
    }

    updateText(text, false);
  }

  async function renderMessage(step: MessageStep, signal: AbortSignal, immediate = false) {
    const id = nextItemId();
    setConversation((items) => [
      ...items,
      {
        id,
        kind: "message",
        role: step.role,
        label: step.label,
        variant: step.variant,
        text: immediate ? step.text : "",
        streaming: !immediate,
      },
    ]);

    if (!immediate) {
      await typeText(
        (text, streaming) => updateConversationItem(id, { text, streaming }),
        step.text,
        step.duration || 650,
        signal,
      );
    }

    if (Array.isArray(step.points) && step.points.length > 0) {
      updateConversationItem(id, { points: step.points, streaming: false });
    }
  }

  async function renderReasoning(step: ReasoningStep, signal: AbortSignal) {
    const id = nextItemId();
    setConversation((items) => [
      ...items,
      {
        id,
        kind: "reasoning",
        label: step.label,
        text: "",
        streaming: true,
        complete: false,
      },
    ]);

    await typeText(
      (text, streaming) => updateConversationItem(id, { text, streaming }),
      step.text,
      step.duration || 950,
      signal,
    );
    updateConversationItem(id, { complete: true, streaming: false });
  }

  async function renderTool(step: ToolStep, signal: AbortSignal) {
    const id = nextItemId();
    setConversation((items) => [
      ...items,
      {
        id,
        kind: "tool",
        name: step.name,
        input: step.input,
        result: step.result,
        state: "running",
        hasResult: false,
      },
    ]);

    const duration = step.duration || 900;
    await delay(duration * 0.55, signal);
    updateConversationItem(id, { hasResult: true });
    await delay(duration * 0.45, signal);
    updateConversationItem(id, { state: "complete" });
  }

  async function compose(step: ComposeStep, signal: AbortSignal) {
    pendingComposerRef.current = {
      role: "user",
      label: step.label || "You",
      text: step.text,
    };

    setComposer((current) => ({
      ...current,
      ready: true,
      empty: false,
      streaming: false,
      text: step.mode === "paste" ? step.text : "",
      pasting: step.mode === "paste",
    }));

    if (step.mode === "paste") {
      await delay(step.duration || 420, signal);
      setComposer((current) => ({ ...current, pasting: false }));
      return;
    }

    await typeText(
      (text, streaming) =>
        setComposer((current) => ({
          ...current,
          text,
          streaming,
          empty: false,
        })),
      step.text,
      step.duration || 900,
      signal,
      DEMO_CONFIG.settings.userTypingMultiplier,
    );
  }

  async function sendComposer(step: SendStep, signal: AbortSignal) {
    const pendingComposer = pendingComposerRef.current;
    if (!pendingComposer) {
      return;
    }

    setComposer((current) => ({ ...current, sending: true }));
    await delay(170, signal);
    const message: MessageStep = {
      type: "message",
      role: "user",
      label: step.label || pendingComposer.label,
      text: pendingComposer.text,
    };
    resetComposer(activeAgentRef.current);
    await renderMessage(message, signal, true);
  }

  async function runAnalysis(signal: AbortSignal) {
    setPhase({ index: "02", label: "Analysis" });
    setScreen("analysis");
    setAnalysis((current) => ({
      ...current,
      resolving: false,
      cycle: current.cycle + 1,
    }));

    for (const stage of DEMO_CONFIG.analysis.stages) {
      assertActive(signal);
      setAnalysis((current) => ({
        ...current,
        title: stage.title,
        copy: stage.copy,
        status: stage.status,
      }));
      await delay(stage.duration, signal);
    }

    setAnalysis((current) => ({ ...current, resolving: true }));
    await delay(DEMO_CONFIG.analysis.resolveDuration || 900, signal);
  }

  function easeInOutCubic(value: number) {
    return value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;
  }

  async function animateRecommendationScroll(targetFraction: number, duration: number | undefined, signal: AbortSignal) {
    assertActive(signal);
    const scroller = recommendationScrollerRef.current;
    if (!scroller) {
      return;
    }

    const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const destination = maxScroll * Math.min(1, Math.max(0, targetFraction));
    const start = scroller.scrollTop;
    const startedAt = performance.now();
    const adjustedDuration = speedAdjusted(duration || 1600);

    await new Promise<void>((resolve, reject) => {
      let frameId = 0;

      const abort = () => {
        cancelAnimationFrame(frameId);
        reject(new DOMException("Demo restarted", "AbortError"));
      };

      const frame = (now: number) => {
        if (signal.aborted) {
          abort();
          return;
        }

        const elapsed = now - startedAt;
        const frameProgress = Math.min(1, elapsed / adjustedDuration);
        scroller.scrollTop = start + (destination - start) * easeInOutCubic(frameProgress);

        if (frameProgress < 1) {
          frameId = requestAnimationFrame(frame);
        } else {
          signal.removeEventListener("abort", abort);
          resolve();
        }
      };

      signal.addEventListener("abort", abort, { once: true });
      frameId = requestAnimationFrame(frame);
    });
  }

  async function simulateCopy(duration: number | undefined, signal: AbortSignal) {
    setCopyState("pressed");
    await delay(150, signal);
    setCopyState("copied");
    setToastVisible(true);
    await delay(Math.max(300, (duration || 800) - 150), signal);
  }

  async function performStep(step: DemoStep, signal: AbortSignal) {
    switch (step.type) {
      case "phase":
        setPhase({ index: step.index, label: step.label });
        if (typeof step.progress === "number") {
          updateProgress(step.progress);
        }
        break;
      case "compose":
        await compose(step, signal);
        break;
      case "send":
        await sendComposer(step, signal);
        break;
      case "message":
        await renderMessage(step, signal);
        break;
      case "reasoning":
        await renderReasoning(step, signal);
        break;
      case "tool":
        await renderTool(step, signal);
        break;
      case "analysis":
        if (typeof step.progress === "number") {
          updateProgress(step.progress);
        }
        await runAnalysis(signal);
        break;
      case "screen":
        setScreen(step.screen);
        break;
      case "scroll":
        await animateRecommendationScroll(step.target, step.duration, signal);
        break;
      case "copy":
        await simulateCopy(step.duration, signal);
        break;
      case "complete":
        updateProgress(typeof step.progress === "number" ? step.progress : 1);
        setFinishVisible(true);
        break;
    }
  }

  async function runDemo(agentKey: AgentKey = activeAgentRef.current) {
    activeControllerRef.current?.abort();
    const controller = new AbortController();
    activeControllerRef.current = controller;
    const { signal } = controller;

    activeAgentRef.current = agentKey;
    setActiveAgent(agentKey);
    resetDemo(agentKey);

    try {
      const flow = DEMO_CONFIG.agents[agentKey].flow;
      for (let index = 0; index < flow.length; index += 1) {
        const step = flow[index];
        assertActive(signal);
        await performStep(step, signal);

        if (step.type !== "phase" && step.type !== "complete") {
          if ("progress" in step && typeof step.progress === "number") {
            updateProgress(step.progress);
          } else {
            updateProgress(Math.max(progressRef.current, ((index + 1) / flow.length) * 0.96));
          }
        }

        if (step.hold) {
          await delay(step.hold, signal);
        }
      }
    } catch (error) {
      if (!isAbortError(error)) {
        console.error("Penelopa demo failed", error);
      }
    }
  }

  async function copyRecommendationToClipboard() {
    try {
      await navigator.clipboard.writeText(DEMO_CONFIG.recommendation.copyExcerpt);
    } catch {
      // Clipboard access can be unavailable in previews or insecure contexts.
    }

    setCopyState("copied");
    setToastVisible(true);
  }

  useEffect(() => {
    activeAgentRef.current = activeAgent;
  }, [activeAgent]);

  useEffect(() => {
    if (conversationRef.current) {
      conversationRef.current.scrollTop = conversationRef.current.scrollHeight;
    }
  }, [conversation]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncReducedMotion = () => {
      reducedMotionRef.current = mediaQuery.matches;
    };

    syncReducedMotion();
    mediaQuery.addEventListener("change", syncReducedMotion);

    return () => mediaQuery.removeEventListener("change", syncReducedMotion);
  }, []);

  useEffect(() => {
    if (!DEMO_CONFIG.settings.autoplay) {
      return;
    }

    const root = rootRef.current;
    if (!root) {
      return;
    }

    if ("IntersectionObserver" in window) {
      const observer = new IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          if (entry?.isIntersecting && !hasAutoplayedRef.current) {
            hasAutoplayedRef.current = true;
            observer.disconnect();
            void runDemo(activeAgentRef.current);
          }
        },
        {
          threshold: Number(DEMO_CONFIG.settings.intersectionThreshold) || 0.35,
        },
      );

      observer.observe(root);
      return () => {
        observer.disconnect();
        activeControllerRef.current?.abort();
      };
    }

    hasAutoplayedRef.current = true;
    void runDemo(activeAgentRef.current);

    return () => activeControllerRef.current?.abort();
  }, []);

  function renderConversationItem(item: ConversationItem): ReactNode {
    if (item.kind === "message") {
      return (
        <article
          className="pd-message"
          data-role={item.role}
          data-variant={item.variant}
          key={item.id}
        >
          <div className="pd-message__label">{item.label}</div>
          <div className={item.streaming ? "pd-message__body is-streaming" : "pd-message__body"}>
            {item.text}
          </div>
          {item.points && item.points.length > 0 ? (
            <ul className="pd-message__points">
              {item.points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          ) : null}
        </article>
      );
    }

    if (item.kind === "reasoning") {
      return (
        <section className={item.complete ? "pd-working is-complete" : "pd-working"} key={item.id}>
          <div className="pd-working__head">
            <span className="pd-working__pulse" />
            <span className="pd-working__label">{item.label}</span>
            <span className="pd-working__state">{item.complete ? "Ready" : "Working"}</span>
          </div>
          <div className="pd-working__body">{item.text}</div>
        </section>
      );
    }

    return (
      <section className={item.hasResult ? "pd-tool has-result" : "pd-tool"} data-state={item.state} key={item.id}>
        <div className="pd-tool__head">
          <div className="pd-tool__identity">
            <span className="pd-tool__icon">&gt;_</span>
            <span className="pd-tool__name">{item.name}</span>
          </div>
          <span className="pd-tool__status">{item.state === "complete" ? "Complete" : "Running"}</span>
        </div>
        <pre className="pd-tool__command">{item.input}</pre>
        <pre className="pd-tool__result">{item.result}</pre>
      </section>
    );
  }

  return (
    <section
      className="pd-demo"
      data-theme={theme}
      aria-labelledby="pd-demo-title"
      ref={rootRef}
      style={rootStyle}
    >
      <div className="pd-demo__inner">
        <header className="pd-demo__intro">
          <div>
            <p className="pd-demo__eyebrow">{DEMO_CONFIG.section.eyebrow}</p>
            <h2 className="pd-demo__title" id="pd-demo-title">
              {renderTitle(DEMO_CONFIG.section.title)}
            </h2>
          </div>
          <p className="pd-demo__summary">{DEMO_CONFIG.section.summary}</p>
        </header>

        <div className="pd-shell">
          <div className="pd-shell__toolbar">
            <div className="pd-agent-tabs" role="tablist" aria-label="Select AI agent">
              {(Object.keys(DEMO_CONFIG.agents) as AgentKey[]).map((agentKey) => (
                <button
                  className="pd-agent-tab"
                  type="button"
                  role="tab"
                  aria-selected={activeAgent === agentKey}
                  key={agentKey}
                  onClick={() => void runDemo(agentKey)}
                >
                  {DEMO_CONFIG.agents[agentKey].label}
                </button>
              ))}
            </div>

            <div className="pd-demo__phase" aria-live="polite">
              {phaseText}
            </div>

            <div className="pd-toolbar-actions">
              <button
                className="pd-icon-button"
                type="button"
                aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
                onClick={onToggleTheme}
              >
                <ThemeIcon aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="pd-stage">
            <section className={screen === "agent" ? "pd-screen pd-agent is-active" : "pd-screen pd-agent"}>
              <header className="pd-agent__topbar">
                <div className="pd-agent__mark">{activeAgentConfig.mark}</div>
                <div className="pd-agent__identity">
                  <p className="pd-agent__name">
                    {activeAgentConfig.label} · {DEMO_CONFIG.project.name}
                  </p>
                  <p className="pd-agent__meta">
                    {activeAgentConfig.model} · {DEMO_CONFIG.project.branch}
                  </p>
                </div>
                <div className="pd-agent__connection">
                  <span>{DEMO_CONFIG.labels.workspaceConnected}</span>
                </div>
              </header>

              <div className="pd-agent__body">
                <aside className="pd-agent__sidebar" aria-label="Project files">
                  <p className="pd-agent__sidebar-label">{DEMO_CONFIG.labels.explorer}</p>
                  <div className="pd-agent__tree">
                    {DEMO_CONFIG.project.files.map((file) => (
                      <div
                        className="pd-agent__file"
                        data-kind={file.kind}
                        data-depth={file.depth}
                        data-active={file.active ? "true" : "false"}
                        key={`${file.depth}-${file.name}`}
                      >
                        {file.name}
                      </div>
                    ))}
                  </div>
                </aside>

                <main className="pd-agent__chat">
                  <div className="pd-conversation" ref={conversationRef}>
                    <div className="pd-conversation__inner">
                      {conversation.map((item) => renderConversationItem(item))}
                    </div>
                  </div>

                  <div
                    className={composer.pasting ? "pd-composer is-pasting" : "pd-composer"}
                    data-ready={composer.ready ? "true" : "false"}
                  >
                    <div className="pd-composer__main">
                      <div
                        className={composer.streaming ? "pd-composer__text is-streaming" : "pd-composer__text"}
                        data-empty={composer.empty ? "true" : "false"}
                      >
                        {composer.text}
                      </div>
                      <button
                        className={composer.sending ? "pd-composer__send is-sending" : "pd-composer__send"}
                        type="button"
                        tabIndex={-1}
                        aria-hidden="true"
                      >
                        <Send aria-hidden="true" />
                      </button>
                    </div>
                    <div className="pd-composer__footer">
                      <span>{activeAgentConfig.model}</span>
                      <span>{DEMO_CONFIG.labels.repositoryContext}</span>
                    </div>
                  </div>
                </main>
              </div>
            </section>

            <section
              className={
                screen === "analysis"
                  ? analysis.resolving
                    ? "pd-screen pd-analysis is-active is-resolving"
                    : "pd-screen pd-analysis is-active"
                  : "pd-screen pd-analysis"
              }
            >
              <div className="pd-analysis__stream" key={analysis.cycle}>
                {DEMO_CONFIG.analysis.tokens.map((token, index) => {
                  const position = TOKEN_POSITIONS[index % TOKEN_POSITIONS.length];
                  return (
                    <span
                      className="pd-analysis__token"
                      key={`${token}-${index}`}
                      style={
                        {
                          "--x": position[0],
                          "--y": position[1],
                          "--from-x": position[2],
                          "--from-y": position[3],
                          "--to-x": position[4],
                          "--to-y": position[5],
                          "--duration": position[6],
                          "--delay": position[7],
                        } as CSSProperties
                      }
                    >
                      {token}
                    </span>
                  );
                })}
              </div>
              <div className="pd-analysis__core">
                <p className="pd-analysis__eyebrow">{DEMO_CONFIG.analysis.eyebrow}</p>
                <div className="pd-analysis__orb" aria-hidden="true">
                  <span className="pd-analysis__ring pd-analysis__ring--outer" />
                  <span className="pd-analysis__ring pd-analysis__ring--middle" />
                  <span className="pd-analysis__ring pd-analysis__ring--inner" />
                  <span className="pd-analysis__brand-mark">
                    <img src={DEMO_CONFIG.brand.logoUrl} alt="" />
                  </span>
                </div>
                <h3 className="pd-analysis__title">{analysis.title}</h3>
                <p className="pd-analysis__copy">{analysis.copy}</p>
                <div className="pd-analysis__status">{analysis.status}</div>
              </div>
              <div className="pd-analysis__document" aria-hidden="true" />
            </section>

            <section
              className={screen === "penelopa" ? "pd-screen pd-recommendation is-active" : "pd-screen pd-recommendation"}
              aria-label="Penelopa recommendation preview"
            >
              <nav className="pd-recommendation__nav">
                <span className="pd-recommendation__brand" aria-hidden="true">
                  <span className="pd-recommendation__logo">
                    <img src={DEMO_CONFIG.brand.logoUrl} alt="" />
                  </span>
                  <span className="pd-recommendation__brand-text">{DEMO_CONFIG.brand.name}</span>
                </span>
                <div className="pd-recommendation__actions">
                  <button className="pd-recommendation__back" type="button" tabIndex={-1}>
                    <ChevronLeft aria-hidden="true" />
                    <span>{DEMO_CONFIG.labels.dashboard}</span>
                  </button>
                  <button className="pd-icon-button" type="button" tabIndex={-1} aria-hidden="true">
                    <LogOut aria-hidden="true" />
                  </button>
                  <button className="pd-icon-button" type="button" tabIndex={-1} aria-hidden="true">
                    <ThemeIcon aria-hidden="true" />
                  </button>
                </div>
              </nav>

              <div className="pd-recommendation__scroller" ref={recommendationScrollerRef}>
                <article className="pd-recommendation__article">
                  <header className="pd-recommendation__header">
                    <p className="pd-recommendation__eyebrow">{DEMO_CONFIG.recommendation.eyebrow}</p>
                    <h3 className="pd-recommendation__title">{DEMO_CONFIG.recommendation.title}</h3>
                    <div className="pd-recommendation__meta-row">
                      {DEMO_CONFIG.recommendation.metadata.map((item) => (
                        <span className="pd-recommendation__meta" key={item}>
                          {item}
                        </span>
                      ))}
                      <button
                        className={
                          copyState === "pressed"
                            ? "pd-copy-button is-pressed"
                            : copyState === "copied"
                              ? "pd-copy-button is-copied"
                              : "pd-copy-button"
                        }
                        type="button"
                        onClick={copyRecommendationToClipboard}
                      >
                        {copyState === "copied" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                        <span>{copyButtonLabel}</span>
                      </button>
                    </div>
                  </header>

                  <div className="pd-recommendation__report">
                    {DEMO_CONFIG.recommendation.report.map((block, index) => {
                      if (block.type === "heading") {
                        return block.level === 3 ? (
                          <h3 key={`${block.text}-${index}`}>{block.text}</h3>
                        ) : (
                          <h2 key={`${block.text}-${index}`}>{block.text}</h2>
                        );
                      }

                      if (block.type === "paragraph") {
                        return <p key={`${block.text}-${index}`}>{renderInlineCode(block.text)}</p>;
                      }

                      if (block.type === "quote") {
                        return (
                          <blockquote key={`${block.text}-${index}`}>
                            <p>{block.text}</p>
                          </blockquote>
                        );
                      }

                      return (
                        <ul key={`list-${index}`}>
                          {block.items.map((item) => (
                            <li key={item}>{renderInlineCode(item)}</li>
                          ))}
                        </ul>
                      );
                    })}
                  </div>
                </article>
              </div>

              <div className={toastVisible ? "pd-copy-toast is-visible" : "pd-copy-toast"}>
                {DEMO_CONFIG.labels.copyToast}
              </div>
            </section>

            <aside className={finishVisible ? "pd-finish is-visible" : "pd-finish"} aria-live="polite">
              <span className="pd-finish__label">{DEMO_CONFIG.labels.complete}</span>
              <button className="pd-finish__button" type="button" onClick={() => void runDemo(activeAgentRef.current)}>
                <span>{DEMO_CONFIG.labels.replay}</span>
                <RefreshCw aria-hidden="true" />
              </button>
            </aside>
          </div>

          <div className="pd-shell__progress" aria-hidden="true">
            <span className="pd-shell__progress-value" style={{ width: `${progress * 100}%` }} />
          </div>
        </div>
      </div>
    </section>
  );
}
