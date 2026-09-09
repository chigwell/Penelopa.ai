"use client";

import { useEffect, useRef, useState } from "react";
import { apiGet, type ApiError } from "../lib/penelopa-client";
import type { Recommendation, RecommendationDetail } from "../lib/api-types";
import { copyText } from "../lib/clipboard";

export function useRecommendationReports(token: string | null, handleLogout: () => void, setError: (message: string) => void) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedRecommendation, setExpandedRecommendation] = useState<RecommendationDetail | null>(null);
  const [expandedLoading, setExpandedLoading] = useState(false);
  const expandedRequest = useRef(0);
  const copiedRequest = useRef(0);
  const expandedController = useRef<AbortController | null>(null);
  const copiedController = useRef<AbortController | null>(null);
  const copiedTimer = useRef<number | undefined>(undefined);
  const activeToken = useRef(token);
  activeToken.current = token;

  useEffect(() => {
    setCopiedId(null);
    setExpandedId(null);
    setExpandedRecommendation(null);
    setExpandedLoading(false);
    return () => {
      expandedRequest.current += 1;
      copiedRequest.current += 1;
      expandedController.current?.abort();
      copiedController.current?.abort();
      window.clearTimeout(copiedTimer.current);
    };
  }, [token]);

  async function copyRecommendation(item: Recommendation) {
    if (!token) return;
    const version = ++copiedRequest.current;
    copiedController.current?.abort();
    const controller = new AbortController();
    copiedController.current = controller;
    try {
      const detail = await apiGet<RecommendationDetail>(`/hermes/recommendations/${encodeURIComponent(item.id)}`, token, { signal: controller.signal });
      if (copiedRequest.current !== version || activeToken.current !== token) return;
      await copyText(detail.report_markdown);
      if (copiedRequest.current !== version || activeToken.current !== token) return;
      setCopiedId(item.id);
      window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopiedId(null), 1600);
    } catch (caught) {
      if (copiedRequest.current !== version || controller.signal.aborted || activeToken.current !== token) return;
      const requestError = caught as ApiError;
      if (requestError.status === 401 || requestError.status === 403) {
        handleLogout();
        setError("Your access token has expired. Enter it again.");
      } else setError("This recommendation could not be copied.");
    }
  }

  async function toggleRecommendation(item: Recommendation) {
    const version = ++expandedRequest.current;
    expandedController.current?.abort();
    if (expandedId === item.id) {
      setExpandedId(null);
      setExpandedRecommendation(null);
      setExpandedLoading(false);
      return;
    }
    if (!token) return;
    const controller = new AbortController();
    expandedController.current = controller;
    setExpandedId(item.id);
    setExpandedRecommendation(null);
    setExpandedLoading(true);
    setError("");
    try {
      const detail = await apiGet<RecommendationDetail>(`/hermes/recommendations/${encodeURIComponent(item.id)}`, token, { signal: controller.signal });
      if (expandedRequest.current !== version || activeToken.current !== token) return;
      setExpandedRecommendation(detail);
    } catch (caught) {
      if (expandedRequest.current !== version || controller.signal.aborted || activeToken.current !== token) return;
      const requestError = caught as ApiError;
      if (requestError.status === 401 || requestError.status === 403) {
        handleLogout();
        setError("Your access token has expired. Enter it again.");
      } else setError("This recommendation could not be loaded.");
    } finally {
      if (expandedRequest.current === version && activeToken.current === token) setExpandedLoading(false);
    }
  }

  return { copiedId, expandedId, expandedRecommendation, expandedLoading, copyRecommendation, toggleRecommendation };
}
