import React, { useMemo, useRef, useState, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { AppInteractionState } from '../App';

// --- Shader for Instanced Meshes (Tree Parts) ---
const InstanceShaderMaterial = {
  uniforms: {
    uTime: { value: 0 },
    uExpansion: { value: 0 },
    uRotation: { value: 0 },
    uColorBoost: { value: 1.2 },
  },
  vertexShader: `
    uniform float uTime;
    uniform float uExpansion;
    uniform float uRotation;
    
    attribute vec3 aTargetPos;
    attribute vec3 aRandomPos;
    attribute vec3 aColor;
    attribute float aScale;
    attribute vec3 aRandomAxis;
    attribute float aSpeed;

    varying vec3 vColor;
    varying vec3 vNormal;
    varying vec3 vViewPosition;

    mat4 rotationMatrix(vec3 axis, float angle) {
        axis = normalize(axis);
        float s = sin(angle);
        float c = cos(angle);
        float oc = 1.0 - c;
        return mat4(oc * axis.x * axis.x + c,           oc * axis.x * axis.y - axis.z * s,  oc * axis.z * axis.x + axis.y * s,  0.0,
                    oc * axis.x * axis.y + axis.z * s,  oc * axis.y * axis.y + c,           oc * axis.y * axis.z - axis.x * s,  0.0,
                    oc * axis.z * axis.x - axis.y * s,  oc * axis.y * axis.z + axis.x * s,  oc * axis.z * axis.z + c,           0.0,
                    0.0,                                0.0,                                0.0,                                1.0);
    }

    mat2 rotate2d(float _angle){
        return mat2(cos(_angle),-sin(_angle),
                    sin(_angle),cos(_angle));
    }

    void main() {
      vColor = aColor;
      vNormal = normalize(normalMatrix * normal);

      vec3 targetPos = mix(aTargetPos, aRandomPos, uExpansion * 0.95);
      float noise = sin(uTime * aSpeed + targetPos.y) * 0.1;
      
      if (uExpansion > 0.05) {
        targetPos.x += cos(uTime * aSpeed) * uExpansion * 1.5;
        targetPos.y += sin(uTime * aSpeed * 0.7) * uExpansion * 1.0;
        targetPos.z += sin(uTime * aSpeed + 2.0) * uExpansion * 1.5;
      } else {
        targetPos.y += noise * 0.2;
      }

      vec2 rotatedXZ = rotate2d(uRotation) * targetPos.xz;
      targetPos.x = rotatedXZ.x;
      targetPos.z = rotatedXZ.y;

      vec3 transformedPosition = position * aScale;
      float tumbleAngle = uTime * aSpeed * uExpansion * 5.0;
      mat4 tumbleMat = rotationMatrix(aRandomAxis, tumbleAngle);
      transformedPosition = (tumbleMat * vec4(transformedPosition, 1.0)).xyz;

      vec3 finalPosition = targetPos + transformedPosition;

      vec4 mvPosition = modelViewMatrix * vec4(finalPosition, 1.0);
      vViewPosition = -mvPosition.xyz;
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  fragmentShader: `
    varying vec3 vColor;
    varying vec3 vNormal;
    varying vec3 vViewPosition;
    uniform float uColorBoost;

    void main() {
      vec3 normal = normalize(vNormal);
      vec3 viewDir = normalize(vViewPosition);
      vec3 lightDir1 = normalize(vec3(1.0, 1.0, 1.0));
      vec3 lightDir2 = normalize(vec3(-1.0, 0.5, -0.5));
      vec3 ambient = vColor * 0.4;
      float diff1 = max(dot(normal, lightDir1), 0.0);
      float diff2 = max(dot(normal, lightDir2), 0.0);
      vec3 diffuse = vColor * (diff1 * 0.8 + diff2 * 0.3);
      vec3 reflectDir = reflect(-lightDir1, normal);
      float spec = pow(max(dot(viewDir, reflectDir), 0.0), 32.0);
      vec3 specular = vec3(0.5) * spec;
      vec3 finalColor = (ambient + diffuse + specular) * uColorBoost;
      float rim = 1.0 - max(dot(viewDir, normal), 0.0);
      rim = pow(rim, 3.0);
      finalColor += vec3(rim * 0.3);
      gl_FragColor = vec4(finalColor, 1.0);
    }
  `
};

// --- Shader for Photo Ornaments (Circle <-> Rect Transition) ---
const PhotoOrnamentShader = {
  uniforms: {
    uTexture: { value: null },
    uExpansion: { value: 0 },
    uTime: { value: 0 },
    uHighlight: { value: 0 },
  },
  vertexShader: `
    varying vec2 vUv;
    varying vec3 vNormal;
    
    void main() {
      vUv = uv;
      vNormal = normalize(normalMatrix * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D uTexture;
    uniform float uExpansion;
    uniform float uHighlight;
    
    varying vec2 vUv;
    varying vec3 vNormal;

    // SDF for rounded box
    // p: point, b: half-dimensions, r: corner radius
    float sdRoundedBox(vec2 p, vec2 b, float r) {
        vec2 q = abs(p) - b + r;
        return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
    }

    void main() {
        vec2 uv = vUv - 0.5;
        
        // Shape Transition:
        // Expansion 0 (Tree Formed) -> Radius 0.5 (Circle)
        // Expansion 1 (Tree Exploded) -> Radius 0.05 (Rounded Rect)
        float radius = mix(0.5, 0.05, uExpansion);
        float dist = sdRoundedBox(uv, vec2(0.5), radius);
        
        // Alpha Mask (Anti-aliased edge)
        float alpha = 1.0 - smoothstep(0.0, 0.015, dist);
        
        if (alpha < 0.01) discard;
        
        vec4 texColor = texture2D(uTexture, vUv);
        
        // Simple Lighting
        vec3 normal = normalize(vNormal);
        vec3 lightDir = normalize(vec3(0.5, 0.8, 1.0));
        float diff = max(dot(normal, lightDir), 0.0);
        vec3 litColor = texColor.rgb * (0.8 + 0.3 * diff); // Ambient + Diffuse
        
        // Border Logic
        float borderDist = abs(dist);
        float borderThickness = 0.02 + uHighlight * 0.015;
        float borderMask = 1.0 - smoothstep(borderThickness - 0.01, borderThickness, borderDist);
        
        vec3 borderColor = mix(vec3(1.0), vec3(1.0, 0.8, 0.2), uHighlight); // White -> Gold
        
        vec3 finalColor = mix(litColor, borderColor, borderMask);
        
        gl_FragColor = vec4(finalColor, 1.0);
    }
  `
};

interface MagicTreeProps {
  interaction: AppInteractionState;
  onPhotoSelect: (url: string | null) => void;
}

// --- NEW COMPONENT: Background Particles ---
const BackgroundParticles = () => {
  const count = 800;
  const meshRef = useRef<THREE.Points>(null);
  
  const [positions, colors, randoms] = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const randoms = new Float32Array(count * 3); // For random movement
    for(let i=0; i<count; i++) {
        // Spread wide
        positions[i*3] = (Math.random() - 0.5) * 60;
        positions[i*3+1] = (Math.random() - 0.5) * 60;
        positions[i*3+2] = (Math.random() - 0.5) * 40 - 15; // Mostly behind
        
        const brightness = 0.3 + Math.random() * 0.7;
        // Cool blue-ish white
        colors[i*3] = brightness * 0.8;
        colors[i*3+1] = brightness * 0.9;
        colors[i*3+2] = brightness; 
        
        randoms[i*3] = Math.random();
        randoms[i*3+1] = Math.random();
        randoms[i*3+2] = Math.random();
    }
    return [positions, colors, randoms];
  }, []);

  useFrame((state) => {
    if (!meshRef.current) return;
    const time = state.clock.elapsedTime;
    
    // Slowly rotate the container to simulate drift
    meshRef.current.rotation.y = time * 0.02;
    meshRef.current.rotation.z = Math.sin(time * 0.05) * 0.05;
  });

  return (
    <points ref={meshRef}>
        <bufferGeometry>
            <bufferAttribute attach="attributes-position" count={count} array={positions} itemSize={3} />
            <bufferAttribute attach="attributes-color" count={count} array={colors} itemSize={3} />
        </bufferGeometry>
        <pointsMaterial size={0.15} vertexColors transparent opacity={0.6} sizeAttenuation blending={THREE.AdditiveBlending} depthWrite={false} />
    </points>
  );
};

// --- NEW COMPONENT: Spiral Garland (Particle Line) ---
const SpiralGarland: React.FC<{ expansion: number; rotation: number }> = ({ expansion, rotation }) => {
    const count = 400;
    const ref = useRef<THREE.Points>(null);
    const geometryRef = useRef<THREE.BufferGeometry>(null);
    
    // Initial Spiral positions
    const initialData = useMemo(() => {
        const pos = new Float32Array(count * 3);
        for(let i=0; i<count; i++) {
            const t = i / count; // 0 to 1 (Bottom to Top)
            const y = t * 8.5 - 4.2; // -4.2 to 4.3
            const r = 4.0 * (1 - t) + 0.2; // Cone shape, slightly wider than tree
            const theta = t * Math.PI * 16; // 8 winds
            
            pos[i*3] = r * Math.cos(theta);
            pos[i*3+1] = y;
            pos[i*3+2] = r * Math.sin(theta);
        }
        return pos;
    }, []);

    useFrame((state) => {
        if (!geometryRef.current) return;
        
        const positions = geometryRef.current.attributes.position.array as Float32Array;
        const time = state.clock.elapsedTime;
        
        for(let i=0; i<count; i++) {
            const ix = i * 3;
            let x = initialData[ix];
            let y = initialData[ix+1];
            let z = initialData[ix+2];
            
            // Effect: When expanded, particles float out and become chaotic
            if (expansion > 0.05) {
                const noise = Math.sin(time * 2 + i * 0.2);
                x *= (1 + expansion * 2.5);
                y += Math.sin(time + i) * expansion;
                z *= (1 + expansion * 2.5);
                
                x += Math.cos(time + y) * expansion * 2;
                z += Math.sin(time + x) * expansion * 2;
            } else {
                // Breathing effect when tree is formed
                const breath = 1.0 + Math.sin(time * 2 + y) * 0.02;
                x *= breath;
                z *= breath;
            }

            // Apply Tree Rotation
            const rot = rotation;
            const rx = x * Math.cos(rot) - z * Math.sin(rot);
            const rz = x * Math.sin(rot) + z * Math.cos(rot);
            
            positions[ix] = rx;
            positions[ix+1] = y;
            positions[ix+2] = rz;
        }
        geometryRef.current.attributes.position.needsUpdate = true;
    });

    return (
        <points ref={ref}>
            <bufferGeometry ref={geometryRef}>
                <bufferAttribute attach="attributes-position" count={count} array={new Float32Array(count * 3)} itemSize={3} />
            </bufferGeometry>
            <pointsMaterial color="#ffcc00" size={0.12} sizeAttenuation transparent opacity={0.8} blending={THREE.AdditiveBlending} />
        </points>
    );
};

// Custom component for a single interactive photo on the tree
const PhotoOrnament: React.FC<{
  url: string;
  initialPos: THREE.Vector3;
  explosionPos: THREE.Vector3;
  rotationOffset: number;
  expansion: number;
  treeRotation: number;
  onSelect: (url: string | null) => void;
  isHovered: boolean;
}> = ({ url, initialPos, explosionPos, rotationOffset, expansion, treeRotation, onSelect, isHovered }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const uniforms = useMemo(() => ({
    uTexture: { value: null as THREE.Texture | null },
    uExpansion: { value: 0 },
    uTime: { value: 0 },
    uHighlight: { value: 0 },
  }), []);

  useEffect(() => {
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    loader.load(
        url,
        (tex) => {
            tex.colorSpace = THREE.SRGBColorSpace;
            setTexture(tex);
        },
        undefined,
        (err) => {
            console.warn(`Failed to load texture: ${url}`, err);
        }
    );
  }, [url]);

  useFrame((state) => {
    if (!meshRef.current || !materialRef.current) return;
    const time = state.clock.elapsedTime;

    // --- Position Logic (CPU) ---
    const currentPos = new THREE.Vector3().lerpVectors(initialPos, explosionPos, expansion * 0.95);
    
    if (expansion > 0.05) {
        currentPos.x += Math.cos(time * 0.8) * expansion * 1.5;
        currentPos.y += Math.sin(time * 0.5) * expansion * 1.0;
        currentPos.z += Math.sin(time + 2.0) * expansion * 1.5;
    } else {
        currentPos.y += Math.sin(time + initialPos.y) * 0.1;
    }

    const angle = treeRotation;
    const x = currentPos.x * Math.cos(angle) - currentPos.z * Math.sin(angle);
    const z = currentPos.x * Math.sin(angle) + currentPos.z * Math.cos(angle);
    currentPos.x = x;
    currentPos.z = z;

    meshRef.current.position.copy(currentPos);
    
    // Look at camera logic
    if (expansion > 0.1) {
        meshRef.current.rotation.x = time * 0.5;
        meshRef.current.rotation.z = time * 0.3;
    } else {
        meshRef.current.lookAt(0, currentPos.y, 0); 
        meshRef.current.rotation.y += Math.PI; 
    }

    // --- Shader Update ---
    materialRef.current.uniforms.uTexture.value = texture;
    materialRef.current.uniforms.uExpansion.value = expansion;
    materialRef.current.uniforms.uHighlight.value = isHovered ? 1.0 : 0.0;
  });

  return (
    <mesh 
        ref={meshRef} 
        onClick={() => onSelect(url)}
        scale={isHovered ? 1.1 : 1}
        userData={{ url }} // Store URL for raycaster
    >
      {/* Square geometry for perfect circle clip */}
      {/* @ts-ignore */}
      <planeGeometry args={[0.7, 0.7]} />
      {/* @ts-ignore */}
      <shaderMaterial 
        ref={materialRef}
        uniforms={uniforms}
        vertexShader={PhotoOrnamentShader.vertexShader}
        fragmentShader={PhotoOrnamentShader.fragmentShader}
        transparent={true}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
};

// Fix Star Orientation: Changed initial angle to point up
const Star: React.FC<{ rotation: number }> = ({ rotation }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  
  const starGeometry = useMemo(() => {
    const shape = new THREE.Shape();
    const points = 5;
    const outerRadius = 0.8;
    const innerRadius = 0.38;
    for (let i = 0; i < points * 2; i++) {
        // Change: Added + (Math.PI / 2) to rotate it 180 degrees so point is up
        const angle = (i * Math.PI) / points + (Math.PI / 2);
        const radius = i % 2 === 0 ? outerRadius : innerRadius;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        if (i === 0) shape.moveTo(x, y);
        else shape.lineTo(x, y);
    }
    shape.closePath();
    const geom = new THREE.ExtrudeGeometry(shape, {
        depth: 0.2, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.05, bevelSegments: 3
    });
    geom.center();
    return geom;
  }, []);

  useFrame((state) => {
    if (meshRef.current) {
        meshRef.current.rotation.y = rotation - state.clock.elapsedTime * 0.5;
        meshRef.current.position.y = 4.2 + Math.sin(state.clock.elapsedTime * 2) * 0.1;
    }
  });

  return (
    <mesh ref={meshRef} position={[0, 4.2, 0]} geometry={starGeometry}>
      {/* @ts-ignore */}
      <meshStandardMaterial emissive="#FFD700" emissiveIntensity={2} color="#FFD700" toneMapped={false} roughness={0.2} metalness={1.0} />
      {/* @ts-ignore */}
      <pointLight distance={6} intensity={2} color="#ffaa00" />
    </mesh>
  );
};

export const MagicTree: React.FC<MagicTreeProps> = ({ interaction, onPhotoSelect }) => {
  const spheresRef = useRef<THREE.InstancedMesh>(null);
  const boxesRef = useRef<THREE.InstancedMesh>(null);
  const sphereShaderRef = useRef<THREE.ShaderMaterial>(null);
  const boxShaderRef = useRef<THREE.ShaderMaterial>(null);
  
  const { camera, raycaster, scene } = useThree();

  const currentExpansion = useRef(0);
  const currentRotation = useRef(0);
  const targetRotation = useRef(0);
  
  // Interaction State
  const [hoveredPhotoIndex, setHoveredPhotoIndex] = useState<number | null>(null);
  const prevPinch = useRef(false);
  const holdingPhoto = useRef(false);

  // Constants
  const sphereCount = 2500; // Increased slightly
  const boxCount = 400;
  const treeHeight = 7.5;
  const baseRadius = 3.2;

  // Photo Data
  const photoUrls = [
    "/images/1.jpg",
    "/images/2.jpg",
    "/images/3.jpg",
    "/images/4.jpg",
    "/images/5.jpg",
    "/images/6.jpg",
    "/images/7.jpg",
    "/images/8.jpg",
    "/images/9.jpg",
    "/images/10.jpg",
    "/images/11.jpg",
    "/images/12.jpg",
    "/images/13.jpg",
    "/images/14.jpg",
    "/images/15.jpg",
    "/images/16.jpg",
    "/images/17.jpg",
    "/images/18.jpg",
    "/images/19.jpg",
    "/images/20.jpg",
  ];

  const photoData = useMemo(() => {
    // One-to-one: render every photo URL once
    const uniqueUrls = Array.from(new Set(photoUrls));
    return uniqueUrls.map((url, i) => {
        const yNorm = 0.2 + Math.random() * 0.6; // random vertical band
        const y = yNorm * treeHeight - (treeHeight / 2);
        const rMax = baseRadius * (1.0 - yNorm) + 0.5;
        const r = rMax * (0.8 + Math.random() * 0.2); // keep near surface, reduce overlap
        const theta = Math.random() * Math.PI * 2;

        const initialPos = new THREE.Vector3(r * Math.cos(theta), y, r * Math.sin(theta));

        const exR = 8 + Math.random() * 5;
        const exTheta = Math.random() * Math.PI * 2;
        const exPhi = Math.acos(2 * Math.random() - 1);
        const explosionPos = new THREE.Vector3(
            exR * Math.sin(exPhi) * Math.cos(exTheta),
            exR * Math.sin(exPhi) * Math.sin(exTheta),
            exR * Math.cos(exPhi)
        );

        return { url, initialPos, explosionPos, rotationOffset: Math.random() * Math.PI };
    });
  }, []);

  const generateData = (count: number, type: 'sphere' | 'box') => {
    const targetPos = new Float32Array(count * 3);
    const randomPos = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const scales = new Float32Array(count);
    const randomAxis = new Float32Array(count * 3);
    const speeds = new Float32Array(count);

    // Core palette: green, yellow, red, white
    const paletteGreen = [
      new THREE.Color('#1f6b2e'),
      new THREE.Color('#2f8f3e'),
      new THREE.Color('#3fae4f'),
    ];
    const colorYellow = new THREE.Color('#ffd700'); // gold/yellow
    const colorRed = new THREE.Color('#d93636');
    const colorWhite = new THREE.Color('#ffffff');

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      const yNorm = Math.pow(Math.random(), 0.9); 
      const y = yNorm * treeHeight - (treeHeight / 2);
      const rMax = baseRadius * (1.0 - yNorm);
      const r = rMax * Math.sqrt(Math.random()); 
      const theta = Math.random() * Math.PI * 2;
      const spiral = yNorm * 15.0;
      targetPos[i3] = r * Math.cos(theta + spiral);
      targetPos[i3 + 1] = y;
      targetPos[i3 + 2] = r * Math.sin(theta + spiral);

      const exR = 6 + Math.random() * 8;
      const exTheta = Math.random() * Math.PI * 2;
      const exPhi = Math.acos(2 * Math.random() - 1);
      randomPos[i3] = exR * Math.sin(exPhi) * Math.cos(exTheta);
      randomPos[i3 + 1] = exR * Math.sin(exPhi) * Math.sin(exTheta);
      randomPos[i3 + 2] = exR * Math.cos(exPhi);

      randomAxis[i3] = Math.random() - 0.5; randomAxis[i3+1] = Math.random() - 0.5; randomAxis[i3+2] = Math.random() - 0.5;

      if (type === 'sphere') {
        const rnd = Math.random();
        // Distribution: greens ~65%, yellow ~15%, red ~12%, white ~8%
        if (rnd < 0.65) {
          const col = paletteGreen[Math.floor(Math.random() * paletteGreen.length)];
          colors[i3] = col.r; colors[i3+1] = col.g; colors[i3+2] = col.b;
          scales[i] = 0.1 + Math.random() * 0.15; // foliage size
        } else if (rnd < 0.80) {
          colors[i3] = colorYellow.r; colors[i3+1] = colorYellow.g; colors[i3+2] = colorYellow.b;
          scales[i] = 0.15 + Math.random() * 0.12; // ornament size
        } else if (rnd < 0.92) {
          colors[i3] = colorRed.r; colors[i3+1] = colorRed.g; colors[i3+2] = colorRed.b;
          scales[i] = 0.14 + Math.random() * 0.12; // ornament size
        } else {
          colors[i3] = colorWhite.r; colors[i3+1] = colorWhite.g; colors[i3+2] = colorWhite.b;
          scales[i] = 0.09 + Math.random() * 0.06; // light size
        }
      } else {
        // Boxes as ornaments: mix yellow/red/white
        const rnd = Math.random();
        let col: THREE.Color;
        if (rnd < 0.4) col = colorYellow;
        else if (rnd < 0.75) col = colorRed;
        else col = colorWhite;
        colors[i3] = col.r; colors[i3+1] = col.g; colors[i3+2] = col.b;
        scales[i] = 0.2 + Math.random() * 0.15;
      }
      speeds[i] = 0.5 + Math.random();
    }
    return { targetPos, randomPos, colors, scales, randomAxis, speeds };
  };

  const sphereData = useMemo(() => generateData(sphereCount, 'sphere'), []);
  const boxData = useMemo(() => generateData(boxCount, 'box'), []);

  useFrame((state, delta) => {
    const time = state.clock.elapsedTime;
    
    // --- Update Tree State ---
    const targetExp = interaction.leftHand.isOpen ? 1.0 : 0.0;
    const lerpSpeed = interaction.leftHand.isOpen ? 2.5 : 3.5;
    currentExpansion.current = THREE.MathUtils.lerp(currentExpansion.current, targetExp, delta * lerpSpeed);

    targetRotation.current += delta * 0.2;
    currentRotation.current = THREE.MathUtils.lerp(currentRotation.current, targetRotation.current, delta * 4.0);

    if (sphereShaderRef.current) {
        sphereShaderRef.current.uniforms.uTime.value = time;
        sphereShaderRef.current.uniforms.uExpansion.value = currentExpansion.current;
        sphereShaderRef.current.uniforms.uRotation.value = currentRotation.current;
    }
    if (boxShaderRef.current) {
        boxShaderRef.current.uniforms.uTime.value = time;
        boxShaderRef.current.uniforms.uExpansion.value = currentExpansion.current;
        boxShaderRef.current.uniforms.uRotation.value = currentRotation.current;
    }

    // --- Raycasting for Right Hand Cursor ---
    const isPinching = interaction.rightHand.detected && interaction.rightHand.isPinching;
    const wasPinching = prevPinch.current;

    if (isPinching && !wasPinching) {
        raycaster.setFromCamera(
            new THREE.Vector2(interaction.rightHand.position.x, interaction.rightHand.position.y), 
            camera
        );
        const photoMeshes = scene.children.filter(c => c.type === 'Mesh' && (c as THREE.Mesh).geometry.type === 'PlaneGeometry'); 
        const intersects = raycaster.intersectObjects(photoMeshes);
        
        if (intersects.length > 0) {
            const hit = intersects[0].object;
             // @ts-ignore
            if (hit.userData && hit.userData.url) {
                onPhotoSelect(hit.userData.url);
                holdingPhoto.current = true;
            }
        } else if (currentExpansion.current > 0.5) {
            const randomUrl = photoUrls[Math.floor(Math.random() * photoUrls.length)];
            onPhotoSelect(randomUrl);
            holdingPhoto.current = true;
        }
    }

    if (holdingPhoto.current && !isPinching) {
        onPhotoSelect(null);
        holdingPhoto.current = false;
    }

    // Hover logic
    if (interaction.rightHand.detected && !holdingPhoto.current) {
        raycaster.setFromCamera(
            new THREE.Vector2(interaction.rightHand.position.x, interaction.rightHand.position.y), 
            camera
        );
        const photoMeshes = scene.children.filter(c => c.type === 'Mesh' && (c as THREE.Mesh).geometry.type === 'PlaneGeometry'); 
        const intersects = raycaster.intersectObjects(photoMeshes);
        
        if (intersects.length > 0) {
            const hit = intersects[0].object;
             // @ts-ignore
            if (hit.userData && hit.userData.url) {
                const src = hit.userData.url;
                const idx = photoData.findIndex(p => p.url === src);
                setHoveredPhotoIndex(idx);
            }
        } else {
            setHoveredPhotoIndex(null);
        }
    } else {
        setHoveredPhotoIndex(null);
    }

    prevPinch.current = isPinching;
  });

  return (
    <>
      <BackgroundParticles />
      <Star rotation={currentRotation.current} />
      <SpiralGarland expansion={currentExpansion.current} rotation={currentRotation.current} />

      {/* Instanced Meshes (Tree) */}
      {/* @ts-ignore */}
      <instancedMesh ref={spheresRef} args={[null, null, sphereCount]}>
        {/* @ts-ignore */}
        <sphereGeometry args={[1, 8, 8]}>
             {/* @ts-ignore */}
            <instancedBufferAttribute attach="attributes-aTargetPos" count={sphereCount} array={sphereData.targetPos} itemSize={3} />
             {/* @ts-ignore */}
            <instancedBufferAttribute attach="attributes-aRandomPos" count={sphereCount} array={sphereData.randomPos} itemSize={3} />
             {/* @ts-ignore */}
            <instancedBufferAttribute attach="attributes-aColor" count={sphereCount} array={sphereData.colors} itemSize={3} />
             {/* @ts-ignore */}
            <instancedBufferAttribute attach="attributes-aScale" count={sphereCount} array={sphereData.scales} itemSize={1} />
             {/* @ts-ignore */}
            <instancedBufferAttribute attach="attributes-aRandomAxis" count={sphereCount} array={sphereData.randomAxis} itemSize={3} />
             {/* @ts-ignore */}
            <instancedBufferAttribute attach="attributes-aSpeed" count={sphereCount} array={sphereData.speeds} itemSize={1} />
        </sphereGeometry>
        {/* @ts-ignore */}
        <shaderMaterial ref={sphereShaderRef} args={[InstanceShaderMaterial]} vertexColors />
      </instancedMesh>

      {/* @ts-ignore */}
      <instancedMesh ref={boxesRef} args={[null, null, boxCount]}>
        {/* @ts-ignore */}
        <boxGeometry args={[1, 1, 1]}>
             {/* @ts-ignore */}
            <instancedBufferAttribute attach="attributes-aTargetPos" count={boxCount} array={boxData.targetPos} itemSize={3} />
             {/* @ts-ignore */}
            <instancedBufferAttribute attach="attributes-aRandomPos" count={boxCount} array={boxData.randomPos} itemSize={3} />
             {/* @ts-ignore */}
            <instancedBufferAttribute attach="attributes-aColor" count={boxCount} array={boxData.colors} itemSize={3} />
             {/* @ts-ignore */}
            <instancedBufferAttribute attach="attributes-aScale" count={boxCount} array={boxData.scales} itemSize={1} />
             {/* @ts-ignore */}
            <instancedBufferAttribute attach="attributes-aRandomAxis" count={boxCount} array={boxData.randomAxis} itemSize={3} />
             {/* @ts-ignore */}
            <instancedBufferAttribute attach="attributes-aSpeed" count={boxCount} array={boxData.speeds} itemSize={1} />
        </boxGeometry>
        {/* @ts-ignore */}
        <shaderMaterial ref={boxShaderRef} args={[InstanceShaderMaterial]} vertexColors />
      </instancedMesh>

      {/* Photos */}
      {photoData.map((data, i) => (
        <PhotoOrnament 
            key={i} 
            {...data} 
            expansion={currentExpansion.current} 
            treeRotation={currentRotation.current}
            onSelect={onPhotoSelect}
            isHovered={hoveredPhotoIndex === i}
        />
      ))}
    </>
  );
};