/**
 * Shared restaurant card — used in both ResultsPage (with explanation + highlights)
 * and DegradedFallback (without).
 *
 * Props:
 *   rank        {number}
 *   restaurant  {object}  — name, location, cuisines, cost_for_two, rating, votes
 *   explanation {string}  — shown as italic footer; hidden if empty
 *   highlights  {string[]}— amber chip tags; hidden if empty
 */
export default function RestaurantCard({ rank, restaurant, explanation, highlights }) {
  const { name, location, cuisines = [], cost_for_two, rating, votes } = restaurant
  const showHighlights = highlights && highlights.length > 0
  const showExplanation = explanation && explanation.trim().length > 0

  return (
    <article className="w-full rounded-lg bg-surface border border-outline p-gutter-lg shadow-[0_4px_14px_rgba(28,28,30,0.06)] flex flex-col gap-gutter-md">

      {/* Header: rank + name + rating */}
      <header className="flex items-start justify-between gap-gutter-md">
        <div className="flex items-start gap-gutter-md">
          <span className="inline-flex items-center justify-center px-gutter-sm py-gutter-xs rounded-sm bg-primary text-on-primary font-label text-label-md tabular-nums shrink-0">
            #{rank}
          </span>
          <div className="flex flex-col gap-gutter-xs">
            <h2 className="font-headline text-title-lg text-on-surface">{name}</h2>
            <p className="font-body text-body-sm text-on-surface-variant flex items-center gap-gutter-xs">
              <span className="material-symbols-outlined text-[15px] text-zomato-red" aria-hidden="true">
                location_on
              </span>
              <span>{location}</span>
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-gutter-xs shrink-0">
          {rating != null ? (
            <span className="inline-flex items-center gap-gutter-xs px-gutter-sm py-gutter-xs rounded-sm bg-rating-green text-on-rating-green">
              <span className="font-label text-label-md tabular-nums">{rating.toFixed(1)}</span>
              <span className="material-symbols-outlined text-[13px]" style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">
                star
              </span>
            </span>
          ) : (
            <span className="inline-flex items-center px-gutter-sm py-gutter-xs rounded-sm bg-surface-container text-on-surface-variant font-label text-label-sm">
              N/A
            </span>
          )}
          <span className="font-label text-label-sm text-on-surface-variant tabular-nums">
            {votes != null ? votes.toLocaleString('en-IN') : '0'} votes
          </span>
        </div>
      </header>

      {/* Cuisine chips + cost */}
      <div className="flex flex-wrap items-center justify-between gap-gutter-sm">
        <div className="flex flex-wrap items-center gap-gutter-xs">
          {cuisines.slice(0, 3).map((c, i) => (
            <span
              key={i}
              className="px-gutter-sm py-gutter-xs rounded-sm bg-surface-container text-on-surface-variant font-label text-label-sm"
            >
              {c}
            </span>
          ))}
        </div>
        {cost_for_two != null && (
          <span className="font-mono text-mono-sm text-on-surface tabular-nums">
            ₹{cost_for_two.toLocaleString('en-IN')} for two
          </span>
        )}
      </div>

      {/* Highlight tags (AI mode only) */}
      {showHighlights && (
        <div className="flex flex-wrap gap-gutter-xs">
          {highlights.map((h, i) => (
            <span
              key={i}
              className="inline-flex items-center px-gutter-sm py-gutter-xs rounded-full bg-amber-container text-on-amber-container font-label text-label-sm"
            >
              {h}
            </span>
          ))}
        </div>
      )}

      {/* AI explanation footer */}
      {showExplanation && (
        <div className="pt-gutter-sm border-t border-outline">
          <p className="font-body text-body-sm italic text-on-surface-variant">
            {explanation}
          </p>
        </div>
      )}

    </article>
  )
}
