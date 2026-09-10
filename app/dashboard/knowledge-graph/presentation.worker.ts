import { prepareGraphPresentation } from "../../lib/knowledge-graph-presentation";
import type { PresentationRequest, PresentationResponse } from "../../lib/knowledge-graph-types";

self.onmessage = (event: MessageEvent<PresentationRequest>) => {
  const request = event.data;
  try {
    self.postMessage({ id: request.id, presentation: prepareGraphPresentation(request) } satisfies PresentationResponse);
  } catch {
    self.postMessage({ id: request.id, error: "Graph communities could not be prepared." } satisfies PresentationResponse);
  }
};
