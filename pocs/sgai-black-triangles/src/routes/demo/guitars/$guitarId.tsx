import { Link, createFileRoute } from '@tanstack/react-router'
import guitars from '@/data/example-guitars'

export const Route = createFileRoute('/demo/guitars/$guitarId')({
  component: RouteComponent,
  loader: async ({ params }) => {
    const guitar = guitars.find((guitar) => guitar.id === +params.guitarId)
    if (!guitar) {
      throw new Error('Guitar not found')
    }
    return guitar
  },
})

function RouteComponent() {
  const guitar = Route.useLoaderData()

  return (
    <div className="relative flex min-h-[100vh] items-center bg-black p-5 text-white">
      <div className="relative z-10 w-[60%] rounded-2xl border border-gray-800/50 bg-gray-900/60 p-8 shadow-xl backdrop-blur-md">
        <Link
          to="/demo/guitars"
          className="mb-4 inline-block text-emerald-400 hover:text-emerald-300"
        >
          &larr; Back to all guitars
        </Link>
        <h1 className="mb-4 text-3xl font-bold">{guitar.name}</h1>
        <p className="mb-6 text-gray-300">{guitar.description}</p>
        <div className="flex items-center justify-between">
          <div className="text-2xl font-bold text-emerald-400">
            ${guitar.price}
          </div>
          <button className="rounded-lg bg-emerald-600 px-6 py-2 text-white transition-colors hover:bg-emerald-500">
            Add to Cart
          </button>
        </div>
      </div>

      <div className="absolute top-0 right-0 z-0 h-full w-[55%]">
        <div className="h-full w-full overflow-hidden rounded-2xl border-4 border-gray-800 shadow-2xl">
          <img
            src={guitar.image}
            alt={guitar.name}
            className="guitar-image h-full w-full object-cover"
          />
        </div>
      </div>
    </div>
  )
}
