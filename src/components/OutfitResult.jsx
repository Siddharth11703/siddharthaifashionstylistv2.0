import { useState } from 'react';

export default function OutfitResult({ result, onSave, user }) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [activeTab, setActiveTab] = useState('outfit');

  const { photoAnalysis, outfitRecommendation, generatedImageUrl } = result;

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
        <h2 className="text-2xl font-bold text-white">{outfitRecommendation.outfitName}</h2>
        <p className="text-white/40 text-sm mt-1">Personalized for your appearance</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 glass rounded-xl p-1">
        {[
          { id: 'outfit', label: 'Outfit Look' },
          { id: 'analysis', label: 'Your Profile' },
          
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all ${
              activeTab === tab.id
                ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg'
                : 'text-white/50 hover:text-white/80'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Outfit Tab */}
      {activeTab === 'outfit' && (
        <div className="space-y-4">
          {/* Generated Image */}
          <div className="rounded-2xl overflow-hidden glass border border-white/10">
            {generatedImageUrl && !imageError ? (
              <div className="relative">
                {!imageLoaded && (
                  <div className="w-full h-96 flex flex-col items-center justify-center gap-3 bg-white/5">
                    <div className="w-10 h-10 border-2 border-purple-500/40 border-t-purple-400 rounded-full animate-spin" />
                    <p className="text-white/40 text-sm">Generating your look...</p>
                    <p className="text-white/25 text-xs">This may take up to 30 seconds</p>
                  </div>
                )}
                {console.log('Image URL:', generatedImageUrl)}
                <img
                  src={generatedImageUrl}
                  alt="AI generated outfit"
                  className={`w-full object-cover rounded-2xl transition-opacity duration-700 ${imageLoaded ? 'opacity-100' : 'opacity-0 h-0'}`}
                  onLoad={() => setImageLoaded(true)}
                  onError={(e) => {
                    e.target.onError = null;
                    e.target.src = `https://image.pollinations.ai/prompt/${encodeURIComponent(generatedImageUrl?.split('/prompt/')[1]?.split('?')[0] || 'professional outfit')}?width=768&height=1024&model=flux&nologo=true&enhance=true&cachebust=${Date.now()}`;
                    setImageError(true);
                  }}
                />
                {imageLoaded && (
                  <div className="absolute top-3 left-3 bg-black/50 backdrop-blur-sm text-white text-xs px-2.5 py-1 rounded-full border border-white/20 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                    AI Generated · Styled for you
                  </div>
                )}
              </div>
            ) : (
              <div className="h-60 flex flex-col items-center justify-center gap-3 text-white/40">
                <svg className="w-12 h-12 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14" />
                </svg>
                <p className="text-sm">Image could not be loaded</p>
              </div>
            )}
          </div>

          {/* Outfit Description */}
          <div className="glass rounded-xl p-4 space-y-3">
            <h4 className="text-white/60 text-xs uppercase tracking-wider font-medium">Outfit Details</h4>
            <p className="text-white/85 text-sm leading-relaxed">{outfitRecommendation.outfitDescription}</p>
          </div>

          {/* Color Palette */}
          <div className="glass rounded-xl p-4">
            <h4 className="text-white/60 text-xs uppercase tracking-wider font-medium mb-2">Color Palette & Why It Works</h4>
            <p className="text-white/85 text-sm leading-relaxed">{outfitRecommendation.colorPalette}</p>
          </div>
        </div>
      )}

      {/* Profile Tab */}
      {activeTab === 'analysis' && (
        <div className="space-y-4">
          <div className="glass rounded-xl p-4 space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
                <span className="text-sm">🎨</span>
              </div>
              <h4 className="text-white font-semibold">Your Detected Profile</h4>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white/5 rounded-lg p-3">
                <p className="text-white/40 text-xs mb-1">Skin Tone</p>
                <p className="text-white font-medium capitalize">{photoAnalysis.skinTone}</p>
              </div>
              <div className="bg-white/5 rounded-lg p-3">
                <p className="text-white/40 text-xs mb-1">Gender</p>
                <p className="text-white font-medium capitalize">{photoAnalysis.gender}</p>
              </div>
              {photoAnalysis.ethnicAppearance && (
                <div className="bg-white/5 rounded-lg p-3">
                  <p className="text-white/40 text-xs mb-1">Ethnic Look</p>
                  <p className="text-white font-medium">{photoAnalysis.ethnicAppearance}</p>
                </div>
              )}
              {photoAnalysis.hairDescription && (
                <div className="bg-white/5 rounded-lg p-3">
                  <p className="text-white/40 text-xs mb-1">Hair</p>
                  <p className="text-white font-medium capitalize">{photoAnalysis.hairDescription}</p>
                </div>
              )}
            </div>
            {photoAnalysis.faceDescription && (
              <div className="bg-white/5 rounded-lg p-3">
                <p className="text-white/40 text-xs mb-1">Face Features</p>
                <p className="text-white/85 text-sm">{photoAnalysis.faceDescription}</p>
              </div>
            )}
            <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-3">
              <p className="text-purple-300 text-xs mb-1">How this shaped your outfit</p>
              <p className="text-white/70 text-sm leading-relaxed">{photoAnalysis.appearanceDescription}</p>
            </div>
          </div>

          {/* Explanation */}
          <div className="glass rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-purple-500/20 border border-purple-500/30 flex items-center justify-center">
                <span className="text-sm">💡</span>
              </div>
              <h4 className="text-white font-semibold">Why This Outfit</h4>
            </div>
            <p className="text-white/80 text-sm leading-relaxed">{outfitRecommendation.explanation}</p>
          </div>
        </div>
      )}

      {/* Tips Tab */}
      {activeTab === 'tips' && (
        <div className="glass rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-pink-500/20 border border-pink-500/30 flex items-center justify-center">
              <span className="text-sm">✨</span>
            </div>
            <h4 className="text-white font-semibold">Personalized Styling Tips</h4>
          </div>
          <div className="space-y-3">
            {outfitRecommendation.stylingTips?.split(/\d\.|\n/).filter(t => t.trim()).map((tip, i) => (
              <div key={i} className="flex gap-3">
                <div className="w-5 h-5 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white text-xs flex-shrink-0 mt-0.5">
                  {i + 1}
                </div>
                <p className="text-white/80 text-sm leading-relaxed">{tip.trim()}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Save Button */}
      <button
        onClick={onSave}
        className="w-full py-4 rounded-2xl btn-primary text-white font-semibold text-base flex items-center justify-center gap-2 shadow-lg"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
        </svg>
        Save This Outfit
      </button>
    </div>
  );
}
