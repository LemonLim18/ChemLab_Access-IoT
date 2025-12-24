
import React, { useRef, useState, useEffect } from 'react';
import { Camera, X, Check, RefreshCw } from 'lucide-react';

interface CameraModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCapture: (base64: string) => void;
}

const CameraModal: React.FC<CameraModalProps> = ({ isOpen, onClose, onCapture }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);

  useEffect(() => {
    if (isOpen) {
      startCamera();
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [isOpen]);

  const startCamera = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' } 
      });
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
    } catch (err) {
      console.error("Error accessing camera:", err);
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
  };

  const takeSnapshot = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg');
        setCapturedImage(dataUrl);
      }
    }
  };

  const handleConfirm = () => {
    if (capturedImage) {
      setIsCapturing(true);
      const base64 = capturedImage.split(',')[1];
      onCapture(base64);
      setCapturedImage(null);
      onClose();
      setIsCapturing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal modal-open">
      <div className="modal-box max-w-2xl p-0 overflow-hidden bg-black flex flex-col h-[80vh]">
        <div className="absolute top-4 right-4 z-10">
          <button className="btn btn-circle btn-sm btn-ghost text-white bg-black/50" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 relative bg-neutral flex items-center justify-center">
          {capturedImage ? (
            <img src={capturedImage} alt="captured" className="max-h-full w-auto object-contain" />
          ) : (
            <video 
              ref={videoRef} 
              autoPlay 
              playsInline 
              className="w-full h-full object-cover"
            />
          )}
          <canvas ref={canvasRef} className="hidden" />
        </div>

        <div className="p-6 bg-base-100 flex justify-center items-center gap-6">
          {capturedImage ? (
            <>
              <button className="btn btn-circle btn-lg btn-ghost border-base-300" onClick={() => setCapturedImage(null)}>
                <RefreshCw size={24} />
              </button>
              <button className="btn btn-circle btn-lg btn-primary shadow-xl" onClick={handleConfirm} disabled={isCapturing}>
                {isCapturing ? <span className="loading loading-spinner"></span> : <Check size={32} />}
              </button>
            </>
          ) : (
            <button className="btn btn-circle btn-lg btn-primary shadow-2xl scale-110" onClick={takeSnapshot}>
              <Camera size={32} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default CameraModal;
