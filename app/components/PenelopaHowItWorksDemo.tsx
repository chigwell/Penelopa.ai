"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Moon, RefreshCw, Sun } from "lucide-react";

import { DEMO_CONFIG } from "./demo/scenario";
import { AgentScreen } from "./demo/AgentScreen";
import { AnalysisScreen } from "./demo/AnalysisScreen";
import { RecommendationScreen } from "./demo/RecommendationScreen";
import type {
  AgentKey,
  ComposerState,
  ComposeStep,
  ConversationItem,
  DemoScreen,
  DemoStep,
  MessageStep,
  ReasoningStep,
  SendStep,
  Theme,
  ToolStep,
} from "./demo/types";

type PenelopaHowItWorksDemoProps = {
  theme: Theme;
  onToggleTheme: () => void;
};

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
            <AgentScreen
              activeAgentConfig={activeAgentConfig}
              screen={screen}
              conversation={conversation}
              composer={composer}
              conversationRef={conversationRef}
            />
            <AnalysisScreen screen={screen} analysis={analysis} />
            <RecommendationScreen
              theme={theme}
              screen={screen}
              copyState={copyState}
              toastVisible={toastVisible}
              recommendationScrollerRef={recommendationScrollerRef}
              copyRecommendationToClipboard={copyRecommendationToClipboard}
            />

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
