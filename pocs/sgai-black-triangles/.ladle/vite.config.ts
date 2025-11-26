import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

const config = defineConfig({
  plugins: [tailwindcss()],
})

export default config
