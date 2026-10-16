/** Stage text for the progress line. */
export function stageText(stage: string, progress: number): string {
  switch (stage) {
    case 'checking': return 'Checking your topic…';
    case 'planning': return 'Planning 4 big ideas…';
    case 'writing': {
      if (progress > 0.6) return 'Writing a few more questions…';
      const n = Math.max(0, Math.min(4, Math.round(((progress - 0.15) / 0.45) * 4)));
      return `Writing questions ${n}/4…`;
    }
    case 'fixing': return 'Polishing questions…';
    case 'reviewing': return 'Double-checking answers…';
    default: return 'Almost there…';
  }
}
