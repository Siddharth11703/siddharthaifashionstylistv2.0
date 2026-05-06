import { useState, useEffect } from 'react';

export default function SavedOutfits({ user, onBack }) {
  const [outfits, setOutfits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(null);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    fetchOutfits();
  }, [user.id]);

  const fetchOutfits = async () => {
    try {
      const res = await fetch(`/api/users/outfits/${user.id}`);
      const data = await res.json();
      if (data.success) setOutfits(data.outfits);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const deleteOutfit = async (outfitId) => {
    if (!confirm('Delete this outfit?')) return;
    setDeleting(outfitId);
    try {
      await fetch(`/api/users/outfits/${outfitId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      });
      setOutfits(o => o.filter(x => x.id !== outfitId));
      if (selected?.id === outfitId) setSelected(null);
    } catch (err) {
      console.error(err);
    } finally {
      setDeleting(null);
    }
  };

  const formatDate = (dateStr) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0f0f0f] via-[#1a0a2e] to-[#0f0f0f]">
      {/* Header */}
      <div className="border-b border-white/10 glass-dark sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center gap-4">
          <button
            onClick={onBack}
            className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/15 transition-colors flex items-center justify-center"
          >
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-white font-bold text-xl">My Saved Outfits</h1>
            <p className="text-white/40 text-xs">{user.name} · {outfits.length} outfit{outfits.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-8">
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="shimmer rounded-2xl h-64" />
            ))}
          </div>
        ) : outfits.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <div className="w-20 h-20 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
              <svg className="w-10 h-10 text-white/20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
              </svg>
            </div>
            <div className="text-center">
              <p className="text-white/60 font-medium">No saved outfits yet</p>
              <p className="text-white/30 text-sm mt-1">Generate an outfit and save it to see it here</p>
            </div>
            <button
              onClick={onBack}
              className="mt-2 px-6 py-2.5 rounded-xl btn-primary text-white font-medium text-sm"
            >
              Get Started
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {outfits.map((outfit) => (
              <div
                key={outfit.id}
                className="glass rounded-2xl overflow-hidden card-hover border border-white/10 cursor-pointer group"
                onClick={() => setSelected(outfit)}
              >
                {/* Image */}
                <div className="relative h-48 bg-gradient-to-br from-purple-900/30 to-pink-900/30">
                  {outfit.outfit_image_url ? (
                    <img
                      src={outfit.outfit_image_url}
                      alt="Outfit"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <span className="text-4xl">👗</span>
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />

                  {/* Delete btn */}
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteOutfit(outfit.id); }}
                    disabled={deleting === outfit.id}
                    className="absolute top-2 right-2 w-7 h-7 rounded-lg bg-red-500/0 hover:bg-red-500/80 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center"
                  >
                    <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>

                {/* Info */}
                <div className="p-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-white/60 text-xs capitalize px-2 py-0.5 bg-white/10 rounded-full">
                      {outfit.occasion}
                    </span>
                    <span className="text-white/40 text-xs">{formatDate(outfit.created_at)}</span>
                  </div>
                  <p className="text-white text-sm font-medium line-clamp-2 leading-snug">
                    {outfit.outfit_description?.substring(0, 80)}...
                  </p>
                  <div className="flex gap-1 flex-wrap pt-1">
                    {outfit.body_type && (
                      <span className="text-white/40 text-xs">{outfit.body_type}</span>
                    )}
                    {outfit.height && (
                      <span className="text-white/40 text-xs">· {outfit.height}</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Outfit Detail Modal */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setSelected(null)} />
          <div className="relative w-full max-w-2xl glass-dark rounded-2xl overflow-hidden shadow-2xl max-h-[90vh] overflow-y-auto">
            {selected.outfit_image_url && (
              <img src={selected.outfit_image_url} alt="Outfit" className="w-full h-72 object-cover" />
            )}
            <div className="p-6 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex gap-2 mb-2 flex-wrap">
                    {selected.occasion && <span className="text-purple-400 text-xs bg-purple-500/15 border border-purple-500/30 px-2 py-0.5 rounded-full capitalize">{selected.occasion}</span>}
                    {selected.budget && <span className="text-blue-400 text-xs bg-blue-500/15 border border-blue-500/30 px-2 py-0.5 rounded-full capitalize">{selected.budget}</span>}
                    {selected.skin_tone && <span className="text-amber-400 text-xs bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 rounded-full capitalize">{selected.skin_tone} skin</span>}
                  </div>
                  <p className="text-white/40 text-xs">{formatDate(selected.created_at)}</p>
                </div>
                <button onClick={() => setSelected(null)} className="w-8 h-8 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0">
                  <svg className="w-4 h-4 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div>
                <h4 className="text-white/50 text-xs uppercase tracking-wider mb-2">Outfit Description</h4>
                <p className="text-white/80 text-sm leading-relaxed">{selected.outfit_description}</p>
              </div>

              {selected.outfit_explanation && (
                <div>
                  <h4 className="text-white/50 text-xs uppercase tracking-wider mb-2">Why This Outfit</h4>
                  <p className="text-white/70 text-sm leading-relaxed">{selected.outfit_explanation}</p>
                </div>
              )}

              <div className="grid grid-cols-3 gap-2 pt-2">
                {[
                  { label: 'Height', value: selected.height },
                  { label: 'Age Group', value: selected.age?.replace('_', ' ') },
                  { label: 'Body Type', value: selected.body_type },
                ].map((item) => item.value && (
                  <div key={item.label} className="bg-white/5 rounded-xl p-3 text-center">
                    <p className="text-white/40 text-xs">{item.label}</p>
                    <p className="text-white text-sm font-medium capitalize mt-0.5">{item.value}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
