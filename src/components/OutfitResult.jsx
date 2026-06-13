import { useState } from 'react';

export default function OutfitResult({ result, onSave, user }) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [activeTab, setActiveTab] = useState('outfit');

  const { photoAnalysis, outfitRecommendation, generatedImageUrl } = result;

  const handleImageError = (e) => {
    // Clear further error handling to avoid infinite loop
    if (e?.target) e.target.onerror = null;
    // Use the backend proxy for the fallback so the browser does not request Pollinations directly
    const fallbackPrompt = 'professional business outfit portrait';
    const fallbackUrl = `/api/proxy-image?prompt=${encodeURIComponent(fallbackPrompt)}&width=768&height=1024`;
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
                  alt="AI generated outfit"
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

          {/* ... rest of component (analysis tab, buttons) unchanged ... */}
        </div>
      )}
    </div>
  );
}
