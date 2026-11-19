import { useState, useRef, useEffect } from 'react'

// Dining style → regex pattern that matches dataset restaurant_type values
const DINING_STYLES = [
  {
    label: 'Dine-in',
    icon: 'restaurant',
    value: 'casual dining|fine dining|bar|lounge|pub|microbrewery',
  },
  {
    label: 'Café & Desserts',
    icon: 'local_cafe',
    value: 'cafe|dessert|bakery|sweet|beverage',
  },
  {
    label: 'Quick Bites',
    icon: 'lunch_dining',
    value: 'quick bites|delivery|takeaway|food court',
  },
]

// ---------------------------------------------------------------------------
// StarDisplay
// ---------------------------------------------------------------------------
function StarDisplay({ value }) {
  const stars = []
  for (let i = 1; i <= 5; i++) {
    if (value >= i) {
      stars.push(<span key={i} className="material-symbols-outlined text-[16px]" style={{ fontVariationSettings: "'FILL' 1" }}>star</span>)
    } else if (value >= i - 0.5) {
      stars.push(<span key={i} className="material-symbols-outlined text-[16px]" style={{ fontVariationSettings: "'FILL' 1" }}>star_half</span>)
    } else {
      stars.push(<span key={i} className="material-symbols-outlined text-[16px]">star</span>)
    }
  }
  return <div className="flex items-center text-star-gold" aria-hidden="true">{stars}</div>
}

