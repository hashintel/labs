import { createRouter } from '@tanstack/react-router'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// export function getContext() {
//   const queryClient = new QueryClient()
//   return {
//     queryClient,
//   }
// }

export function Provider({
  children,
  queryClient,
}: {
  children: React.ReactNode
  queryClient: QueryClient
}) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

// Import the generated route tree
import { routeTree } from './routeTree.gen'

// Create a new router instance
export const getRouter = () => {
  const queryContext = { queryClient: new QueryClient() }

  const router = createRouter({
    routeTree,
    context: { ...queryContext },
    defaultPreload: 'intent',
    Wrap: (props: { children: React.ReactNode }) => {
      return <Provider {...queryContext}>{props.children}</Provider>
    },
  })

  setupRouterSsrQueryIntegration({ router, ...queryContext })

  return router
}
