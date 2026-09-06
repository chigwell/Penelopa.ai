"use client";

import type { CSSProperties } from "react";
import { useMemo } from "react";
import { Moon, RefreshCw, Sun } from "lucide-react";

import { DEMO_CONFIG } from "./demo/scenario";
import { AgentScreen } from "./demo/AgentScreen";
import { AnalysisScreen } from "./demo/AnalysisScreen";
import { RecommendationScreen } from "./demo/RecommendationScreen";
import { useDemoPlayback } from "./demo/useDemoPlayback";
import type { AgentKey, Theme } from "./demo/types";

type PenelopaHowItWorksDemoProps = {
  theme: Theme;
  onToggleTheme: () => void;
};

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

export default function PenelopaHowItWorksDemo({
  theme,
  onToggleTheme,
}: PenelopaHowItWorksDemoProps) {
  const {
    activeAgent,
    screen,
    phase,
    progress,
    conversation,
    composer,
    analysis,
    copyState,
    toastVisible,
    finishVisible,
    rootRef,
    conversationRef,
    recommendationScrollerRef,
    activeAgentRef,
    runDemo,
    copyRecommendationToClipboard,
  } = useDemoPlayback();

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
