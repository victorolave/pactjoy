import { BrowserRouter } from "react-router";
import type { AppDependencies } from "./app/dependencies.ts";
import { AppProviders } from "./app/providers.tsx";
import { AppRoutes } from "./app/routes.tsx";

export function App({ deps }: { readonly deps: AppDependencies }) {
  return (
    <AppProviders deps={deps}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AppProviders>
  );
}
