export default function LoadingScreen() {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 backdrop-blur-md">
      <div className="text-center space-y-6 p-8">
        {/* Animated Logo */}
        <div className="relative w-24 h-24 mx-auto">
          <div className="absolute inset-0 rounded-full bg-gradient-to-br from-purple-600 to-pink-600 opacity-20 animate-ping" />
          <div className="relative w-24 h-24 rounded-full bg-gradient-to-br from-purple-600 to-pink-600 flex items-center justify-center shadow-2xl">
            <svg className="w-12 h-12 text-white animate-spin-slow" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
            </svg>
          </div>
        </div>

        {/* Steps */}
        <div className="space-y-3 max-w-xs mx-auto">
          {[
            { label: 'Analyzing your photo', emoji: '📸', delay: 0 },
            { label: 'Detecting skin tone & features', emoji: '🎨', delay: 1 },
            { label: 'Crafting your perfect outfit', emoji: '👗', delay: 2 },
            { label: 'Generating outfit visualization', emoji: '✨', delay: 3 },
          ].map((step, i) => (
            <div
              key={i}
              className="flex items-center gap-3 text-left glass rounded-xl px-4 py-3"
              style={{ animationDelay: `${step.delay * 0.5}s` }}
            >
              <span className="text-xl">{step.emoji}</span>
              <span className="text-white/70 text-sm">{step.label}</span>
              <div className="ml-auto flex gap-1">
                {[0, 1, 2].map(j => (
                  <div
                    key={j}
                    className="w-1.5 h-1.5 rounded-full bg-purple-400"
                    style={{
                      animation: `pulse 1.4s ease-in-out ${(i * 0.3 + j * 0.15)}s infinite`,
                    }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        <p className="text-white/40 text-xs max-w-xs mx-auto">
          Our AI is working its magic. This may take 20–40 seconds...
        </p>

        <style>{`
          @keyframes pulse {
            0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); }
            40% { opacity: 1; transform: scale(1); }
          }
        `}</style>
      </div>
    </div>
  );
}
