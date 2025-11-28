import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { createCipheriv, randomBytes } from 'node:crypto'

const ENCRYPTION_SECRET = process.env.ENCRYPTION_SECRET
const ALGORITHM = 'aes-256-gcm'

export const Route = createFileRoute('/demo/api/encrypt')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!ENCRYPTION_SECRET) {
          return json({ error: 'Server encryption not configured' }, { status: 500 })
        }

        const { value } = await request.json()
        if (!value || typeof value !== 'string') {
          return json({ error: 'Missing value' }, { status: 400 })
        }

        // Derive 32-byte key from secret
        const key = Buffer.alloc(32)
        Buffer.from(ENCRYPTION_SECRET).copy(key)

        const iv = randomBytes(12)
        const cipher = createCipheriv(ALGORITHM, key, iv)

        let encrypted = cipher.update(value, 'utf8', 'base64')
        encrypted += cipher.final('base64')
        const authTag = cipher.getAuthTag().toString('base64')

        return json({
          cipherText: encrypted,
          iv: iv.toString('base64'),
          authTag,
        })
      },
    },
  },
})