// ---------------------------------------------------------------------------
// LocationCombobox
// ---------------------------------------------------------------------------
function LocationCombobox({ value, onChange, locations }) {
  const [open, setOpen] = useState(false)
  const [geoLoading, setGeoLoading] = useState(false)
  const [geoError, setGeoError] = useState('')
  const containerRef = useRef(null)
  const inputRef = useRef(null)
  const listRef = useRef(null)
  const [activeIdx, setActiveIdx] = useState(-1)

  const filtered = value.trim()
    ? locations.filter(l => l.toLowerCase().includes(value.trim().toLowerCase())).slice(0, 8)
    : locations.slice(0, 8)

  // Close on outside click
  useEffect(() => {
    function handleClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false)
        setActiveIdx(-1)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function handleKeyDown(e) {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      setOpen(true)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx(i => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && activeIdx >= 0 && filtered[activeIdx]) {
      e.preventDefault()
      onChange(filtered[activeIdx])
      setOpen(false)
      setActiveIdx(-1)
    } else if (e.key === 'Escape') {
      setOpen(false)
      setActiveIdx(-1)
    }
  }

  async function handleUseMyLocation() {
    if (!navigator.geolocation) {
      setGeoError('Geolocation not supported by this browser.')
      return
    }
    setGeoLoading(true)
    setGeoError('')
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`,
            { headers: { 'Accept-Language': 'en' } }
          )
          const data = await res.json()
          const addr = data.address || {}
          // Pick the most specific area name available
          const area =
            addr.neighbourhood ||
            addr.suburb ||
            addr.quarter ||
            addr.city_district ||
            addr.town ||
            addr.city ||
            ''
          onChange(area)
        } catch {
          setGeoError('Could not detect your location. Please type it manually.')
        } finally {
          setGeoLoading(false)
        }
      },
      () => {
        setGeoError('Location access denied. Please type your location.')
        setGeoLoading(false)
      },
      { timeout: 8000 }
    )
  }

  return (
    <div className="flex flex-col gap-gutter-xs w-full" ref={containerRef}>
      <div className="flex items-center justify-between">
        <span className="font-label text-label-md text-on-surface">Location</span>
        <button
          type="button"
          onClick={handleUseMyLocation}
          disabled={geoLoading}
          className="inline-flex items-center gap-gutter-xs text-primary hover:text-zomato-red disabled:opacity-50 transition-colors duration-state-change ease-state-change"
        >
          <span className="material-symbols-outlined text-[14px]">
            {geoLoading ? 'pending' : 'my_location'}
          </span>
          <span className="font-label text-label-sm">
            {geoLoading ? 'Detecting…' : 'Use my location'}
          </span>
        </button>
      </div>

      <div className="relative">
        <span aria-hidden="true" className="material-symbols-outlined text-[20px] text-zomato-red absolute left-gutter-md top-1/2 -translate-y-1/2 pointer-events-none z-10">
          location_on
        </span>
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-controls="location-listbox"
          value={value}
          onChange={e => { onChange(e.target.value); setOpen(true); setActiveIdx(-1) }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="e.g. Koramangala, Indiranagar…"
          className="w-full pl-10 pr-10 py-gutter-md rounded-md border border-outline bg-surface font-body text-body-md text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none transition-colors duration-state-change ease-state-change"
        />
        {value && (
          <button
            type="button"
            onClick={() => { onChange(''); inputRef.current?.focus() }}
            aria-label="Clear location"
            className="absolute right-gutter-md top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        )}

        {/* Dropdown */}
        {open && filtered.length > 0 && (
          <ul
            id="location-listbox"
            ref={listRef}
            role="listbox"
            className="absolute z-50 w-full mt-1 rounded-md border border-outline bg-surface shadow-[0_8px_24px_rgba(28,28,30,0.10)] max-h-52 overflow-y-auto"
          >
            {filtered.map((loc, i) => (
              <li
                key={loc}
                role="option"
                aria-selected={i === activeIdx}
                onMouseDown={e => { e.preventDefault(); onChange(loc); setOpen(false); setActiveIdx(-1) }}
                onMouseEnter={() => setActiveIdx(i)}
                className={`flex items-center gap-gutter-sm px-gutter-md py-gutter-sm cursor-pointer font-body text-body-md transition-colors duration-state-change ease-state-change ${
                  i === activeIdx
                    ? 'bg-primary-container text-on-primary-container'
                    : 'text-on-surface hover:bg-surface-container-low'
                }`}
              >
                <span className="material-symbols-outlined text-[15px] text-zomato-red shrink-0" aria-hidden="true">
                  location_on
                </span>
                {loc}
              </li>
            ))}
          </ul>
        )}
      </div>

      {geoError && (
        <p className="font-body text-body-sm text-zomato-red">{geoError}</p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// PreferenceForm
// ---------------------------------------------------------------------------
export default function PreferenceForm({ onSubmit }) {
  const [location, setLocation] = useState('')
  const [locations, setLocations] = useState([])
  const [cuisines, setCuisines] = useState([])
  const [cuisineInput, setCuisineInput] = useState('')
  const [quickAddCuisines, setQuickAddCuisines] = useState([])
  const [specialtyCuisines, setSpecialtyCuisines] = useState([])
  const [budget, setBudget] = useState('')
  const [diningStyle, setDiningStyle] = useState('')
  const [minRating, setMinRating] = useState(0)
  const [notes, setNotes] = useState('')
  const inputRef = useRef(null)

  // Fetch locations + top cuisines from API on mount
  useEffect(() => {
    fetch('/api/locations')
      .then(r => r.json())
      .then(data => setLocations(data.locations || []))
      .catch(() => {})

    const opts = { cache: 'no-store' }

    fetch('/api/cuisines?limit=15&tier=popular', opts)
      .then(r => r.json())
      .then(data => setQuickAddCuisines(data.cuisines || []))
      .catch(() => {})

    fetch('/api/cuisines?tier=specialty', opts)
      .then(r => r.json())
      .then(data => setSpecialtyCuisines(data.cuisines || []))
      .catch(() => {})
  }, [])

  function addCuisine(label) {
    const clean = label.trim()
    if (!clean) return
    if (cuisines.map(c => c.toLowerCase()).includes(clean.toLowerCase())) return
    setCuisines(prev => [...prev, clean])
  }

  function removeCuisine(index) {
    setCuisines(prev => prev.filter((_, i) => i !== index))
  }

  function handleCuisineKeyDown(e) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addCuisine(cuisineInput.replace(',', ''))
      setCuisineInput('')
    }
    if (e.key === 'Backspace' && cuisineInput === '' && cuisines.length > 0) {
      removeCuisine(cuisines.length - 1)
    }
  }

  function handleClearAll() {
    setLocation('')
    setCuisines([])
    setCuisineInput('')
    setBudget('')
    setDiningStyle('')
    setMinRating(0)
    setNotes('')
  }

  function handleSubmit(e) {
    e.preventDefault()
    // Resolve dining style label → regex value for restaurant_type filter
    const selectedStyle = DINING_STYLES.find(s => s.label === diningStyle)
    onSubmit({
      location: location.trim() || null,
      cuisines: cuisines.length > 0 ? cuisines : null,
      budget: budget || null,
      restaurant_type: selectedStyle ? selectedStyle.value : null,
      min_rating: minRating > 0 ? minRating : null,
      additional_notes: notes.trim() || null,
    })
  }

  const quickAddVisible = quickAddCuisines.filter(
    c => !cuisines.map(x => x.toLowerCase()).includes(c.toLowerCase())
  )

  return (
    <main className="w-full max-w-md md:max-w-2xl flex flex-col gap-gutter-2xl">

      {/* Hero Header */}
      <header className="flex flex-col gap-gutter-sm pt-gutter-xs">
        <div className="flex items-center gap-gutter-sm">
          <span className="inline-flex items-center justify-center w-9 h-9 rounded-md bg-zomato-red text-on-primary shadow-sm" aria-hidden="true">
            <span className="material-symbols-outlined text-[20px]">restaurant</span>
          </span>
          <span className="font-label text-label-md text-primary uppercase tracking-wider">AI Dining Guide</span>
        </div>
        <h1 className="font-headline text-headline-lg-mobile md:text-headline-lg text-on-surface">
          Zomato AI Restaurant Recommender
        </h1>
        <p className="font-body text-body-lg text-on-surface-variant">
          Tell us what you&apos;re craving
        </p>
      </header>

      {/* Form Card */}
      <form
        onSubmit={handleSubmit}
        className="w-full rounded-lg bg-surface border border-outline p-gutter-lg md:p-gutter-2xl shadow-[0_4px_14px_rgba(28,28,30,0.06)] flex flex-col gap-gutter-xl"
      >

        {/* 1. Location — searchable dropdown + "Use my location" */}
        <LocationCombobox
          value={location}
          onChange={setLocation}
          locations={locations}
        />

        {/* 2. Cuisines multi-select */}
        <div className="flex flex-col gap-gutter-xs w-full">
          <label htmlFor="cuisine-input" className="font-label text-label-md text-on-surface">
            Cuisines
          </label>
          <div
            className="w-full min-h-[48px] px-gutter-md py-gutter-sm rounded-md border border-outline bg-surface focus-within:border-primary focus-within:ring-1 focus-within:ring-primary flex flex-wrap items-center gap-gutter-xs transition-colors duration-state-change ease-state-change cursor-text"
            onClick={() => inputRef.current?.focus()}
          >
            {cuisines.map((c, i) => (
              <span key={i} className="inline-flex items-center gap-gutter-xs pl-gutter-md pr-gutter-sm py-gutter-xs rounded-full bg-primary-container text-on-primary-container border border-primary/20">
                <span className="font-label text-label-md">{c}</span>
                <button
                  type="button"
                  onClick={() => removeCuisine(i)}
                  aria-label={`Remove ${c}`}
                  className="inline-flex items-center justify-center w-4 h-4 rounded-full hover:bg-primary/15 text-on-primary-container"
                >
                  <span className="material-symbols-outlined text-[14px]" aria-hidden="true">close</span>
                </button>
              </span>
            ))}
            <input
              id="cuisine-input"
              ref={inputRef}
              type="text"
              value={cuisineInput}
              onChange={e => setCuisineInput(e.target.value)}
              onKeyDown={handleCuisineKeyDown}
              placeholder={cuisines.length === 0 ? 'e.g. Italian, Chinese, North Indian' : ''}
              className="flex-1 min-w-[140px] border-0 bg-transparent p-gutter-xs font-body text-body-md text-on-surface placeholder:text-on-surface-variant focus:ring-0 focus:outline-none"
            />
          </div>
          {/* Popular quick-adds */}
          {quickAddVisible.filter(c => quickAddCuisines.includes(c)).length > 0 && (
            <div className="flex flex-wrap items-center gap-gutter-xs pt-gutter-xs">
              <span className="font-body text-body-sm text-on-surface-variant shrink-0">Popular:</span>
              {quickAddCuisines
                .filter(c => !cuisines.map(x => x.toLowerCase()).includes(c.toLowerCase()))
                .slice(0, 6)
                .map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => addCuisine(c)}
                    className="inline-flex items-center px-gutter-sm py-gutter-xs rounded-full border border-outline bg-surface-container-low text-on-surface-variant hover:border-primary hover:text-primary transition-colors duration-state-change ease-state-change"
                  >
                    <span className="font-label text-label-sm">+ {c}</span>
                  </button>
                ))}
            </div>
          )}

          {/* Specialty quick-adds */}
          {specialtyCuisines.filter(c => !cuisines.map(x => x.toLowerCase()).includes(c.toLowerCase())).length > 0 && (
            <div className="flex flex-wrap items-center gap-gutter-xs">
              <span className="font-body text-body-sm text-on-surface-variant shrink-0">Specialty:</span>
              {specialtyCuisines
                .filter(c => !cuisines.map(x => x.toLowerCase()).includes(c.toLowerCase()))
                .slice(0, 8)
                .map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => addCuisine(c)}
                    className="inline-flex items-center px-gutter-sm py-gutter-xs rounded-full border border-outline bg-amber-container text-on-amber-container hover:border-on-amber-container/50 transition-colors duration-state-change ease-state-change"
                  >
                    <span className="font-label text-label-sm">+ {c}</span>
                  </button>
                ))}
            </div>
          )}
        </div>

        {/* 3. Budget toggle */}
        <div className="flex flex-col gap-gutter-xs w-full">
          <span className="font-label text-label-md text-on-surface">Budget</span>
          <div role="radiogroup" aria-label="Budget" className="grid grid-cols-3 gap-gutter-sm">
            {['low', 'medium', 'high'].map(level => {
              const isSelected = budget === level
              return (
                <button
                  key={level}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() => setBudget(isSelected ? '' : level)}
                  className={
                    isSelected
                      ? 'inline-flex items-center justify-center px-gutter-md py-gutter-sm rounded-full border border-primary bg-primary text-on-primary transition-colors duration-state-change ease-state-change font-label text-label-md'
                      : 'inline-flex items-center justify-center px-gutter-md py-gutter-sm rounded-full border border-outline bg-surface text-on-surface-variant hover:border-outline-strong hover:text-on-surface transition-colors duration-state-change ease-state-change font-label text-label-md'
                  }
                >
                  {level.charAt(0).toUpperCase() + level.slice(1)}
                </button>
              )
            })}
          </div>
        </div>

        {/* 4. Dining Style toggle */}
        <div className="flex flex-col gap-gutter-xs w-full">
          <span className="font-label text-label-md text-on-surface">Dining Style</span>
          <div role="radiogroup" aria-label="Dining style" className="grid grid-cols-3 gap-gutter-sm">
            {DINING_STYLES.map(style => {
              const isSelected = diningStyle === style.label
              return (
                <button
                  key={style.label}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() => setDiningStyle(isSelected ? '' : style.label)}
                  className={
                    isSelected
                      ? 'inline-flex flex-col items-center justify-center gap-gutter-xs px-gutter-sm py-gutter-md rounded-md border border-primary bg-primary text-on-primary transition-colors duration-state-change ease-state-change'
                      : 'inline-flex flex-col items-center justify-center gap-gutter-xs px-gutter-sm py-gutter-md rounded-md border border-outline bg-surface text-on-surface-variant hover:border-outline-strong hover:text-on-surface transition-colors duration-state-change ease-state-change'
                  }
                >
                  <span className="material-symbols-outlined text-[20px]" aria-hidden="true">{style.icon}</span>
                  <span className="font-label text-label-sm text-center leading-tight">{style.label}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* 5. Minimum Rating slider */}
        <div className="flex flex-col gap-gutter-sm w-full">
          <div className="flex items-center justify-between">
            <label htmlFor="rating-slider" className="font-label text-label-md text-on-surface">
              Minimum Rating
            </label>
            <div className="inline-flex items-center gap-gutter-xs px-gutter-sm py-gutter-xs rounded-sm bg-amber-container text-on-amber-container">
              <StarDisplay value={minRating} />
              <span className="font-mono text-mono-sm text-on-amber-container tabular-nums">
                {minRating === 0 ? 'Any' : `${minRating.toFixed(1)}+`}
              </span>
            </div>
          </div>
          <input
            id="rating-slider"
            type="range"
            min="0"
            max="5"
            step="0.5"
            value={minRating}
            onChange={e => setMinRating(parseFloat(e.target.value))}
            className="w-full h-2 rounded-full bg-surface-container accent-primary cursor-pointer"
          />
          <div className="flex items-center justify-between text-on-surface-variant">
            <span className="font-label text-label-sm tabular-nums">0.0</span>
            <span className="font-label text-label-sm tabular-nums">2.5</span>
            <span className="font-label text-label-sm tabular-nums">5.0</span>
          </div>
        </div>

        {/* 6. Additional Notes */}
        <label className="flex flex-col gap-gutter-xs w-full">
          <span className="font-label text-label-md text-on-surface">Additional Notes</span>
          <textarea
            rows={3}
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="e.g. family friendly, outdoor seating, near metro"
            className="w-full px-gutter-lg py-gutter-md rounded-md border border-outline bg-surface font-body text-body-md text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none resize-y transition-colors duration-state-change ease-state-change"
          />
        </label>

        {/* CTA */}
        <div className="flex flex-col items-center gap-gutter-md pt-gutter-xs">
          <button
            type="submit"
            className="w-full inline-flex items-center justify-center gap-gutter-sm px-gutter-2xl py-gutter-md rounded-md bg-primary text-on-primary shadow-md hover:bg-zomato-red active:scale-[0.99] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary transition-colors duration-state-change ease-state-change font-label text-label-lg"
          >
            Find Restaurants 🍽️
          </button>
          <button
            type="button"
            onClick={handleClearAll}
            className="inline-flex items-center justify-center px-gutter-md py-gutter-xs rounded-sm bg-transparent text-on-surface-variant hover:text-primary transition-colors duration-state-change ease-state-change font-label text-label-md underline underline-offset-4"
          >
            Clear all
          </button>
        </div>

      </form>
    </main>
  )
}
