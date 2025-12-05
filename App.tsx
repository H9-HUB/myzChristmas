import React, { useState, useRef, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { PerspectiveCamera, OrbitControls } from '@react-three/drei';
import { MagicTree } from './components/MagicTree';
import { UIOverlay } from './components/UI';
import { VisionManager, VisionResult } from './services/visionService';

export interface AppInteractionState {
  leftHand: {
    detected: boolean;
    isOpen: boolean; // Controls Expansion
    position: { x: number; y: number };
  };
  rightHand: {
    detected: boolean;
    isPinching: boolean; // Controls Click
    position: { x: number; y: number };
  };
}

const App: React.FC = () => {
  const [interaction, setInteraction] = useState<AppInteractionState>({
    leftHand: { detected: false, isOpen: false, position: { x: 0, y: 0 } },
    rightHand: { detected: false, isPinching: false, position: { x: 0, y: 0 } },
  });

  const [activePhotoUrl, setActivePhotoUrl] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const visionRef = useRef<VisionManager | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const startExperience = useCallback(async () => {
    if (!videoRef.current) return;
    
    setIsRunning(true);
    visionRef.current = new VisionManager();
    
    try {
      await visionRef.current.initialize(videoRef.current, (result: VisionResult) => {
        setInteraction({
            leftHand: result.leftHand,
            rightHand: result.rightHand
        });
      });
    } catch (error) {
      console.error("Failed to start vision:", error);
      setIsRunning(false);
      alert("Failed to access camera or load AI models.");
    }
  }, []);

  const handleClosePhoto = () => setActivePhotoUrl(null);

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden">
      {/* Video Element (Hidden logic, shown for feedback) */}
      <video
        ref={videoRef}
        className={`absolute bottom-8 right-8 w-64 h-48 object-cover rounded-2xl border-2 border-white/20 z-40 scale-x-[-1] shadow-2xl shadow-green-900/30 transition-all duration-500 ${isRunning ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'}`}
        playsInline
        muted
        autoPlay
      />

      {/* 3D Scene */}
      <div className="absolute inset-0 z-10">
        <Canvas dpr={[1, 2]} gl={{ antialias: true, alpha: false }}>
          {/* @ts-ignore */}
          <color attach="background" args={['#050805']} />
          <PerspectiveCamera makeDefault position={[0, 0, 24]} fov={40} />
          
          {/* @ts-ignore */}
          <ambientLight intensity={0.8} />
          {/* @ts-ignore */}
          <pointLight position={[10, 10, 10]} intensity={1} color="#ffffff" />

          <MagicTree 
            interaction={interaction} 
            onPhotoSelect={(url) => setActivePhotoUrl(url)}
          />
          
          {/* Fallback controls if no LEFT hand is detected (since Left controls tree structure) */}
          {!interaction.leftHand.detected && <OrbitControls enableZoom={false} autoRotate autoRotateSpeed={0.5} />}
        </Canvas>
      </div>

      {/* UI Overlay */}
      <UIOverlay 
        isRunning={isRunning} 
        leftHand={interaction.leftHand}
        rightHand={interaction.rightHand}
        onStart={startExperience} 
      />

      {/* Fullscreen Photo Overlay */}
      {activePhotoUrl && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md animate-in fade-in duration-300" onClick={handleClosePhoto}>
            <div className="relative max-w-4xl max-h-[90vh] p-4 bg-white rounded-lg shadow-2xl transform transition-transform scale-100 flex flex-col items-center">
                <img src={activePhotoUrl} alt="Enlarged Memory" className="max-h-[80vh] object-contain rounded border-4 border-white shadow-inner" />
                <div className="mt-4 text-center pointer-events-none">
                    <span className="bg-black/50 text-white px-4 py-2 rounded-full text-sm font-semibold tracking-wide">
                        Release pinch to close
                    </span>
                </div>
            </div>
        </div>
      )}
    </div>
  );
};

export default App;