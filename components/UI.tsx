import React from 'react';
import { AppInteractionState } from '../App';

interface UIProps {
  isRunning: boolean;
  leftHand: AppInteractionState['leftHand'];
  rightHand: AppInteractionState['rightHand'];
  onStart: () => void;
}

export const UIOverlay: React.FC<UIProps> = ({ isRunning, leftHand, rightHand, onStart }) => {
  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  };

  // Convert normalized (-1 to 1) to screen coordinates (0 to 100%)
  const cursorX = (rightHand.position.x + 1) / 2 * 100;
  const cursorY = (1 - rightHand.position.y) / 2 * 100;

  if (!isRunning) {
    return (
      <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
        <div className="text-center p-8 border border-white/20 rounded-2xl bg-black/60 max-w-2xl w-full">
          <h1 className="text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-yellow-200 via-green-400 to-green-600 mb-6 tracking-wider font-serif">
            Magic Christmas Tree
          </h1>
          <div className="grid grid-cols-2 gap-8 text-left mb-8">
            <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                <h3 className="text-xl font-bold text-green-400 mb-2">✋ Left Hand</h3>
                <p className="text-gray-300 text-sm">Controls the Magic</p>
                <ul className="mt-2 space-y-2 text-sm text-gray-400">
                    <li>• <strong>Open Hand:</strong> Explode Tree</li>
                    <li>• <strong>Closed Fist:</strong> Reform Tree</li>
                </ul>
            </div>
            <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                <h3 className="text-xl font-bold text-blue-400 mb-2">👆 Right Hand</h3>
                <p className="text-gray-300 text-sm">Interact & View</p>
                <ul className="mt-2 space-y-2 text-sm text-gray-400">
                    <li>• <strong>Index Finger:</strong> Move Cursor</li>
                    <li>• <strong>Pinch & Hold:</strong> View Photos</li>
                </ul>
            </div>
          </div>
          
          <button
            onClick={onStart}
            className="group relative px-10 py-4 bg-green-600 hover:bg-green-500 text-white rounded-full font-bold text-lg transition-all shadow-[0_0_20px_rgba(34,197,94,0.5)] hover:shadow-[0_0_40px_rgba(34,197,94,0.8)] overflow-hidden"
          >
            <span className="relative z-10">Start Experience</span>
            <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300"></div>
          </button>
          <p className="text-xs text-gray-500 mt-4">Camera access required for hand tracking.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 z-50 pointer-events-none">
      {/* Visual Cursor for Right Hand */}
      {rightHand.detected && (
        <div 
            className={`absolute w-8 h-8 -ml-4 -mt-4 rounded-full border-2 transition-transform duration-75 ease-out
                ${rightHand.isPinching ? 'bg-white/80 border-blue-500 scale-75' : 'bg-transparent border-white/50 scale-100'}
            `}
            style={{ 
                left: `${cursorX}%`, 
                top: `${cursorY}%`,
                boxShadow: rightHand.isPinching ? '0 0 15px rgba(59, 130, 246, 0.8)' : 'none'
            }}
        >
            <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-1 h-1 bg-white rounded-full"></div>
            </div>
        </div>
      )}

      {/* Header / Status */}
      <div className="absolute top-6 left-6 flex flex-col gap-2">
        <div className="flex items-center gap-3">
             <div className={`w-3 h-3 rounded-full ${leftHand.detected ? 'bg-green-500 shadow-[0_0_10px_#22c55e]' : 'bg-red-900'}`}></div>
             <span className="text-white/60 font-mono text-xs uppercase">LEFT: {leftHand.detected ? (leftHand.isOpen ? "EXPLODE" : "REFORM") : "NO HAND"}</span>
        </div>
        <div className="flex items-center gap-3">
             <div className={`w-3 h-3 rounded-full ${rightHand.detected ? 'bg-blue-500 shadow-[0_0_10px_#3b82f6]' : 'bg-red-900'}`}></div>
             <span className="text-white/60 font-mono text-xs uppercase">RIGHT: {rightHand.detected ? (rightHand.isPinching ? "HOLDING" : "MOVING") : "NO HAND"}</span>
        </div>
      </div>

      {/* Control Buttons */}
      <div className="absolute top-6 right-6 pointer-events-auto">
        <button 
          onClick={toggleFullScreen}
          className="p-3 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md transition-colors text-white border border-white/10"
          title="Toggle Fullscreen"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
          </svg>
        </button>
      </div>

      {/* Helper Messages */}
      <div className="absolute bottom-10 w-full text-center pointer-events-none">
        {!leftHand.detected && !rightHand.detected && (
            <div className="text-white/50 text-sm animate-pulse">Please show both hands to the camera</div>
        )}
      </div>
    </div>
  );
};