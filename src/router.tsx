import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Preload route chunks (and loaders) when a link is hovered/focused —
    // makes tab-to-tab navigation feel instant.
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
  });

  return router;
};
