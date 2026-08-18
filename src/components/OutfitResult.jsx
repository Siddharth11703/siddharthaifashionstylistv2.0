import { useState } from 'react';

const asList = (value) => {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string') {
    return value
      .split(/\n|,|;/)
      .map((item) => item.replace(/^[-*\d.)\s]+/, '').trim())
      .filter(Boolean);
  }
  return [];
};

export default function OutfitResult({ result, onSave, user }) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [activeTab, setActiveTab] = useState('outfit');

  const { photoAnalysis, outfitRecommendation = {}, generatedImageUrl } = result;
  const colorPalette = asList(outfitRecommendation.colorPalette);
  const keyPieces = asList(outfitRecommendation.keyPieces);
  const stylingTips = asList(outfitRecommendation.stylingTips);
  const occasions = asList(outfitRecommendation.occasions);

  const handleImageError = (e) => {
    // Clear further error handling to avoid infinite loop
    if (e?.target) e.target.onerror = null;
    // Use the backend proxy for the fallback so the browser does not request Pollinations directly
    const fallbackPrompt = encodeURIComponent(outfitRecommendation.imagePrompt || outfitRecommendation.outfitDescription || 'professional fashion outfit portrait');
    const fallbackUrl = `/api/proxy-image?prompt=${fallbackPrompt}&width=768&height=1024`;
    e.target.src = fallbackUrl;
    setImageError(true);
  };

  return (
    <div className="fade-in-up space-y-6">
      {/* Header */}
      <div className="text-center">
        <div className="inline-flex items-center gap-2 bg-green-500/15 border border-green-500/30 text-green-400 px-4 py-1.5 rounded-full text-sm font-medium mb-3">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
          Outfit Generated
        </div>
        <h2 className="text-2xl font-bold text-white">{outfitRecommendation.outfitName || 'Personalized Outfit'}</h2>
        <p className="text-white/40 text-sm mt-1">Personalized for your appearance and preferences</p>
      </div>

      {/* Tabs */}
      <>
          <div className="flex gap-1 glass rounded-xl p-1 mb-4">
            {[{ id: 'outfit', label: 'Outfit Look' }, { id: 'details', label: 'Outfit Details' }, { id: 'analysis', label: 'Your Profile' }].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all ${
                  activeTab === tab.id ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg' : 'text-white/50 hover:text-white/80'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          
      <div className="space-y-4">
        {/* 'Outfit Look' Tab Content (No Explanation) */}
        {activeTab === 'outfit' && (
          <>
            {/* Image Section */}
            <div className="rounded-2xl overflow-hidden glass border border-white/10 mb-6">
              {generatedImageUrl && !imageError ? (
                <div className="relative">
                  {!imageLoaded && (
                    <div className="w-full h-96 flex flex-col items-center justify-center gap-3 bg-white/5">
                      <div className="w-10 h-10 border-2 border-purple-500/40 border-t-purple-400 rounded-full animate-spin" />
                      <p className="text-white/40 text-sm">Generating your look...</p>
                    </div>
                  )}
                  <img 
                    src={generatedImageUrl} 
                    alt={outfitRecommendation.outfitName || 'AI generated outfit'} 
                    onLoad={() => setImageLoaded(true)} 
                    onError={handleImageError}
                    className={`w-full h-96 object-cover transition-opacity ${imageLoaded ? 'opacity-100' : 'opacity-0'}`} 
                  />
                </div>
              ) : (
                <div className="w-full h-96 flex items-center justify-center bg-white/5">
                  <p className="text-white/40">No image available</p>
                </div>
              )}
            </div>
            {/* Look Description Card */}
            <div className="look-summary-card p-6 rounded-2xl glass border border-white/10 mb-4">
              <p className="description-text leading-relaxed text-sm">
                {/* Fallback regex if backend dumps raw JSON */}
                {outfitRecommendation.outfitDescription?.includes('{"outfitName"') 
                  ? outfitRecommendation.outfitDescription.match(/"outfitDescription"\s*:\s*"([^"]+)"/)?.[1] || "Stylish modern outfit tailored to your preferences."
                  : outfitRecommendation.outfitDescription}
              </p>
            </div>
          </>
        )}

        {/* 'Outfit Details' Tab Content (Full details including Explanation) */}
        {activeTab === 'details' && (
          <div className="look-summary-card">
            <div className="summary-header">
              <h2>{outfitRecommendation.outfitName?.includes('{"outfitName"') ? "Your Curated Look" : outfitRecommendation.outfitName}</h2>
              {occasions.length > 0 && (
                <div className="occasion-badges">
                  {occasions.map(occ => <span key={occ} className="badge">{occ}</span>)}
                </div>
              )}
            </div>

            <div className="summary-section">
              <p className="description-text">
                {/* Fallback regex if backend dumps raw JSON */}
                {outfitRecommendation.outfitDescription?.includes('{"outfitName"') 
                  ? outfitRecommendation.outfitDescription.match(/"outfitDescription"\s*:\s*"([^"]+)"/)?.[1] || "Stylish modern outfit tailored to your preferences."
                  : outfitRecommendation.outfitDescription}
              </p>
            </div>

            <div className="summary-section">
              <h3>Color Palette</h3>
              <div className="color-swatches">
                {colorPalette.map(c => <span key={c} className="swatch">{c}</span>)}
              </div>
            </div>

            <div className="summary-grid">
              <div className="summary-section lists">
                <h3>The Pieces</h3>
                <ul className="styled-list">
                  {keyPieces.length > 0 ? keyPieces.map(p => <li key={p}>{p}</li>) : <li className="text-white/50">Pieces loading...</li>}
                </ul>
              </div>

              <div className="summary-section lists">
                <h3>Styling Tips</h3>
                <ul className="styled-list">
                  {stylingTips.length > 0 ? stylingTips.map(t => <li key={t}>{t}</li>) : <li className="text-white/50">Tips loading...</li>}
                </ul>
              </div>
            </div>

            <div className="summary-section rationale">
              <h3>Why it works for you</h3>
              <p className="why-text">
                 {outfitRecommendation.explanation?.includes('{"outfitName"')
                  ? outfitRecommendation.outfitDescription.match(/"explanation"\s*:\s*"([^"]+)"/)?.[1] || "Designed based on your profile inputs."
                  : outfitRecommendation.explanation}
              </p>
            </div>
          </div>
        )}

    
        {activeTab === 'analysis' && (
          <div className="profile-analysis-card p-5 rounded-2xl glass border border-white/10">
            <h3 className="text-white font-semibold mb-2">Your Profile</h3>
            <p className="text-white/70 leading-relaxed text-sm">Here is what our AI detected from your photo:</p>
            <div className="analysis-text-wrapper mt-3">
              <p className="whitespace-pre-line text-white/50 text-xs">
                {typeof photoAnalysis === 'string' ? photoAnalysis : JSON.stringify(photoAnalysis, null, 2)}
              </p>
            </div>
          </div>
        )}
      </div>
    </>
  </div>
  );
}

