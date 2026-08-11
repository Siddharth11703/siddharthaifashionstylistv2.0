import { useState } from 'react';

export default function OutfitResult({ result, onSave, user }) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [activeTab, setActiveTab] = useState('outfit');
  const [lowResWarning, setLowResWarning] = useState(false);

  const { photoAnalysis, outfitRecommendation, generatedImageUrl, generatedImageSrcSet } = result;

  // onLoad will receive the event; check natural size vs display * DPR
  const handleImageLoad = (e) => {
    setImageLoaded(true);
    try {
      const img = e.target;
      const naturalWidth = img.naturalWidth || 0;
      const displayWidth = img.clientWidth || img.getBoundingClientRect().width || 0;
      const dpr = window.devicePixelRatio || 1;
      // require a 1.3x buffer for good sharpness on high-DPI screens
      if (naturalWidth < Math.round(displayWidth * dpr * 1.3)) {
        setLowResWarning(true);
      } else {
        setLowResWarning(false);
      }
    } catch (err) {
      // ignore
    }
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
                <img
                  src={generatedImageUrl}
                  srcSet={generatedImageSrcSet || undefined}
                  sizes="(max-width: 768px) 100vw, 768px"
                  alt="AI generated outfit"
                  className={`w-full object-contain rounded-2xl transition-opacity duration-700 ${imageLoaded ? 'opacity-100' : 'opacity-0 h-0'}`}
                  style={{ maxHeight: '820px', imageRendering: '-webkit-optimize-contrast' }}
                  onLoad={handleImageLoad}
                  onError={() => setImageError(true)}
                />
                {imageLoaded && (
                  <div className="absolute top-3 left-3 bg-black/50 backdrop-blur-sm text-white text-xs px-2.5 py-1 rounded-full border border-white/20 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                    AI Generated · Styled for you
                  </div>
                )}

                {lowResWarning && (
                  <div className="absolute bottom-3 left-3 bg-yellow-500/10 border border-yellow-500/20 text-yellow-300 text-xs px-3 py-1 rounded-full">
                    Image may be low resolution on your screen. Try regenerating at higher quality.
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify p-8 bg-gray-800/50 rounded-lg border border-gray-700 text-center min-h-[400px]">
                <svg className="w-12 h-12 text-pink-500 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <h3 className="text-lg font-semibold text-white mb-2">Image Generation Blocked</h3>
                <p className="text-gray-400 text-sm max-w-sm">
                   Your outfit recommendation is ready below, but the visual could not be generated due to automated safety filters falsely flagging the fashion description.
                </p>
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
