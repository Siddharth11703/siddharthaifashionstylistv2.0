import { useCallback, useEffect, useRef, useState } from 'react';

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

export default function OutfitResult({ result, onSave, onSaved, autoSave = false, user }) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [fallbackTried, setFallbackTried] = useState(false);
  const [activeTab, setActiveTab] = useState('outfit');

  // New states to handle the Save/Unsave toggle
  const [isSaved, setIsSaved] = useState(false);
  const [savedOutfitId, setSavedOutfitId] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [saveError, setSaveError] = useState('');
  const autoSaveDone = useRef(false);

  const { photoAnalysis, outfitRecommendation = {}, generatedImageUrl } = result;
  const colorPalette = asList(outfitRecommendation.colorPalette);
  const keyPieces = asList(outfitRecommendation.keyPieces);
  const stylingTips = asList(outfitRecommendation.stylingTips);
  const occasions = asList(outfitRecommendation.occasions);

  // 1. Function to SAVE the outfit
  const handleSaveOutfitClick = useCallback(async () => {
    if (!user) {
      onSave?.();
      return;
    }

    setSaveError('');
    setIsProcessing(true);
    try {
      const res = await fetch('/api/users/save-outfit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          occasion: result.occasion,
          budget: result.budget,
          height: result.height,
          age: result.age,
          bodyType: result.bodyType,
          skinTone: photoAnalysis?.skinTone,
          outfitDescription: outfitRecommendation?.outfitDescription,
          outfitExplanation: outfitRecommendation?.explanation,
          outfitImageUrl: generatedImageUrl,
          userPhotoPath: result.photoPath,
        }),
      });
      const data = await res.json();

      if (data.success) {
        setIsSaved(true);
        // Save the unique ID so we can delete it later if the user clicks "Unsave"
        if (data.outfitId || data.id) {
          setSavedOutfitId(data.outfitId || data.id);
        }
        onSaved?.();
      } else {
        setSaveError('Failed to save outfit. Please try again.');
      }
    } catch {
      setSaveError('Error saving outfit. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  }, [user, onSave, onSaved, result, photoAnalysis, outfitRecommendation, generatedImageUrl]);

  // The user clicked "Save Outfit" while signed out: finish that save as soon as sign-in lands.
  useEffect(() => {
    if (autoSave && user && !isSaved && !autoSaveDone.current) {
      autoSaveDone.current = true;
      handleSaveOutfitClick();
    }
  }, [autoSave, user, isSaved, handleSaveOutfitClick]);

  // 2. Function to UNSAVE the outfit
  const handleUnsaveOutfitClick = async () => {
    if (!user) return;

    setIsProcessing(true);
    try {
      if (savedOutfitId) {
        // This calls the backend delete route you added in Step 1
        const res = await fetch(`/api/users/delete-outfit/${savedOutfitId}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: user.id })
        });
        const data = await res.json();
        
        if (data.success) {
          setIsSaved(false);
          setSavedOutfitId(null);
        }
      } else {
        // Fallback just in case the ID wasn't captured
        setIsSaved(false);
      }
    } catch {
      setSaveError('Error removing outfit. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleImageError = (e) => {
    if (fallbackTried) {
      setImageError(true);
      return;
    }
    // Retry once through the server-side proxy before giving up on the image.
    setFallbackTried(true);
    const fallbackPrompt = encodeURIComponent(
      `full body shot from head to toe, entire figure in frame including shoes, full-length fashion photograph, ${outfitRecommendation.imagePrompt || outfitRecommendation.outfitDescription || 'professional fashion outfit'}`
    );
    if (e?.target) e.target.src = `/api/proxy-image?prompt=${fallbackPrompt}&width=768&height=1152`;
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
        {/* 'Outfit Look' Tab Content */}
        {activeTab === 'outfit' && (
          <>
            <div className="rounded-2xl overflow-hidden glass border border-white/10 mb-6">
              {generatedImageUrl && !imageError ? (
                <div className="relative">
                  {!imageLoaded && (
                    <div className="w-full aspect-[2/3] flex flex-col items-center justify-center gap-3 bg-white/5">
                      <div className="w-10 h-10 border-2 border-purple-500/40 border-t-purple-400 rounded-full animate-spin" />
                      <p className="text-white/40 text-sm">Generating your look...</p>
                    </div>
                  )}
                  {/* object-contain keeps the whole head-to-shoes frame visible instead of cropping it */}
                  <img 
                    src={generatedImageUrl} 
                    alt={outfitRecommendation.outfitName || 'AI generated outfit'} 
                    onLoad={() => setImageLoaded(true)} 
                    onError={handleImageError}
                    className={`w-full max-h-[80vh] object-contain bg-black/20 transition-opacity ${imageLoaded ? 'opacity-100' : 'opacity-0'}`} 
                  />
                </div>
              ) : (
                <div className="w-full aspect-[2/3] flex items-center justify-center bg-white/5">
                  <p className="text-white/40">No image available</p>
                </div>
              )}
            </div>
            <div className="look-summary-card p-6 rounded-2xl glass border border-white/10 mb-4">
              <p className="description-text leading-relaxed text-sm">
                {outfitRecommendation.outfitDescription?.includes('{"outfitName"') 
                  ? outfitRecommendation.outfitDescription.match(/"outfitDescription"\s*:\s*"([^"]+)"/)?.[1] || "Stylish modern outfit tailored to your preferences."
                  : outfitRecommendation.outfitDescription}
              </p>
            </div>
          </>
        )}

        {/* 'Outfit Details' Tab Content */}
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
                  ? outfitRecommendation.explanation.match(/"explanation"\s*:\s*"([^"]+)"/)?.[1] || "Designed based on your profile inputs."
                  : outfitRecommendation.explanation}
              </p>
            </div>
          </div>
        )}

        {/* 'Your Profile' Tab Content */}
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
        
        {saveError && (
          <p className="text-red-400 text-sm text-center">{saveError}</p>
        )}

        {/* --- DYNAMIC SAVE / UNSAVE BUTTON --- */}
        {isSaved ? (
          <button 
            onClick={handleUnsaveOutfitClick}
            disabled={isProcessing}
            style={{
              backgroundColor: '#dc2626', // Red color when it's saved so it looks like a delete action
              color: '#ffffff',
              width: '100%',
              padding: '10px 16px',
              borderRadius: '8px',
              fontWeight: '500',
              border: 'none',
              cursor: isProcessing ? 'not-allowed' : 'pointer',
              marginTop: '20px',
              marginBottom: '10px',
              transition: 'background-color 0.2s',
              opacity: isProcessing ? 0.7 : 1
            }}
          >
            {isProcessing ? 'Removing...' : 'Unsave this Outfit'}
          </button>
        ) : (
          <button 
            onClick={handleSaveOutfitClick}
            disabled={isProcessing}
            style={{
              backgroundColor: '#9333ea', // Original Purple color
              color: '#ffffff',
              width: '100%',
              padding: '10px 16px',
              borderRadius: '8px',
              fontWeight: '500',
              border: 'none',
              cursor: isProcessing ? 'not-allowed' : 'pointer',
              marginTop: '20px',
              marginBottom: '10px',
              transition: 'background-color 0.2s',
              opacity: isProcessing ? 0.7 : 1
            }}
          >
            {isProcessing ? 'Saving...' : 'Save Outfit'}
          </button>
        )}
        {/* --- END OF BUTTON --- */}
      </div>
    </div>
  );
}
