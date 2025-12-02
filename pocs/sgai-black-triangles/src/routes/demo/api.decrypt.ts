import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { createDecipheriv } from 'node:crypto'

const ENCRYPTION_SECRET = process.env.ENCRYPTION_SECRET
const ALGORITHM = 'aes-256-gcm'

export const Route = createFileRoute('/demo/api/decrypt')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!ENCRYPTION_SECRET) {
          return json(
            { error: 'Server encryption not configured' },
            { status: 500 },
          )
        }

        const { cipherText, iv, authTag } = await request.json()
        if (!cipherText || !iv || !authTag) {
          return json(
            { error: 'Missing cipherText, iv, or authTag' },
            { status: 400 },
          )
        }

        try {
          // Derive 32-byte key from secret
          const key = Buffer.alloc(32)
          Buffer.from(ENCRYPTION_SECRET).copy(key)

          const decipher = createDecipheriv(
            ALGORITHM,
            key,
            Buffer.from(iv, 'base64'),
          )
          decipher.setAuthTag(Buffer.from(authTag, 'base64'))

          let decrypted = decipher.update(cipherText, 'base64', 'utf8')
          decrypted += decipher.final('utf8')

          return json({ value: decrypted })
        } catch {
          return json({ error: 'Decryption failed' }, { status: 400 })
        }
      },
    },
  },
})
