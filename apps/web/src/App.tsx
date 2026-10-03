import { BrowserRouter } from "react-router";
import type { AppDependencies } from "./app/dependencies.ts";
import { ErrorBoundary } from "./app/ErrorBoundary.tsx";
import { AppProviders } from "./app/providers.tsx";
import { AppRoutes } from "./app/routes.tsx";

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
