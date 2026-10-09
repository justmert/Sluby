import { useEffect, useState } from 'react';
import { onAnnounce } from '@/lib/announce';

/**
 * The live region behind lib/announce.ts, mounted once and empty, so the
 * first message is read like every later one. The same sentence twice in a
 * row is read twice: the region empties first, then takes the text a frame
 * later.
 */
export function Announcer() {
  const [message, setMessage] = useState('');

  useEffect(() => {
    let frame = 0;
    const off = onAnnounce((next) => {
      cancelAnimationFrame(frame);
      setMessage('');
      frame = requestAnimationFrame(() => setMessage(next));
    });
    return () => {
      off();
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {message}
    </div>
  );
}
