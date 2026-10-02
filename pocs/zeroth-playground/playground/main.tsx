import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// The theme first: tokens.css names the cascade layers, which must come before any layered rule.
import "./theme/tokens.css";
import "./theme/base.css";
import "./theme/prose.css";
import "./theme/fonts";
import { App } from "./app/app";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("index.html has no #root element");
}
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
