import type { ReactNode, RefObject } from "react";
import { Send } from "lucide-react";
import { DEMO_CONFIG } from "./scenario";
import type { AgentConfig, ComposerState, ConversationItem, DemoScreen } from "./types";

type AgentScreenProps = {
  activeAgentConfig: Pick<AgentConfig, "label" | "mark" | "model">;
  screen: DemoScreen;
  conversation: ConversationItem[];
  composer: ComposerState;
  conversationRef: RefObject<HTMLDivElement | null>;
};

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

export function AgentScreen({
  activeAgentConfig,
  screen,
  conversation,
  composer,
  conversationRef,
}: AgentScreenProps) {

  return (
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
  );
}
