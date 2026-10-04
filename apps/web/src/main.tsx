import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { ConfigErrorScreen } from "./ConfigErrorScreen.tsx";
import { createDependencies } from "./composition/compose.ts";
import { ConfigError, loadConfigFromEnv } from "./config.ts";
import "./design/fonts.ts";
import "./design/index.css";

const container = document.getElementById("root");
if (container === null) throw new Error("Missing #root element");
const root = createRoot(container);

try {
  // Fail fast: a missing variable shows a config error screen instead of a broken app.
  const config = loadConfigFromEnv();
  const deps = createDependencies(config, { fetch: globalThis.fetch.bind(globalThis) });
  root.render(
    <StrictMode>
      <App deps={deps} />
    </StrictMode>,
  );
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  root.render(<ConfigErrorScreen error={error} />);
}
