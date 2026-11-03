import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// The speed comparison (npm run bench) loads its code only when asked for.
if (new URLSearchParams(location.search).has("bench")) void import("./bench");
