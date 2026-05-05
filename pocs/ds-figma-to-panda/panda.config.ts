import { defineConfig } from '@pandacss/dev';

export default defineConfig({
  // Whether to use css reset
  preflight: true,

  include: [
    // Where to look for your css declarations
    './src/**/*.{js,jsx,ts,tsx}',
    './dev/**/*.{js,jsx,ts,tsx}',
    './tests/**/*.{js,jsx,ts,tsx}',
  ],

  // Files to exclude
  exclude: [],

  // Useful for theme customization
  theme: {
    extend: {},
  },

  // The output directory for your css system
  outdir: 'styled-system',
});
