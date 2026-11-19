import { useState, useEffect } from 'react'

const STATUS_MESSAGES = ['Filtering restaurants…', 'Asking AI for the best picks…']

function SkeletonCard() {
  return (
    <div className="w-full rounded-lg bg-surface border border-outline p-gutter-lg shadow-[0_4px_14px_rgba(28,28,30,0.06)] flex flex-col gap-gutter-md animate-pulse">
      <div className="flex items-start justify-between gap-gutter-md">
        <div className="flex items-start gap-gutter-md flex-1">
          <div className="w-8 h-7 rounded-sm bg-surface-container-high shrink-0" />
          <div className="flex flex-col gap-gutter-sm flex-1">
            <div className="h-5 w-44 rounded-sm bg-surface-container-high" />
            <div className="h-3.5 w-32 rounded-sm bg-surface-container" />
          </div>
        </div>
        <div className="w-12 h-7 rounded-sm bg-surface-container-high shrink-0" />
      </div>
      <div className="flex items-center justify-between gap-gutter-sm">
        <div className="flex items-center gap-gutter-xs">
          <div className="h-6 w-16 rounded-sm bg-surface-container" />
          <div className="h-6 w-20 rounded-sm bg-surface-container" />
        </div>
        <div className="h-4 w-24 rounded-sm bg-surface-container" />
      </div>
      <div className="flex gap-gutter-xs">
        <div className="h-6 w-24 rounded-full bg-surface-container" />
        <div className="h-6 w-28 rounded-full bg-surface-container" />
      </div>
      <div className="pt-gutter-sm border-t border-outline flex flex-col gap-gutter-xs">
        <div className="h-3.5 w-full rounded-sm bg-surface-container" />
        <div className="h-3.5 w-3/4 rounded-sm bg-surface-container" />
      </div>
    </div>
  )
}

export default function LoadingState() {
  const [msgIndex, setMsgIndex] = useState(0)
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const interval = setInterval(() => {
      setVisible(false)
      setTimeout(() => {
        setMsgIndex(i => (i + 1) % STATUS_MESSAGES.length)
        setVisible(true)
      }, 220)
    }, 2200)
    return () => clearInterval(interval)
  }, [])

  return (
    <main className="w-full max-w-md md:max-w-lg flex flex-col gap-gutter-2xl">

      {/* App Header */}
      <header className="flex items-center gap-gutter-sm">
        <span className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-zomato-red text-on-primary shrink-0" aria-hidden="true">
          <span className="material-symbols-outlined text-[18px]">restaurant</span>
        </span>
        <h1 className="font-headline text-title-lg text-on-surface">
          Zomato AI Restaurant Recommender
        </h1>
      </header>

      {/* Spinner + Status Message */}
      <section
        aria-live="polite"
        aria-label="Loading recommendations"
        className="flex flex-col items-center justify-center text-center gap-gutter-lg py-gutter-2xl"
      >
        <div className="relative w-14 h-14 flex items-center justify-center">
          <svg className="w-14 h-14 animate-spin text-zomato-red" viewBox="0 0 48 48" fill="none" aria-hidden="true">
            <circle cx="24" cy="24" r="20" stroke="currentColor" strokeOpacity="0.18" strokeWidth="4" />
            <path
              d="M44 24a20 20 0 0 0-20-20"
              stroke="currentColor"
              strokeWidth="4"
              strokeLinecap="round"
            />
          </svg>
        </div>
        <p
          className="font-headline text-title-md text-on-surface transition-opacity duration-[220ms] ease-[cubic-bezier(0.2,0,0,1)]"
          style={{ opacity: visible ? 1 : 0 }}
        >
          {STATUS_MESSAGES[msgIndex]}
        </p>
      </section>

      {/* Skeleton Preview — blurred & non-interactive */}
      <section
        aria-hidden="true"
        className="flex flex-col gap-gutter-lg blur-[1.5px] opacity-80 pointer-events-none select-none"
      >
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </section>

    </main>
  )
}
