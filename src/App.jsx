import { useState } from 'react';
import PhotoUpload from './components/PhotoUpload';
import SelectionForm from './components/SelectionForm';
import OutfitResult from './components/OutfitResult';
import AuthModal from './components/AuthModal';
import LoadingScreen from './components/LoadingScreen';
import SavedOutfits from './pages/SavedOutfits';
import { apiFetch } from './lib/api';

export default function App() {
  const [page, setPage] = useState('home'); // home | saved
  const [step, setStep] = useState(0);
  const [photo, setPhoto] = useState(null);
  const [preferences, setPreferences] = useState({
    occasion: '',
    budget: '',
    height: '',
    age: '',
    bodyType: '',
  });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [showAuth, setShowAuth] = useState(false);
  const [user, setUser] = useState(null);
  const [savingOutfit, setSavingOutfit] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const canProceedFromPhoto = !!photo;
  const canProceedFromPreferences =
    preferences.occasion && preferences.budget &&
    preferences.height && preferences.age && preferences.bodyType;

  const handleAnalyze = async () => {
    if (!photo?.file) return;
    setLoading(true);
    setError('');

    try {
      const formData = new FormData();
      formData.append('photo', photo.file);
      formData.append('occasion', preferences.occasion);
      formData.append('budget', preferences.budget);
      formData.append('height', preferences.height);
      formData.append('age', preferences.age);
      formData.append('bodyType', preferences.bodyType);

      const data = await apiFetch('/api/analyze', {
        method: 'POST',
        body: formData,
        signal: AbortSignal.timeout(60000),
      });

      if (!data.success) {
        throw new Error(data.error || 'Analysis failed');
      }

      setResult({ ...data, photoFile: photo.file });
      setStep(2);
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveOutfit = () => {
    if (!user) {
      setShowAuth(true);
    } else {
      performSave(user);
    }
  };

  const performSave = async (currentUser) => {
    if (!result) return;
    setSavingOutfit(true);
    try {
      const data = await apiFetch('/api/users/save-outfit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUser.id,
          occasion: preferences.occasion,
          budget: preferences.budget,
          height: preferences.height,
          age: preferences.age,
          bodyType: preferences.bodyType,
          skinTone: result.photoAnalysis?.skinTone,
          outfitDescription: result.outfitRecommendation?.outfitDescription,
          outfitExplanation: result.outfitRecommendation?.explanation,
          outfitImageUrl: result.generatedImageUrl,
          userPhotoPath: result.photoPath,
        }),
      });
      if (data.success) {
        setSavedSuccess(true);
        setTimeout(() => setSavedSuccess(false), 3000);
      }
    } catch (err) {
      console.error('Save error:', err);
    } finally {
      setSavingOutfit(false);
    }
  };

  const handleAuthSuccess = (registeredUser) => {
    setUser(registeredUser);
    setShowAuth(false);
    performSave(registeredUser);
  };

  const resetApp = () => {
    setStep(0);
    setPhoto(null);
    setPreferences({ occasion: '', budget: '', height: '', age: '', bodyType: '' });
    setResult(null);
    setError('');
    setSavedSuccess(false);
  };

  if (page === 'saved') {
    return (
      <SavedOutfits
        user={user}
        onBack={() => setPage('home')}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0f0f0f] via-[#1a0a2e] to-[#0f0f0f]">
      {loading && <LoadingScreen />}
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} onSuccess={handleAuthSuccess} />}

      {/* Header */}
      <header className="border-b border-white/8 glass-dark sticky top-0 z-30">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-600 to-pink-600 flex items-center justify-center shadow-lg">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
              </svg>
            </div>
            <span className="text-white font-bold text-lg tracking-tight">Siddharth AI</span>
          </div>

          <div className="flex items-center gap-2">
            {user && (
              <button
                onClick={() => setPage('saved')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/8 hover:bg-white/12 border border-white/10 text-white/70 hover:text-white transition-all text-sm"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                </svg>
                Saved
              </button>
            )}
            {user ? (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-purple-500/15 border border-purple-500/30">
                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white text-xs font-bold">
                  {user.name[0].toUpperCase()}
                </div>
                <span className="text-purple-300 text-sm font-medium hidden sm:block">{user.name.split(' ')[0]}</span>
              </div>
            ) : (
              <button
                onClick={() => setShowAuth(true)}
                className="px-3 py-1.5 rounded-lg border border-white/15 text-white/60 hover:text-white hover:border-purple-400/50 transition-all text-sm"
              >
                Sign in
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Hero (only on step 0) */}
      {step === 0 && (
        <div className="text-center pt-12 pb-8 px-4">
          <div className="inline-flex items-center gap-2 bg-purple-500/15 border border-purple-500/30 text-purple-300 px-4 py-1.5 rounded-full text-sm font-medium mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
            AI-Powered Fashion Stylist
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-white leading-tight mb-4">
            Siddharth AI
            <br />
            <span className="gradient-text">Fashion Stylist</span>
          </h1>
          <p className="text-white/50 text-lg max-w-xl mx-auto">
            Upload your photo, tell us your style preferences, and get a personalized outfit recommendation tailored to your unique features.
          </p>
        </div>
      )}

      {/* Step Progress */}
      <div className="max-w-4xl mx-auto px-4 mb-6">
        <div className="flex items-center justify-center gap-2">
          {['Upload Photo', 'Preferences', 'Your Outfit'].map((label, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all ${
                i === step
                  ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white'
                  : i < step
                  ? 'bg-green-500/20 border border-green-500/40 text-green-400'
                  : 'bg-white/5 border border-white/10 text-white/30'
              }`}>
                {i < step ? (
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                ) : (
                  <span>{i + 1}</span>
                )}
                {label}
              </div>
              {i < 2 && <div className={`w-6 h-px ${i < step ? 'bg-green-500/40' : 'bg-white/10'}`} />}
            </div>
          ))}
        </div>
      </div>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 pb-16">
        {error && (
          <div className="mb-6 bg-red-500/15 border border-red-500/30 text-red-400 px-4 py-3 rounded-xl flex items-center gap-2">
            <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            {error}
            <button onClick={() => setError('')} className="ml-auto text-red-400/60 hover:text-red-400">×</button>
          </div>
        )}

        {/* Success Banner */}
        {savedSuccess && (
          <div className="mb-6 bg-green-500/15 border border-green-500/30 text-green-400 px-4 py-3 rounded-xl flex items-center gap-2 fade-in-up">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            Outfit saved successfully!
            <button onClick={() => setPage('saved')} className="ml-auto text-green-300 text-sm underline">View Saved</button>
          </div>
        )}

        {/* Step 0: Photo Upload */}
        {step === 0 && (
          <div className="fade-in-up max-w-lg mx-auto">
            <div className="glass rounded-2xl p-6 border border-white/10">
              <h2 className="text-white font-bold text-xl mb-1">Upload Your Photo</h2>
              <p className="text-white/50 text-sm mb-6">A clear face photo gives the best results for skin tone analysis</p>
              <PhotoUpload onPhotoSelected={setPhoto} photo={photo} />

              <button
                onClick={() => setStep(1)}
                disabled={!canProceedFromPhoto}
                className="mt-6 w-full py-3.5 rounded-xl btn-primary text-white font-semibold disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                Continue
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>

            {/* Features */}
            <div className="grid grid-cols-3 gap-3 mt-6">
              {[
                { emoji: '🎨', label: 'Skin Tone Analysis' },
                { emoji: '✨', label: 'AI Outfit Generation' },
                { emoji: '💾', label: 'Save Your Looks' },
              ].map((f) => (
                <div key={f.emoji} className="glass rounded-xl p-3 text-center border border-white/8">
                  <div className="text-2xl mb-1">{f.emoji}</div>
                  <p className="text-white/60 text-xs font-medium">{f.label}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Step 1: Preferences */}
        {step === 1 && (
          <div className="fade-in-up">
            <div className="glass rounded-2xl p-6 border border-white/10">
              <div className="flex items-start justify-between mb-6">
                <div>
                  <h2 className="text-white font-bold text-xl">Your Style Preferences</h2>
                  <p className="text-white/50 text-sm mt-1">Help us craft your perfect outfit recommendation</p>
                </div>
                <button
                  onClick={() => setStep(0)}
                  className="w-9 h-9 rounded-xl bg-white/8 hover:bg-white/12 transition-colors flex items-center justify-center flex-shrink-0"
                >
                  <svg className="w-4 h-4 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
              </div>

              <SelectionForm values={preferences} onChange={setPreferences} />

              <button
                onClick={handleAnalyze}
                disabled={!canProceedFromPreferences}
                className="mt-8 w-full py-4 rounded-2xl btn-primary text-white font-bold text-lg disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-xl"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Generate My Outfit
              </button>

              {!canProceedFromPreferences && (
                <p className="text-white/30 text-xs text-center mt-2">
                  Please select all options above to continue
                </p>
              )}
            </div>
          </div>
        )}

        {/* Step 2: Result */}
        {step === 2 && result && (
          <div className="max-w-lg mx-auto">
            <OutfitResult
              result={result}
              onSave={handleSaveOutfit}
              user={user}
            />
            <button
              onClick={resetApp}
              className="mt-4 w-full py-3 rounded-xl border border-white/15 text-white/60 hover:text-white hover:border-purple-400/50 hover:bg-purple-500/10 transition-all text-sm font-medium"
            >
              Try Another Outfit
            </button>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-white/8 py-6 text-center">
        <p className="text-white/20 text-xs">
          Siddharth AI Fashion Stylist · Powered by Groq &amp; Pollinations AI · All outfit images are AI-generated
        </p>
      </footer>
    </div>
  );
}
