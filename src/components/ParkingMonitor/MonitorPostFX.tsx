import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/**
 * Bloom settings for the monitor. The threshold is a linear luminance: alarm tops, rims and
 * beacons sit above it and glow; healthy blocks and the ground stay below it and remain calm.
 */
export const MONITOR_BLOOM = { strength: 0.45, radius: 0.3, threshold: 0.4 };

/**
 * Post-processing for the monitor scene: scene -> bloom -> sRGB output.
 * Takes over rendering from react-three-fiber (useFrame priority 1) and disables tone mapping so
 * the palette colours land on screen exactly as specified.
 */
export function MonitorPostFX({ getClearColor }: { getClearColor?: () => THREE.Color | null }) {
  const { gl, scene, camera, size } = useThree();

  const composer = useMemo(() => {
    const pixelRatio = gl.getPixelRatio();
    // Multisampled HDR target so block edges stay smooth once the renderer no longer draws to the canvas directly.
    const target = new THREE.WebGLRenderTarget(size.width * pixelRatio, size.height * pixelRatio, {
      type: THREE.HalfFloatType,
      samples: 4,
    });
    const instance = new EffectComposer(gl, target);
    instance.addPass(new RenderPass(scene, camera));
    instance.addPass(new UnrealBloomPass(new THREE.Vector2(size.width, size.height), MONITOR_BLOOM.strength, MONITOR_BLOOM.radius, MONITOR_BLOOM.threshold));
    instance.addPass(new OutputPass());
    return instance;
    // The size is applied by the effect below; recreating the composer on resize would leak targets.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, scene, camera]);

  useEffect(() => {
    composer.setPixelRatio(gl.getPixelRatio());
    composer.setSize(size.width, size.height);
  }, [composer, gl, size]);

  useEffect(() => {
    const previousToneMapping = gl.toneMapping;
    gl.toneMapping = THREE.NoToneMapping;
    return () => {
      gl.toneMapping = previousToneMapping;
      composer.dispose();
    };
  }, [gl, composer]);

  useFrame(() => {
    // RenderPass clears with whatever clear colour three last cached, and three converts that colour to
    // sRGB when it is set while the screen is bound. Bind a render target first so the cached value stays
    // linear; otherwise the output pass encodes the background twice and it turns light grey.
    const clearColor = getClearColor?.();
    if (clearColor) {
      gl.setRenderTarget(composer.readBuffer);
      gl.setClearColor(clearColor, 1);
      gl.setRenderTarget(null);
    }
    composer.render();
  }, 1);

  return null;
}
