import type { Metadata } from "next";
import LegalPage from "../legal/LegalPage";
import privacyMarkdown from "../../PRIVACY.md?raw";

export const metadata: Metadata = {
  title: "Privacy Policy | Penelopa.ai",
  description: "Privacy Policy for Penelopa.ai.",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated="Last updated: 4 September 2026"
      markdown={privacyMarkdown}
    />
  );
}

