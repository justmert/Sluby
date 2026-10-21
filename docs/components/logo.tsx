// same mark as the studio favicon (frontend/public/favicon.svg)
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <rect width="32" height="32" rx="8" fill="#0f6b7a" />
      <path
        d="M23 8.75h-9a3.625 3.625 0 0 0 0 7.25h4a3.625 3.625 0 0 1 0 7.25H9"
        fill="none"
        stroke="#fff"
        strokeWidth="4"
        strokeLinejoin="round"
      />
    </svg>
  );
}
