import type { RefObject } from "react";
import { Check, ChevronLeft, Copy, LogOut, Moon, Sun } from "lucide-react";
import { DEMO_CONFIG } from "./scenario";
import type { CopyState, DemoScreen, Theme } from "./types";

type RecommendationScreenProps = {
  theme: Theme;
  screen: DemoScreen;
  copyState: CopyState;
  toastVisible: boolean;
  recommendationScrollerRef: RefObject<HTMLDivElement | null>;
  copyRecommendationToClipboard: () => Promise<void>;
};

function renderInlineCode(text: string) {
  return text.split(/(`[^`]+`)/g).map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return <code key={`${part}-${index}`}>{part.slice(1, -1)}</code>;
    }

    return <span key={`${part}-${index}`}>{part}</span>;
  });
}

export function RecommendationScreen({
  theme,
  screen,
  copyState,
  toastVisible,
  recommendationScrollerRef,
  copyRecommendationToClipboard,
}: RecommendationScreenProps) {
  const ThemeIcon = theme === "dark" ? Sun : Moon;
  const copyButtonLabel = copyState === "copied" ? DEMO_CONFIG.labels.copied : DEMO_CONFIG.labels.copy;

  return (
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
  );
}
