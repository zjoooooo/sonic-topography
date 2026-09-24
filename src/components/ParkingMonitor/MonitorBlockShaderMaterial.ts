import * as THREE from 'three';
import { shaderMaterial } from '@react-three/drei';
import { PARKING_SEVERITY_COLORS } from '../../lib/parkingMonitor';

/**
 * Status colours are written to the framebuffer as-is (the shader has no colour-space
 * conversion), so keep them in sRGB instead of letting THREE.Color convert to linear.
 */
export function rawColor(hex: string): THREE.Color {
  return new THREE.Color().setHex(parseInt(hex.replace('#', ''), 16), THREE.LinearSRGBColorSpace);
}

/**
 * One material for both the static ground grid and the parking-lot blocks.
 *
 * Per-instance attributes:
 *   aStatus  -1 = ground cell, 0 = ok, 1 = warning, 2 = major, 3 = critical
 *   aIndex   instance index, compared against uHoverIndex for the hover highlight
 */
export const MonitorBlockShaderMaterial = shaderMaterial(
  {
    uTime: 0,
    uHoverIndex: -1,
    uBaseColor1: new THREE.Color(0.01, 0.02, 0.04),
    uBaseColor2: new THREE.Color(0.03, 0.05, 0.09),
    uFogColor: new THREE.Color(0.01, 0.02, 0.04),
    uOkColor: rawColor(PARKING_SEVERITY_COLORS.ok),
    uWarningColor: rawColor(PARKING_SEVERITY_COLORS.warning),
    uMajorColor: rawColor(PARKING_SEVERITY_COLORS.major),
    uCriticalColor: rawColor(PARKING_SEVERITY_COLORS.critical),
  },
  // vertex shader
  `
    attribute float aStatus;
    attribute float aIndex;

    uniform float uHoverIndex;

    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vViewNormal;
    varying float vRelativeY;
    varying float vDistance;
    varying float vStatus;
    varying float vHover;

    void main() {
      vUv = uv;
      vNormal = normal;
      // Instances only translate and scale, so the object normal matrix is enough for shading.
      vViewNormal = normalize(normalMatrix * normal);

      vec4 instancePos = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      vDistance = length(instancePos.xz);

      // Geometry is a unit-height box scaled per instance, so this stays 0 (bottom) .. 1 (top).
      vRelativeY = position.y + 0.5;
      vStatus = aStatus;
      vHover = (uHoverIndex >= 0.0 && abs(aIndex - uHoverIndex) < 0.5) ? 1.0 : 0.0;

      gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    }
  `,
  // fragment shader
  `
    uniform float uTime;
    uniform vec3 uBaseColor1;
    uniform vec3 uBaseColor2;
    uniform vec3 uFogColor;
    uniform vec3 uOkColor;
    uniform vec3 uWarningColor;
    uniform vec3 uMajorColor;
    uniform vec3 uCriticalColor;

    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vViewNormal;
    varying float vRelativeY;
    varying float vDistance;
    varying float vStatus;
    varying float vHover;

    vec3 statusColor(float status) {
      if (status < 0.5) return uOkColor;
      if (status < 1.5) return uWarningColor;
      if (status < 2.5) return uMajorColor;
      return uCriticalColor;
    }

    void main() {
      bool isTop = vNormal.y > 0.5;
      bool isGround = vStatus < -0.5;

      float distFade = 1.0 - smoothstep(40.0, 75.0, vDistance);

      // Top-face edge lines, shared by ground cells and lot blocks.
      float edgeX = smoothstep(0.06, 0.02, vUv.x) + smoothstep(0.94, 0.98, vUv.x);
      float edgeY = smoothstep(0.06, 0.02, vUv.y) + smoothstep(0.94, 0.98, vUv.y);
      float edge = min(edgeX + edgeY, 1.0);

      vec3 finalColor;

      if (isGround) {
        vec3 body = mix(uBaseColor1, uBaseColor2, vRelativeY * distFade);
        if (isTop) {
          vec3 lift = mix(uBaseColor2, vec3(1.0), 0.05);
          finalColor = mix(uBaseColor2, lift, distFade);
          finalColor += mix(uBaseColor2, vec3(1.0), 0.14) * edge * 0.35 * distFade;
        } else {
          finalColor = body;
        }
      } else {
        vec3 c = statusColor(vStatus);
        bool isOk = vStatus < 0.5;
        // Healthy blocks are most of the wall: keep them a little calmer so alarms stand out.
        float intensity = isOk ? 0.85 : 1.0;
        vec3 tint = isOk ? mix(c, vec3(dot(c, vec3(0.3333))), 0.12) : c;
        if (isTop) {
          // Lit centre falling off toward the edges, then a pale rim so the top reads as a real face.
          float radial = smoothstep(0.0, 1.0, length(vUv - 0.5) * 1.6);
          float shade = mix(1.1, 0.84, radial);
          finalColor = tint * shade * intensity;
          finalColor += mix(tint, vec3(1.0), 0.55) * edge * 0.5 * intensity;
        } else {
          // Fixed key light in view space so the sides always show volume, whatever the platter angle.
          vec3 lightDir = normalize(vec3(-0.45, 0.35, 0.82));
          float faceLight = 0.5 + 0.5 * max(0.0, dot(normalize(vViewNormal), lightDir));
          float vertical = mix(0.45, 1.0, smoothstep(0.0, 1.0, vRelativeY));
          vec3 side = tint * faceLight * vertical * intensity;
          // Sink the base into the ground colour so the block sits in the platter instead of floating on it.
          side = mix(uBaseColor2, side, smoothstep(0.0, 0.16, vRelativeY));
          float rim = smoothstep(0.05, 0.0, 1.0 - vRelativeY);
          finalColor = side + mix(tint, vec3(1.0), 0.4) * rim * 0.45 * intensity;
        }
        finalColor = mix(finalColor, vec3(1.0), vHover * 0.28);
      }

      // Aerial perspective toward the horizon; lots keep more of their colour than the ground.
      float aerialFog = smoothstep(30.0, 65.0, vDistance);
      vec3 atmosphericColor = mix(uBaseColor1, uBaseColor2, 0.4);
      finalColor = mix(finalColor, atmosphericColor, aerialFog * (isGround ? 0.35 : 0.15));

      float alphaFade = 1.0 - smoothstep(55.0, 78.0, vDistance);
      float alpha = isGround ? alphaFade : max(alphaFade, 0.92);
      finalColor = mix(finalColor, uFogColor, (1.0 - alphaFade) * (isGround ? 0.45 : 0.15));

      gl_FragColor = vec4(finalColor, alpha);
    }
  `,
);

export type MonitorBlockShaderMaterialInstance = THREE.ShaderMaterial & {
  uTime: number;
  uHoverIndex: number;
  uBaseColor1: THREE.Color;
  uBaseColor2: THREE.Color;
  uFogColor: THREE.Color;
  uOkColor: THREE.Color;
  uWarningColor: THREE.Color;
  uMajorColor: THREE.Color;
  uCriticalColor: THREE.Color;
};
