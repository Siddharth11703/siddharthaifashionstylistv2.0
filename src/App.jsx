import { useState } from 'react';
import PhotoUpload from './components/PhotoUpload';
import SelectionForm from './components/SelectionForm';
import OutfitResult from './components/OutfitResult';
import AuthModal from './components/AuthModal';
import LoadingScreen from './components/LoadingScreen';
import SavedOutfits from './pages/SavedOutfits';


const parseApiResponse = async (res) => {
  const text = await res.text();
  const contentType = res.headers.get('content-type') || '';

  if (!contentType.includes('application/json')) {
    throw new Error(
      `Server returned ${res.status}. Make sure API routes are deployed and environment variables are configured on Vercel.`
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Server response was not valid JSON. Please check deployment logs.');
  }
};


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

      const res = await fetch('/api/analyze', {
        method: 'POST',
        body: formData,
        signal: AbortSignal.timeout(60000),
      });

      const data = await parseApiResponse(res);

      if (!res.ok || data.success === false) {
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
      const res = await fetch('/api/users/save-outfit', {
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

      const data = await parseApiResponse(res);
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
          <>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-purple-500/15 border border-purple-500/30">
  <div className="w-6 h-6 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white text-xs font-bold">
    {user?.name ? user.name[0].toUpperCase() : ''}
  </div>
  <span className="text-purple-300 text-sm font-medium hidden sm:block">
    {user?.name ? user.name.split(' ')[0] : ''}
  </span>
</div>

            <button 
              onClick={handleSignOut} 
              style={{
                backgroundColor: 'transparent',
                color: '#ffffff',
                border: '1px solid #4b5563', 
                padding: '6px 16px',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '14px'
              }}
            >
              Sign out
            </button>
          </>
        ) : (
          <button 
            onClick={handleSignIn} 
            style={{
              backgroundColor: 'transparent',
              color: '#ffffff',
              border: '1px solid #4b5563', 
              padding: '6px 16px',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            Sign in
          </button>
        )}
