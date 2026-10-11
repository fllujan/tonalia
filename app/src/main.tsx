import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./i18n";
import { applyTheme, loadTheme } from "./lib/theme";
import "./styles/index.css";

applyTheme(loadTheme());

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
