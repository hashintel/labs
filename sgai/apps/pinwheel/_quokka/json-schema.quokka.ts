import { z } from 'zod/v4'

const schema = z.object({
  name: z.string(),
  age: z.number(),
})

const jsonSchema = z.toJSONSchema(schema) //?
