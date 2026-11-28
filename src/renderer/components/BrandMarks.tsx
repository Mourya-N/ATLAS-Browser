import React from 'react';

interface MarkProps {
  className?: string;
}

/**
 * LAVRAY Browser primary geometric mark:
 * Architectural folded "L" prism piercing an open browser horizon aperture with a forward ray.
 */
export const LavrayMark: React.FC<MarkProps> = ({ className = 'h-5 w-5' }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
    <path
      d="M13.5 3.75A8.25 8.25 0 1 0 20.25 10.5"
      stroke="currentColor"
      strokeOpacity="0.48"
      strokeWidth="1.7"
      strokeLinecap="round"
    />
    <path
      d="M7.25 6.25V15.5C7.25 16.47 8.03 17.25 9 17.25H16.5"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M8.4 16.1L19.25 4.75"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
    />
    <circle cx="19.25" cy="4.75" r="1.45" fill="currentColor" />
  </svg>
);

/**
 * HAYAGRIVA (HAYA) AI Agent geometric emblem:
 * Precision 4-point prismatic intelligence star nestled inside a minimal orbital arc.
 */
export const HayaMark: React.FC<MarkProps> = ({ className = 'h-4 w-4' }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
    <circle
      cx="12"
      cy="12"
      r="9"
      stroke="currentColor"
      strokeOpacity="0.32"
      strokeWidth="1.4"
      strokeDasharray="36 12"
    />
    <path
      d="M12 4.25L13.9 10.1L19.75 12L13.9 13.9L12 19.75L10.1 13.9L4.25 12L10.1 10.1L12 4.25Z"
      fill="currentColor"
    />
  </svg>
);
