import type { Metadata } from "next";
import LegalPage from "../legal/LegalPage";
import termsMarkdown from "../../TERMS.md?raw";

export const metadata: Metadata = {
  title: "Terms of Service | Penelopa.ai",
  description: "Terms of Service for Penelopa.ai.",
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      updated="Last updated: 4 September 2026"
      markdown={termsMarkdown}
    />
  );
}

