export interface FetchedPage {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  html: string;
  bytes: number;
  /** Present only when a rendering adapter supplied layout facts (build spec §11). */
  layout?: RenderedLayout;
  screenshotBase64?: string;
}

export interface RenderedElementBox {
  selector: string;
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fontSizePx: number;
  aboveFold: boolean;
}

export interface RenderedLayout {
  viewport: { width: number; height: number };
  elements: RenderedElementBox[];
}

export interface CrawlBudget {
  maxRequests: number;
  maxBytes: number;
  maxRedirects: number;
  timeoutMs: number;
  userAgent: string;
}

export interface CrawlStats {
  requests: number;
  bytes: number;
}

export interface CrawlAdapter {
  readonly name: string;
  fetchPage(url: string): Promise<FetchedPage>;
  stats(): CrawlStats;
  close?(): Promise<void>;
}
