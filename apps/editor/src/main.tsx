import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { installSharedPropTextureResolver } from "@web/game/propTextureUrls";
import { App } from "./App";
import "./styles.css";

installSharedPropTextureResolver();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
