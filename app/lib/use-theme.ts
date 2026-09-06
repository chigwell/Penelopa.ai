"use client";

import { useEffect, useState } from "react";

export type Theme = "light" | "dark";

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  window.localStorage.setItem("penelopa-theme", theme);
}

// Recommendation navigation historically re-reads the saved theme on ID changes.
export function useTheme(resetKey?: string) {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("penelopa-theme");
    const preferredTheme =
      savedTheme === "light" || savedTheme === "dark" ? savedTheme : "light";
    setTheme(preferredTheme);
    applyTheme(preferredTheme);
  }, [resetKey]);

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    applyTheme(nextTheme);
  }

  return { theme, toggleTheme };
}
