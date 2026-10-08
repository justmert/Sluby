import type { ReactNode } from 'react';
import { LazyMotion, MotionConfig, type FeatureBundle, type LazyFeatureBundle } from 'motion/react';

const loadFeatures: LazyFeatureBundle = () => import('./features').then((mod) => mod.default);

interface MotionProviderProps {
  children: ReactNode;
  /** tests pass the bundle itself so features are there on the first render */
  features?: FeatureBundle | LazyFeatureBundle;
}

/**
 * Loads motion features for every `m` component below and makes them follow
 * the os reduced motion setting. `strict` throws if anything renders the full
 * `motion` component, which would pull the whole engine into the main chunk.
 */
export function MotionProvider({ children, features = loadFeatures }: MotionProviderProps) {
  return (
    <LazyMotion features={features} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}
