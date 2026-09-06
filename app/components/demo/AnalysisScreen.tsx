import type { CSSProperties } from "react";
import { DEMO_CONFIG, TOKEN_POSITIONS } from "./scenario";
import type { AnalysisState, DemoScreen } from "./types";

type AnalysisScreenProps = {
  screen: DemoScreen;
  analysis: AnalysisState;
};

export function AnalysisScreen({ screen, analysis }: AnalysisScreenProps) {

  return (
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
  );
}
