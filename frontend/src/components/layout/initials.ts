/** Two letters for the avatar: the first of the first two words of the name, or of the username. */
export function initialsOf(name: string, username: string): string {
  const words = (name.trim() || username.trim()).split(/[\s._-]+/).filter(Boolean);
  if (words.length === 0) return '?';
  const letters =
    words.length > 1 ? [...words[0]][0] + [...words[1]][0] : [...words[0]].slice(0, 2).join('');
  return letters.toLocaleUpperCase();
}
