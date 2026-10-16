import { configure } from '@testing-library/react';

// findBy* and waitFor default to 1 s, which a loaded ci runner misses
configure({ asyncUtilTimeout: 10_000 });
