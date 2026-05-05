import { useNavigate } from '@tanstack/react-router'

import { showAIAssistant } from './example-AIAssistant'

import guitars from '../data/example-guitars'

export default function GuitarRecommendation({ id }: { id: string }) {
  const navigate = useNavigate()
  const guitar = guitars.find((guitar) => guitar.id === +id)
  if (!guitar) {
    return null
  }
  return (
    <div className="my-4 overflow-hidden rounded-lg border border-orange-500/20 bg-gray-800/50">
      <div className="relative aspect-[4/3] overflow-hidden">
        <img
          src={guitar.image}
          alt={guitar.name}
          className="h-full w-full object-cover"
        />
      </div>
      <div className="p-4">
        <h3 className="mb-2 text-lg font-semibold text-white">{guitar.name}</h3>
        <p className="mb-3 line-clamp-2 text-sm text-gray-300">
          {guitar.shortDescription}
        </p>
        <div className="flex items-center justify-between">
          <div className="text-lg font-bold text-emerald-400">
            ${guitar.price}
          </div>
          <button
            onClick={() => {
              navigate({
                to: '/demo/guitars/$guitarId',
                params: { guitarId: guitar.id.toString() },
              })
              showAIAssistant.setState(() => false)
            }}
            className="rounded-lg bg-gradient-to-r from-orange-500 to-red-600 px-4 py-1.5 text-sm text-white transition-opacity hover:opacity-90"
          >
            View Details
          </button>
        </div>
      </div>
    </div>
  )
}
