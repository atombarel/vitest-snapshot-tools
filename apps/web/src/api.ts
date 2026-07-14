import type {
  ApplyPlan,
  ApplyResult,
  Decision,
  EntryDiff,
  Page,
  ReviewNode,
  ReviewSession,
  RunEvent,
  SessionSummary,
  TestReview,
  TestSource,
} from "@vsnap/protocol";

let bearerToken = "";
export function consumeToken(): void {
  const fragment = new URLSearchParams(location.hash.slice(1));
  bearerToken = fragment.get("token") ?? "";
  history.replaceState(null, "", `${location.pathname}${location.search}`);
}
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      authorization: `Bearer ${bearerToken}`,
      "content-type": "application/json",
      ...init?.headers,
    },
  });
  const value = await response.json();
  if (!response.ok)
    throw new Error(
      value.error?.message ?? `Request failed: ${response.status}`,
    );
  return value as T;
}
export const api = {
  project: () => request<{ repositoryRoot: string }>("/api/v1/project"),
  sessions: () =>
    request<{ items: SessionSummary[] }>("/api/v1/sessions").then(
      (value) => value.items,
    ),
  session: (id: string) => request<ReviewSession>(`/api/v1/sessions/${id}`),
  nodes: (id: string, kind?: string, status?: string) =>
    request<Page<ReviewNode>>(
      `/api/v1/sessions/${id}/nodes?${new URLSearchParams({ limit: "10000", ...(kind ? { kind } : {}), ...(status ? { status } : {}) })}`,
    ),
  diff: (id: string, entryId: string) =>
    request<EntryDiff>(`/api/v1/sessions/${id}/entries/${entryId}`),
  source: (id: string, entryId: string) =>
    request<TestSource>(`/api/v1/sessions/${id}/entries/${entryId}/source`),
  review: (id: string, entryId: string) =>
    request<TestReview>(`/api/v1/sessions/${id}/entries/${entryId}/review`),
  decide: (
    id: string,
    selector: string,
    decision: Decision,
    expectedRevision: number,
  ) =>
    request(`/api/v1/sessions/${id}/decisions`, {
      method: "PUT",
      body: JSON.stringify({ selector, decision, expectedRevision }),
    }),
  preview: (id: string, expectedRevision: number) =>
    request<ApplyPlan>(`/api/v1/sessions/${id}/preview`, {
      method: "POST",
      body: JSON.stringify({ expectedRevision }),
    }),
  apply: (id: string, expectedRevision: number) =>
    request<ApplyResult>(`/api/v1/sessions/${id}/apply`, {
      method: "POST",
      body: JSON.stringify({ expectedRevision }),
    }),
  cancel: (id: string) =>
    request(`/api/v1/sessions/${id}/cancel`, { method: "POST", body: "{}" }),
  rerun: (id: string) =>
    request<ReviewSession>(`/api/v1/sessions/${id}/rerun`, {
      method: "POST",
      body: "{}",
    }),
};

export async function subscribeEvents(
  id: string,
  after: number,
  onEvent: (event: RunEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch(`/api/v1/sessions/${id}/events`, {
    headers: {
      authorization: `Bearer ${bearerToken}`,
      "last-event-id": String(after),
    },
    signal,
  });
  if (!response.ok || !response.body)
    throw new Error("Live event stream failed");
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += value;
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      const data = block
        .split("\n")
        .find((line) => line.startsWith("data:"))
        ?.slice(5)
        .trim();
      if (data) onEvent(JSON.parse(data) as RunEvent);
    }
  }
}
