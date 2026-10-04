"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

export function InspectorFrame({ children, onClose, title }: {
  children: React.ReactNode;
  onClose: () => void;
  title: string;
}) {
  const [mobile, setMobile] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const media = window.matchMedia("(max-width: 959px)");
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!mobile || !dialog.current) return;
    const previous = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    dialog.current.showModal();
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
      previous?.focus({ preventScroll: true });
    };
  }, [mobile]);

  const content = <>
    <div className="inspector-topline">
      <span>{title}</span>
      <button className="inspector-close" aria-label="Close details" onClick={onClose}>
        <X size={17} />
      </button>
    </div>
    {children}
  </>;

  return mobile ? <dialog
    className="session-inspector inspector-dialog"
    ref={dialog}
    aria-label={title}
    onCancel={event => {
      event.preventDefault();
      closeRef.current();
    }}
  >{content}</dialog> : <aside className="session-inspector" aria-label={title}>
    {content}
  </aside>;
}
