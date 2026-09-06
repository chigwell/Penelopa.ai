"use client";

import { useState } from "react";
import { apiGet, type ApiError } from "../lib/penelopa-client";
import type { Recommendation, RecommendationDetail } from "../lib/api-types";
import { copyText } from "../lib/clipboard";

export function useRecommendationReports(
  token: string | null,
  handleLogout: () => void,
  setError: (message: string) => void,
) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedRecommendation, setExpandedRecommendation] =
    useState<RecommendationDetail | null>(null);
  const [expandedLoading, setExpandedLoading] = useState(false);

  async function copyRecommendation(item: Recommendation) {
    if (!token) {
      return;
    }

    try {
      const detail = await apiGet<RecommendationDetail>(
        `/hermes/recommendations/${item.id}`,
        token,
      );
      await copyText(detail.report_markdown);
      setCopiedId(item.id);
      window.setTimeout(() => setCopiedId(null), 1600);
    } catch (caught) {
      const requestError = caught as ApiError;
      if (requestError.status === 401 || requestError.status === 403) {
        handleLogout();
        setError("Your access token has expired. Enter it again.");
        return;
      }
      setError("This recommendation could not be copied.");
    }
  }

  async function toggleRecommendation(item: Recommendation) {
    if (expandedId === item.id) {
      setExpandedId(null);
      setExpandedRecommendation(null);
      return;
    }
    if (!token) {
      return;
    }

    setExpandedId(item.id);
    setExpandedRecommendation(null);
    setExpandedLoading(true);
    setError("");
    try {
      const detail = await apiGet<RecommendationDetail>(
        `/hermes/recommendations/${item.id}`,
        token,
      );
      setExpandedRecommendation(detail);
    } catch (caught) {
      const requestError = caught as ApiError;
      if (requestError.status === 401 || requestError.status === 403) {
        handleLogout();
        setError("Your access token has expired. Enter it again.");
      } else {
        setError("This recommendation could not be loaded.");
      }
    } finally {
      setExpandedLoading(false);
    }
  }

  return {
    copiedId, expandedId, expandedRecommendation, expandedLoading,
    copyRecommendation, toggleRecommendation,
  };
}
