import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { consumeToken } from "./api.js";
import { Toaster } from "./components/ui/sonner.js";
import { router } from "./router.js";
import { parseThemeMode, resolveTheme } from "./theme.js";
import "./styles.css";

consumeToken();
const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
const applyThemePreference = () => {
  const mode = parseThemeMode(localStorage.getItem("vsnap-theme"));
  document.documentElement.dataset.themeMode = mode;
  document.documentElement.dataset.theme = resolveTheme(
    mode,
    systemTheme.matches,
  );
};
applyThemePreference();
systemTheme.addEventListener("change", applyThemePreference);
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 500, retry: 1 } },
});
const root = document.getElementById("root");
if (!root) throw new Error("Missing application root");
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>
  </StrictMode>,
);
