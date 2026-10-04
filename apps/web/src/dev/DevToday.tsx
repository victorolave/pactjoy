import { useMemo } from "react";
import { Link, Navigate, Route, Routes, useParams } from "react-router";
import { createTodayPersister } from "../adapters/query-persister.ts";
import type { AppDependencies } from "../composition/dependencies.ts";
import { AppProviders } from "../composition/providers.tsx";
import { createQueryClient } from "../composition/query-client.ts";
import { createSessionEvents } from "../features/auth/session-events.ts";
import { SessionManager } from "../features/auth/session-manager.ts";
import { TodayScreen } from "../features/today/TodayScreen.tsx";
import { ApiError } from "../ports/api-error.ts";
import { AppShell } from "../shell/AppShell.tsx";
import { FakeAuth, fakeSession } from "../testing/fake-auth.ts";
import { FakeConnectivity } from "../testing/fake-connectivity.ts";
import { FakeHaptics } from "../testing/fake-haptics.ts";
import { FakePactJoyApi } from "../testing/fake-pactjoy-api.ts";
import { FixedClock } from "../testing/fixed-clock.ts";
import { MemoryStorage } from "../testing/memory-storage.ts";
import { MemoryTokenStore } from "../testing/memory-token-store.ts";
import { SequentialIds } from "../testing/sequential-ids.ts";
import styles from "./DevToday.module.css";
import { SCENARIOS, type Scenario, scenarioById } from "./scenarios.ts";

/** Everything a scenario runs on is a fake: nothing here can reach the real API or auth. */
function dependenciesFor(scenario: Scenario): AppDependencies {
  const auth = new FakeAuth();
  const store = new MemoryTokenStore(fakeSession());
  const api = new FakePactJoyApi(scenario.today());
  if (scenario.mode === "loading") api.getToday = () => new Promise(() => {});
  if (scenario.mode === "error") {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      api.failNext("getToday", new ApiError("Internal", 500, "dev-scenario"));
    }
  }
  return {
    auth,
    api,
    ids: new SequentialIds(),
    haptics: new FakeHaptics(),
    connectivity: new FakeConnectivity(scenario.mode !== "offline"),
    store,
    sessions: new SessionManager(auth, store, new FixedClock(0)),
    sessionEvents: createSessionEvents(),
    queryClient: createQueryClient({ retryQueries: false }),
    persister: createTodayPersister(new MemoryStorage(), { throttleMs: 0 }),
  };
}

function ScenarioPage() {
  const { scenario: id = "" } = useParams();
  const scenario = scenarioById(id);
  // A new set of fakes per scenario: nothing carries over from the one before.
  const deps = useMemo(
    () => (scenario === undefined ? null : dependenciesFor(scenario)),
    [scenario],
  );
  if (scenario === undefined || deps === null) return <Navigate to="/dev/today" replace />;
  return (
    <div className={styles.frame}>
      <nav className={styles.bar}>
        <Link to="/dev/today">← Escenarios</Link>
        <span>{scenario.title}</span>
      </nav>
      <div className={styles.stage}>
        <AppProviders deps={deps} key={scenario.id}>
          <AppShell>
            <TodayScreen />
          </AppShell>
        </AppProviders>
      </div>
    </div>
  );
}

function Index() {
  return (
    <main className={styles.index}>
      <h1>Escenarios de Hoy</h1>
      <p>Solo en desarrollo. Cada uno muestra la pantalla real con datos de prueba.</p>
      <ul>
        {SCENARIOS.map((scenario) => (
          <li key={scenario.id}>
            <Link to={`/dev/today/${scenario.id}`}>
              <b>{scenario.title}</b>
              <span>{scenario.description}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}

/** The dev-only Today gallery: `/dev/today` and `/dev/today/:scenario`. */
export function DevToday() {
  return (
    <Routes>
      <Route index element={<Index />} />
      <Route path=":scenario" element={<ScenarioPage />} />
    </Routes>
  );
}

export default DevToday;
