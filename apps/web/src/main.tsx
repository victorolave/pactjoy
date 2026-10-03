import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { ConfigErrorScreen } from "./ConfigErrorScreen.tsx";
import { ConfigError, loadConfigFromEnv } from "./config.ts";

const container = document.getElementById("root");
if (container === null) throw new Error("Missing #root element");
const root = createRoot(container);

try {
  // Fail fast: a missing variable shows a config error screen instead of a broken app.
  loadConfigFromEnv();
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  root.render(<ConfigErrorScreen error={error} />);
}
