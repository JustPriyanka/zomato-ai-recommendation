import { useState, useEffect } from 'react'
import PreferenceForm from './components/PreferenceForm.jsx'
import LoadingState from './components/LoadingState.jsx'
import ResultsPage from './components/ResultsPage.jsx'
import DegradedFallback from './components/DegradedFallback.jsx'
import { getRecommendations, healthCheck } from './api.js'

// view: 'form' | 'loading' | 'results' | 'degraded' | 'no_results' | 'error'
export default function App() {
  const [view, setView] = useState('form')
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [backendStatus, setBackendStatus] = useState('ok') // 'ok' | 'loading' | 'error'

  // Poll health on mount — shows a warm-up banner if Railway is still loading the dataset
  useEffect(() => {
    let timer
    async function checkHealth() {
      try {
        const h = await healthCheck()
        setBackendStatus(h.status)
        if (h.status === 'loading') {
          timer = setTimeout(checkHealth, 5000) // retry every 5s until ready
        }
      } catch {
        setBackendStatus('error')
      }
    }
    checkHealth()
    return () => clearTimeout(timer)
  }, [])

  async function handleSubmit(prefs) {
    setView('loading')
    setError(null)
    try {
      const data = await getRecommendations(prefs)
      setResult(data)
      if (data.mode === 'no_results') {
        setView('no_results')
      } else if (data.mode === 'degraded') {
        setView('degraded')
      } else {
        setView('results')
      }
    } catch (err) {
      setError(err.message)
      setView('error')
    }
  }

  function handleSearchAgain() {
    setView('form')
    setResult(null)
  }

  return (
    <div className="min-h-screen bg-surface-container-low text-on-surface antialiased">
      <div className="w-full flex flex-col items-center px-page-margin py-gutter-xl md:py-section">

        {/* Railway cold-start banner — shown until the backend finishes loading the dataset */}
        {backendStatus === 'loading' && view === 'form' && (
          <div className="w-full max-w-md md:max-w-2xl mb-[-8px]">
            <div className="flex items-center gap-gutter-md px-gutter-lg py-gutter-md rounded-md bg-warning-container text-on-warning-container border border-on-warning-container/20">
              <svg className="w-4 h-4 animate-spin shrink-0 text-on-warning-container" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3"/>
                <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
              </svg>
              <p className="font-label text-label-md">
                Backend is warming up — dataset loading, usually takes ~30s…
              </p>
            </div>
          </div>
        )}

        {view === 'form' && (
          <PreferenceForm onSubmit={handleSubmit} />
        )}

        {view === 'loading' && (
          <LoadingState />
        )}

        {view === 'results' && result && (
          <ResultsPage
            summary={result.summary}
            recommendations={result.recommendations}
            onSearchAgain={handleSearchAgain}
          />
        )}

        {view === 'degraded' && result && (
          <DegradedFallback
            recommendations={result.recommendations}
            onSearchAgain={handleSearchAgain}
          />
        )}

        {view === 'no_results' && (
          <main className="w-full max-w-md md:max-w-lg flex flex-col gap-gutter-xl">
            <AppHeader />
            <div className="flex flex-col items-center gap-gutter-lg py-section text-center">
              <span className="material-symbols-outlined text-[48px] text-on-surface-variant">
                search_off
              </span>
              <p className="font-body text-body-lg text-on-surface-variant">
                No restaurants found matching your criteria.
                <br />Try broadening your search.
              </p>
              <button
                onClick={handleSearchAgain}
                className="inline-flex items-center justify-center px-gutter-2xl py-gutter-md rounded-md border border-primary bg-surface text-primary hover:bg-primary-container transition-colors duration-state-change ease-state-change font-label text-label-lg"
              >
                Search Again
              </button>
            </div>
          </main>
        )}

        {view === 'error' && (
          <main className="w-full max-w-md md:max-w-lg flex flex-col gap-gutter-xl">
            <AppHeader />
            <div className="flex flex-col items-center gap-gutter-lg py-section text-center">
              <span className="material-symbols-outlined text-[48px] text-zomato-red">
                error
              </span>
              <p className="font-body text-body-lg text-on-surface-variant">
                Something went wrong. Please try again.
              </p>
              {error && (
                <p className="font-mono text-mono-sm text-on-surface-variant bg-surface-container px-gutter-md py-gutter-sm rounded-md">
                  {error}
                </p>
              )}
              <button
                onClick={handleSearchAgain}
                className="inline-flex items-center justify-center px-gutter-2xl py-gutter-md rounded-md border border-primary bg-surface text-primary hover:bg-primary-container transition-colors duration-state-change ease-state-change font-label text-label-lg"
              >
                Try Again
              </button>
            </div>
          </main>
        )}

      </div>
    </div>
  )
}

function AppHeader() {
  return (
    <header className="flex items-center gap-gutter-sm">
      <span className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-zomato-red text-on-primary shrink-0" aria-hidden="true">
        <span className="material-symbols-outlined text-[18px]">restaurant</span>
      </span>
      <h1 className="font-headline text-title-lg text-on-surface">
        Zomato AI Restaurant Recommender
      </h1>
    </header>
  )
}
