import { useState, useRef, useCallback } from 'react';

// A 768px photo is plenty for skin-tone/appearance analysis and keeps the upload plus the vision
// request small, which is the biggest chunk of the wait before the outfit appears.
const MAX_PHOTO_SIZE = 768;

async function downscalePhoto(file) {
  if (typeof createImageBitmap !== 'function') return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_PHOTO_SIZE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1) return file;

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

export default function PhotoUpload({ onPhotoSelected, photo }) {
  const [isDragging, setIsDragging] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [stream, setStream] = useState(null);
  const fileInputRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  const handleFile = useCallback(async (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    const resized = await downscalePhoto(file);
    const url = URL.createObjectURL(resized);
    onPhotoSelected({ file: resized, url });
  }, [onPhotoSelected]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    handleFile(file);
  }, [handleFile]);

  const handleDragOver = (e) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = () => setIsDragging(false);

  const openCamera = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      setStream(mediaStream);
      setCameraActive(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
          videoRef.current.play();
        }
      }, 100);
    } catch {
      alert('Camera access denied. Please allow camera access and try again.');
    }
  };

  const capturePhoto = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const scale = Math.min(1, MAX_PHOTO_SIZE / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob((blob) => {
      const file = new File([blob], 'camera-photo.jpg', { type: 'image/jpeg' });
      const url = canvas.toDataURL('image/jpeg');
      onPhotoSelected({ file, url });
      closeCamera();
    }, 'image/jpeg', 0.95);
  };

  const closeCamera = () => {
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      setStream(null);
    }
    setCameraActive(false);
  };

  return (
    <div className="w-full">
      {cameraActive ? (
        <div className="relative rounded-2xl overflow-hidden glass border border-white/10">
          <video ref={videoRef} className="w-full max-h-80 object-cover" autoPlay playsInline muted />
          <canvas ref={canvasRef} className="hidden" />
          <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-4 px-4">
            <button
              onClick={capturePhoto}
              className="w-16 h-16 rounded-full bg-white border-4 border-purple-500 shadow-lg hover:scale-110 transition-transform flex items-center justify-center"
            >
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500" />
            </button>
            <button
              onClick={closeCamera}
              className="px-4 py-2 rounded-xl bg-black/60 text-white border border-white/20 hover:bg-black/80 transition-all"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : photo ? (
        <div className="relative rounded-2xl overflow-hidden group">
          <img src={photo.url} alt="Your photo" className="w-full max-h-80 object-cover rounded-2xl" />
          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
            <button
              onClick={() => onPhotoSelected(null)}
              className="px-4 py-2 rounded-xl bg-red-500/80 text-white text-sm font-medium hover:bg-red-500 transition-colors"
            >
              Remove
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-2 rounded-xl bg-purple-500/80 text-white text-sm font-medium hover:bg-purple-500 transition-colors"
            >
              Change
            </button>
          </div>
          <div className="absolute top-3 right-3 bg-green-500 text-white text-xs px-2 py-1 rounded-full font-medium">
            ✓ Photo Ready
          </div>
        </div>
      ) : (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
          className={`
            relative border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all duration-300
            ${isDragging
              ? 'border-purple-400 bg-purple-500/10 scale-[1.02]'
              : 'border-white/20 hover:border-purple-400/60 hover:bg-white/5'
            }
          `}
        >
          <div className="flex flex-col items-center gap-4">
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-purple-500/20 to-pink-500/20 border border-purple-500/30 flex items-center justify-center float">
              <svg className="w-10 h-10 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <p className="text-white/80 font-medium text-lg">Drop your photo here</p>
              <p className="text-white/40 text-sm mt-1">or click to browse files</p>
            </div>
            <p className="text-white/30 text-xs">Supports JPG, PNG, WEBP • Max 10MB</p>
          </div>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFile(e.target.files[0])}
      />

      {!cameraActive && !photo && (
        <button
          onClick={openCamera}
          className="mt-3 w-full py-3 rounded-xl border border-white/15 text-white/70 hover:text-white hover:border-purple-400/50 hover:bg-purple-500/10 transition-all duration-200 flex items-center justify-center gap-2 text-sm font-medium"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Open Camera
        </button>
      )}
    </div>
  );
}
