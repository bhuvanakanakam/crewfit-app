import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { CrewAuthProvider } from "./auth";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CrewAuthProvider>
      <App />
    </CrewAuthProvider>
  </StrictMode>
);
