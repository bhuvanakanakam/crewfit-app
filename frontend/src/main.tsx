import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import App from "./App";
import { CrewAuthProvider } from "./auth";
import { applyTheme, loadTheme } from "./themes";

applyTheme(loadTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CrewAuthProvider>
      <App />
    </CrewAuthProvider>
  </StrictMode>
);
