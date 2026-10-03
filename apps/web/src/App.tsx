import { BrowserRouter } from "react-router";
import { AppRoutes } from "./app/routes.tsx";

export function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
