// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { router } from "./router.js";

describe("start page", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders the authenticated project landing experience", async () => {
    vi.stubGlobal("scrollTo", vi.fn());
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const path = String(input);
        return new Response(
          JSON.stringify(
            path.endsWith("/sessions")
              ? { schemaVersion: 1, items: [] }
              : { schemaVersion: 1, repositoryRoot: "/workspace/project" },
          ),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );
    await router.navigate({ to: "/" });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    expect(
      await screen.findByRole("heading", { name: /review every snapshot/i }),
    ).toBeTruthy();
    expect(await screen.findByText("/workspace/project")).toBeTruthy();
  });
});
