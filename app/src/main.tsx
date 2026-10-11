import { QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./i18n";
import { createQueryClient } from "./lib/queryClient";
import { applyTheme, loadTheme } from "./lib/theme";
import "./styles/index.css";

applyTheme(loadTheme());

async function boot() {
  // In `pnpm dev` opened in a plain browser, simulate the engine (dev-only, tree-shaken
  // from production builds).
  if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
    const { installBrowserPreview } = await import("./dev/browserPreview");
    installBrowserPreview();
  }
  const root = document.getElementById("root");
  if (!root) throw new Error("#root not found");
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <QueryClientProvider client={createQueryClient()}>
        <App />
      </QueryClientProvider>
    </React.StrictMode>,
  );
}

void boot();
