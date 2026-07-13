import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from "@tanstack/react-router";
import { ReviewPage } from "./screens/ReviewPage.js";
import { StartPage } from "./screens/StartPage.js";

const rootRoute = createRootRoute({ component: () => <Outlet /> });
const startRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: StartPage,
});
const runRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/runs/$sessionId",
  component: ReviewPage,
});
const testRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/runs/$sessionId/tests/$testId",
  component: ReviewPage,
});
const reviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/runs/$sessionId/review",
  component: ReviewPage,
});
const entryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/runs/$sessionId/review/$entryId",
  component: ReviewPage,
});
const previewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/runs/$sessionId/preview",
  component: ReviewPage,
});
const historyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/runs/$sessionId/history",
  component: ReviewPage,
});
const routeTree = rootRoute.addChildren([
  startRoute,
  runRoute,
  testRoute,
  reviewRoute,
  entryRoute,
  previewRoute,
  historyRoute,
]);
export const router = createRouter({ routeTree });
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
