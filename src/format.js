/**
 * Small text helpers for the interface.
 */

/**
 * Describes how long ago something happened, in words.
 * `timestamp` is in milliseconds since the epoch.
 */
export function formatRecordAge(timestamp, now = Date.now()) {
  if (!timestamp) return '';
  const seconds = Math.floor(Math.max(0, now - timestamp) / 1000);
  if (seconds < 45) return 'just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;

  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? '' : 's'} ago`;
}
