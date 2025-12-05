import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";

export interface HandData {
  detected: boolean;
  isOpen: boolean; // For Left Hand (Tree Logic)
  position: { x: number; y: number }; // Normalized -1 to 1
  isPinching: boolean; // For Right Hand (Click Logic)
}

export interface VisionResult {
  leftHand: HandData;
  rightHand: HandData;
}

export class VisionManager {
  private handLandmarker: HandLandmarker | null = null;
  private runningMode: "IMAGE" | "VIDEO" = "VIDEO";
  private videoElement: HTMLVideoElement | null = null;
  private lastVideoTime = -1;
  private callback: ((result: VisionResult) => void) | null = null;
  private animationFrameId: number | null = null;

  async initialize(video: HTMLVideoElement, callback: (result: VisionResult) => void) {
    this.videoElement = video;
    this.callback = callback;

    try {
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm"
      );

      this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
          delegate: "GPU"
        },
        runningMode: this.runningMode,
        numHands: 2 // Enable 2 hands
      });

      // Start Webcam
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      this.videoElement.srcObject = stream;
      await new Promise<void>((resolve) => {
          if (this.videoElement) {
              this.videoElement.onloadeddata = () => {
                  this.videoElement!.play();
                  resolve();
              }
          }
      });

      this.loop();
    } catch (error) {
      console.error("VisionManager Initialization Error:", error);
      throw error;
    }
  }

  private loop = () => {
    if (this.videoElement && this.handLandmarker) {
      const startTimeMs = performance.now();
      
      if (this.videoElement.currentTime !== this.lastVideoTime) {
        this.lastVideoTime = this.videoElement.currentTime;
        try {
            const detections = this.handLandmarker.detectForVideo(this.videoElement, startTimeMs);
            this.processDetections(detections);
        } catch (e) {
            console.warn("Detection error:", e);
        }
      }
    }
    this.animationFrameId = requestAnimationFrame(this.loop);
  };

  private processDetections(result: any) {
    const emptyHand: HandData = { detected: false, isOpen: false, position: { x: 0, y: 0 }, isPinching: false };
    const visionResult: VisionResult = {
        leftHand: { ...emptyHand },
        rightHand: { ...emptyHand }
    };

    if (result.landmarks && result.handedness) {
        for (let i = 0; i < result.landmarks.length; i++) {
            const landmarks = result.landmarks[i];
            const handedness = result.handedness[i][0]; // { categoryName: 'Left'|'Right', score: ... }
            const label = handedness.categoryName; 

            // Calculate Position (Index Finger Tip for Cursor, Center for General)
            // For Right Hand (Cursor), we use Index Tip (8)
            // For Left Hand (Tree), we can use Center or Wrist
            const wrist = landmarks[0];
            const indexTip = landmarks[8]; // Index Tip
            const thumbTip = landmarks[4]; // Thumb Tip

            // Position Logic
            // MediaPipe x is 0-1. In a mirrored video, 0 is left side of screen.
            // Screen coords: x: -1 (left) to 1 (right)
            // We flip X because the video is mirrored in UI
            const x = -(indexTip.x - 0.5) * 2;
            const y = -(indexTip.y - 0.5) * 2;

            // Openness (For Tree - Left Hand)
            // Avg dist from wrist to tips
            const tips = [4, 8, 12, 16, 20];
            let totalDist = 0;
            tips.forEach(idx => {
                const tip = landmarks[idx];
                const d = Math.sqrt(Math.pow(tip.x - wrist.x, 2) + Math.pow(tip.y - wrist.y, 2));
                totalDist += d;
            });
            const isOpen = (totalDist / 5) > 0.25;

            // Pinch (For Click - Right Hand)
            // Dist between Index Tip (8) and Thumb Tip (4)
            const pinchDist = Math.sqrt(
                Math.pow(indexTip.x - thumbTip.x, 2) + 
                Math.pow(indexTip.y - thumbTip.y, 2)
            );
            const isPinching = pinchDist < 0.05; // Threshold for pinch

            const handData: HandData = {
                detected: true,
                isOpen,
                position: { x, y },
                isPinching
            };

            if (label === 'Left') {
                visionResult.leftHand = handData;
            } else {
                visionResult.rightHand = handData;
            }
        }
    }

    if (this.callback) {
      this.callback(visionResult);
    }
  }

  stop() {
    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
    if (this.videoElement && this.videoElement.srcObject) {
      const stream = this.videoElement.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
    }
  }
}