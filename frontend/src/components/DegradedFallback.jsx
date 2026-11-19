import RestaurantCard from './RestaurantCard.jsx'

export default function DegradedFallback({ recommendations, onSearchAgain }) {
  return (
    <main className="w-full max-w-md md:max-w-lg flex flex-col gap-gutter-xl">

      {/* App Header */}
      <header className="flex items-center justify-between gap-gutter-md">
        <div className="flex items-center gap-gutter-sm">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-zomato-red text-on-primary shrink-0" aria-hidden="true">
            <span className="material-symbols-outlined text-[18px]">restaurant</span>
          </span>
          <h1 className="font-headline text-title-lg text-on-surface">
            Zomato AI Restaurant Recommender
          </h1>
        </div>
      </header>

      {/* Warning Banner */}
      <div
        role="region"
        aria-label="Degraded ranking warning"
        className="flex items-center gap-gutter-md p-gutter-lg rounded-md bg-warning-container text-on-warning-container border border-on-warning-container/20"
      >
        <p className="font-label text-label-md">
          ⚠ AI ranking unavailable — showing top-rated matches
        </p>
      </div>

      {/* Restaurant Cards (no highlights / explanation) */}
      <section aria-label="Top-rated restaurant matches" className="flex flex-col gap-gutter-lg">
        {recommendations.map(rec => (
          <RestaurantCard
            key={rec.rank}
            rank={rec.rank}
            restaurant={rec.restaurant}
            explanation=""
            highlights={[]}
          />
        ))}
      </section>

      {/* Search Again */}
      <footer className="pt-gutter-sm pb-gutter-lg">
        <button
          type="button"
          onClick={onSearchAgain}
          className="w-full inline-flex items-center justify-center gap-gutter-sm px-gutter-2xl py-gutter-md rounded-md border border-primary bg-surface text-primary hover:bg-primary-container active:scale-[0.99] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary transition-colors duration-state-change ease-state-change font-label text-label-lg"
        >
          Search Again
        </button>
      </footer>

    </main>
  )
}
