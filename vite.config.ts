import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

// ⚠️ ЗАМЕНИ на точное имя твоего репозитория на GitHub
const REPO_NAME = 'ryadom-dps'

export default defineConfig({
  base: `/${REPO_NAME}/`,   // ← ЭТО ГЛАВНАЯ СТРОКА, из-за которой был белый экран
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Рядом ДПС',
        short_name: 'Рядом ДПС',
        description: 'Карта дорожной обстановки',
        theme_color: '#E11D2E',
        background_color: '#0A0A0A',
        display: 'standalone',
        orientation: 'portrait',
        start_url: `/${REPO_NAME}/`,
        scope: `/${REPO_NAME}/`,
        icons: [
          { src: `/${REPO_NAME}/icon-192.png`, sizes: '192x192', type: 'image/png' },
          { src: `/${REPO_NAME}/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: `/${REPO_NAME}/index.html`
      }
    })
  ],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  build: { target: 'es2022' }
})
