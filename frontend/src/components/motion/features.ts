import { domMax } from 'motion/react';

// loaded on demand by MotionProvider so the animation engine stays out of the
// main chunk; domMax rather than domAnimation because lists use layout
export default domMax;
