/**
 * API client for the Zomato AI backend.
 *
 * Local dev:  requests go to /api (proxied to localhost:8000 by Vite)
 * Production: set VITE_API_URL=https://your-railway-app.up.railway.app in Vercel
 */
const BASE_URL = import.meta.env.VITE_API_URL ?? ''

/**
 * @param {Object} prefs - UserPreferences matching the backend schema
 * @returns {Promise<{mode: string, summary: string, recommendations: Array}>}
 */
export async function getRecommendations(prefs) {
  const response = await fetch(`${BASE_URL}/api/recommend`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(prefs),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`API error ${response.status}: ${text}`)
  }

  return response.json()
}

export async function healthCheck() {
  const response = await fetch(`${BASE_URL}/api/health`)
  return response.json()
}
