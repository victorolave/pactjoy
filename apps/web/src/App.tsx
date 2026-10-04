import { BrowserRouter } from "react-router";
import type { AppDependencies } from "./composition/dependencies.ts";
import { AppProviders } from "./composition/providers.tsx";
import { ErrorBoundary } from "./shell/ErrorBoundary.tsx";
import { AppRoutes } from "./shell/routes.tsx";

export function App({ deps }: { readonly deps: AppDependencies }) {
  return (
    <ErrorBoundary persister={deps.persister} queryClient={deps.queryClient}>
      <AppProviders deps={deps}>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </AppProviders>
    </ErrorBoundary>
  );
}
