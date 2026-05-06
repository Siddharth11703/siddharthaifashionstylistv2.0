const BUDGETS = [
  { value: 'budget', label: 'Budget', range: 'Under ₹2,000', icon: '💰' },
  { value: 'mid', label: 'Mid-range', range: '₹2,000 – ₹8,000', icon: '💳' },
  { value: 'premium', label: 'Premium', range: '₹8,000 – ₹25,000', icon: '✨' },
  { value: 'luxury', label: 'Luxury', range: '₹25,000+', icon: '👑' },
];

// Stick figure SVGs matching the reference image (head + body + arms + legs)
const HEIGHTS = [
  {
    value: 'short',
    label: 'Short',
    range: 'Under 5\'4"',
    figure: (
      <svg viewBox="0 0 50 80" className="w-10 h-16 fill-current" xmlns="http://www.w3.org/2000/svg">
        {/* Head */}
        <circle cx="25" cy="10" r="7" />
        {/* Body */}
        <line x1="25" y1="17" x2="25" y2="48" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
        {/* Arms */}
        <line x1="25" y1="25" x2="10" y2="36" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
        <line x1="25" y1="25" x2="40" y2="36" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
        {/* Legs */}
        <line x1="25" y1="48" x2="14" y2="65" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
        <line x1="25" y1="48" x2="36" y2="65" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    value: 'medium',
    label: 'Medium',
    range: '5\'4" – 5\'9"',
    figure: (
      <svg viewBox="0 0 50 90" className="w-10 h-[4.5rem] fill-current" xmlns="http://www.w3.org/2000/svg">
        <circle cx="25" cy="9" r="7" />
        <line x1="25" y1="16" x2="25" y2="52" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
        <line x1="25" y1="24" x2="9" y2="37" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
        <line x1="25" y1="24" x2="41" y2="37" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
        <line x1="25" y1="52" x2="13" y2="74" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
        <line x1="25" y1="52" x2="37" y2="74" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    value: 'tall',
    label: 'Tall',
    range: 'Above 5\'9"',
    figure: (
      <svg viewBox="0 0 50 100" className="w-10 h-20 fill-current" xmlns="http://www.w3.org/2000/svg">
        <circle cx="25" cy="9" r="7" />
        <line x1="25" y1="16" x2="25" y2="58" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
        <line x1="25" y1="25" x2="8" y2="40" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
        <line x1="25" y1="25" x2="42" y2="40" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
        <line x1="25" y1="58" x2="12" y2="84" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
        <line x1="25" y1="58" x2="38" y2="84" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
      </svg>
    ),
  },
];

const AGE_GROUPS = [
  { value: 'teen', label: 'Teen', range: '13–19' },
  { value: 'young_adult', label: 'Young Adult', range: '20–30' },
  { value: 'adult', label: 'Adult', range: '31–45' },
  { value: 'middle_age', label: 'Middle Age', range: '46–60' },
  { value: 'senior', label: 'Senior', range: '60+' },
];

// Body type figures using proper SVG silhouettes
const BODY_TYPES = [
  {
    value: 'slim',
    label: 'Slim',
    desc: 'Lean & slender',
    figure: (
      <svg viewBox="0 0 44 72" className="w-9 h-14 fill-current" xmlns="http://www.w3.org/2000/svg">
        <circle cx="22" cy="7" r="6" />
        {/* Slim torso - narrow throughout */}
        <path d="M16 14 Q12 22 13 34 Q14 42 13 50 L19 50 L19 34 L25 34 L25 50 L31 50 Q30 42 31 34 Q32 22 28 14 Q25 12 19 12 Z" />
        {/* Legs */}
        <path d="M13 50 L11 68 L16 68 L19 52 L25 52 L28 68 L33 68 L31 50 Z" />
      </svg>
    ),
  },
  {
    value: 'athletic',
    label: 'Athletic',
    desc: 'Muscular & toned',
    figure: (
      <svg viewBox="0 0 44 72" className="w-9 h-14 fill-current" xmlns="http://www.w3.org/2000/svg">
        <circle cx="22" cy="7" r="6" />
        {/* Athletic torso - broad shoulders, tapered waist */}
        <path d="M11 14 Q7 22 10 34 Q12 40 11 50 L18 50 L19 34 L25 34 L26 50 L33 50 Q32 40 34 34 Q37 22 33 14 Q27 11 17 11 Z" />
        <path d="M11 50 L9 68 L15 68 L19 52 L25 52 L29 68 L35 68 L33 50 Z" />
      </svg>
    ),
  },
  {
    value: 'average',
    label: 'Average',
    desc: 'Balanced build',
    figure: (
      <svg viewBox="0 0 44 72" className="w-9 h-14 fill-current" xmlns="http://www.w3.org/2000/svg">
        <circle cx="22" cy="7" r="6" />
        <path d="M13 14 Q9 23 11 34 Q13 41 12 50 L19 50 L19 34 L25 34 L25 50 L32 50 Q31 41 33 34 Q35 23 31 14 Q26 12 18 12 Z" />
        <path d="M12 50 L10 68 L16 68 L19 52 L25 52 L28 68 L34 68 L32 50 Z" />
      </svg>
    ),
  },
  {
    value: 'plus',
    label: 'Plus Size',
    desc: 'Fuller figure',
    figure: (
      <svg viewBox="0 0 44 72" className="w-9 h-14 fill-current" xmlns="http://www.w3.org/2000/svg">
        <circle cx="22" cy="7" r="7" />
        {/* Plus size torso - wide throughout */}
        <path d="M9 14 Q4 24 7 36 Q9 44 8 50 L18 52 L18 36 L26 36 L26 52 L36 50 Q35 44 37 36 Q40 24 35 14 Q28 10 16 10 Z" />
        <path d="M8 50 L6 68 L15 68 L18 54 L26 54 L29 68 L38 68 L36 50 Z" />
      </svg>
    ),
  },
  {
    value: 'pear',
    label: 'Pear Shape',
    desc: 'Wider hips',
    figure: (
      <svg viewBox="0 0 44 72" className="w-9 h-14 fill-current" xmlns="http://www.w3.org/2000/svg">
        <circle cx="22" cy="7" r="6" />
        {/* Pear: narrow top, wide bottom */}
        <path d="M15 14 Q12 22 11 30 Q8 40 7 50 L18 52 L19 32 L25 32 L26 52 L37 50 Q36 40 33 30 Q32 22 29 14 Q25 12 19 12 Z" />
        <path d="M7 50 L5 68 L15 68 L19 54 L25 54 L29 68 L39 68 L37 50 Z" />
      </svg>
    ),
  },
  {
    value: 'hourglass',
    label: 'Hourglass',
    desc: 'Defined waist',
    figure: (
      <svg viewBox="0 0 44 72" className="w-9 h-14 fill-current" xmlns="http://www.w3.org/2000/svg">
        <circle cx="22" cy="7" r="6" />
        {/* Hourglass: wide top, nipped waist, wide hips */}
        <path d="M11 14 Q8 20 14 27 Q18 31 18 34 Q18 37 12 42 L10 50 L18 52 L19 38 L25 38 L26 52 L34 50 L32 42 Q26 37 26 34 Q26 31 30 27 Q36 20 33 14 Q27 11 17 11 Z" />
        <path d="M10 50 L8 68 L16 68 L19 54 L25 54 L28 68 L36 68 L34 50 Z" />
      </svg>
    ),
  },
];

function SelectCard({ selected, onClick, children, className = '' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`selection-btn border rounded-xl p-3 text-left transition-all ${
        selected
          ? 'selected border-purple-400 bg-purple-500/15'
          : 'border-white/10 bg-white/5 hover:border-purple-400/40 hover:bg-white/8'
      } ${className}`}
    >
      {children}
    </button>
  );
}

export default function SelectionForm({ values, onChange }) {
  const set = (key, val) => onChange({ ...values, [key]: val });

  return (
    <div className="space-y-8">
      {/* Occasion - Free text input */}
      <div>
        <h3 className="text-white font-semibold text-base mb-3 flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-xs text-purple-400 font-bold">1</span>
          Occasion
        </h3>
        <div className="relative">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xl pointer-events-none">🎯</span>
          <input
            type="text"
            value={values.occasion}
            onChange={(e) => set('occasion', e.target.value)}
            placeholder="e.g. Office party, Beach vacation, Wedding guest..."
            className="w-full bg-white/5 border border-white/10 rounded-xl pl-11 pr-4 py-3.5 text-white placeholder-white/30 focus:outline-none focus:border-purple-400/60 focus:bg-purple-500/8 transition-all text-sm"
          />
        </div>
        <p className="text-white/30 text-xs mt-1.5 ml-1">Describe the occasion in your own words</p>
      </div>

      {/* Budget */}
      <div>
        <h3 className="text-white font-semibold text-base mb-3 flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-xs text-purple-400 font-bold">2</span>
          Budget
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {BUDGETS.map((b) => (
            <SelectCard key={b.value} selected={values.budget === b.value} onClick={() => set('budget', b.value)}>
              <div className="text-2xl mb-1">{b.icon}</div>
              <div className="text-white text-sm font-medium">{b.label}</div>
              <div className="text-white/40 text-xs mt-0.5">{b.range}</div>
            </SelectCard>
          ))}
        </div>
      </div>

      {/* Height */}
      <div>
        <h3 className="text-white font-semibold text-base mb-3 flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-xs text-purple-400 font-bold">3</span>
          Height
        </h3>
        <p className="text-white/40 text-xs mb-3">Select your approximate height</p>
        <div className="grid grid-cols-3 gap-3">
          {HEIGHTS.map((h) => (
            <SelectCard
              key={h.value}
              selected={values.height === h.value}
              onClick={() => set('height', h.value)}
              className="flex flex-col items-center text-center py-5"
            >
              <div className={`${values.height === h.value ? 'text-purple-400' : 'text-white/40'} transition-colors mb-3 flex items-end justify-center`}
                style={{ height: '5rem' }}>
                {h.figure}
              </div>
              <div className="text-white text-sm font-bold">{h.label}</div>
              <div className="text-white/40 text-xs mt-1">{h.range}</div>
            </SelectCard>
          ))}
        </div>
      </div>

      {/* Age */}
      <div>
        <h3 className="text-white font-semibold text-base mb-3 flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-xs text-purple-400 font-bold">4</span>
          Age Group
        </h3>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          {AGE_GROUPS.map((a) => (
            <SelectCard key={a.value} selected={values.age === a.value} onClick={() => set('age', a.value)} className="text-center">
              <div className="text-white text-sm font-medium">{a.label}</div>
              <div className="text-white/40 text-xs mt-0.5">{a.range}</div>
            </SelectCard>
          ))}
        </div>
      </div>

      {/* Body Type */}
      <div>
        <h3 className="text-white font-semibold text-base mb-3 flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-xs text-purple-400 font-bold">5</span>
          Body Type
        </h3>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {BODY_TYPES.map((bt) => (
            <SelectCard
              key={bt.value}
              selected={values.bodyType === bt.value}
              onClick={() => set('bodyType', bt.value)}
              className="flex flex-col items-center text-center py-4"
            >
              <div className={`${values.bodyType === bt.value ? 'text-purple-400' : 'text-white/35'} transition-colors mb-2 flex items-end justify-center`}
                style={{ height: '3.5rem' }}>
                {bt.figure}
              </div>
              <div className="text-white text-xs font-semibold">{bt.label}</div>
              <div className="text-white/40 text-xs mt-0.5 leading-tight">{bt.desc}</div>
            </SelectCard>
          ))}
        </div>
      </div>
    </div>
  );
}
