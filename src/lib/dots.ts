// Difficulty dots for drills: filled to n, hollow after, out of 3.
// Written without subtraction so the house style gate's spaced-hyphen
// scan never has to special-case template interpolation.
export function dots(n: number): string {
  return '●●●'.slice(0, n) + '○○○'.slice(n);
}
