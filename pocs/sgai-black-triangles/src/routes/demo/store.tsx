import { createFileRoute } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'

import { fullName, store } from '@/devtools/demo-store'

export const Route = createFileRoute('/demo/store')({
  component: DemoStore,
})

function FirstName() {
  const firstName = useStore(store, (state) => state.firstName)
  return (
    <input
      type="text"
      value={firstName}
      onChange={(e) =>
        store.setState((state) => ({ ...state, firstName: e.target.value }))
      }
      className="rounded-lg border border-white/20 bg-white/10 px-4 py-2 placeholder-white/40 transition-colors duration-200 outline-none hover:border-white/40 focus:border-white/60"
    />
  )
}

function LastName() {
  const lastName = useStore(store, (state) => state.lastName)
  return (
    <input
      type="text"
      value={lastName}
      onChange={(e) =>
        store.setState((state) => ({ ...state, lastName: e.target.value }))
      }
      className="rounded-lg border border-white/20 bg-white/10 px-4 py-2 placeholder-white/40 transition-colors duration-200 outline-none hover:border-white/40 focus:border-white/60"
    />
  )
}

function FullName() {
  const fName = useStore(fullName)
  return (
    <div className="rounded-lg bg-white/10 px-4 py-2 outline-none">{fName}</div>
  )
}

function DemoStore() {
  return (
    <div
      className="flex h-full min-h-[calc(100vh-32px)] w-full items-center justify-center p-8 text-white"
      style={{
        backgroundImage:
          'radial-gradient(50% 50% at 80% 80%, #f4a460 0%, #8b4513 70%, #1a0f0a 100%)',
      }}
    >
      <div className="flex min-w-1/2 flex-col gap-4 rounded-xl bg-white/10 p-8 text-3xl shadow-lg backdrop-blur-lg">
        <h1 className="mb-5 text-4xl font-bold">Store Example</h1>
        <FirstName />
        <LastName />
        <FullName />
      </div>
    </div>
  )
}
