/** Minimal robots.txt policy: obey Disallow for our UA and for `*`. Never used to bypass anything. */
export class RobotsPolicy {
  private disallowed: string[] = [];

  constructor(text: string, userAgent: string) {
    let applies = false;
    for (const rawLine of text.split('\n')) {
      const line = rawLine.split('#')[0]?.trim() ?? '';
      if (!line) continue;
      const [rawKey, ...rest] = line.split(':');
      const key = (rawKey ?? '').trim().toLowerCase();
      const value = rest.join(':').trim();
      if (key === 'user-agent') {
        applies = value === '*' || userAgent.toLowerCase().includes(value.toLowerCase());
      } else if (key === 'disallow' && applies && value) {
        this.disallowed.push(value);
      }
    }
  }

  isAllowed(url: string): boolean {
    let path: string;
    try {
      path = new URL(url).pathname;
    } catch {
      return false;
    }
    return !this.disallowed.some((rule) => path.startsWith(rule));
  }

  static allowAll(): RobotsPolicy {
    return new RobotsPolicy('', '*');
  }
}
