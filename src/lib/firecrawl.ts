import "server-only";

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
const FIRECRAWL_BASE_URL = "https://api.firecrawl.dev/v1";

if (!FIRECRAWL_API_KEY) {
  console.warn(
    "Warning: FIRECRAWL_API_KEY is not set. Property scraping will fall back to mock data."
  );
}

// Types for Firecrawl API

export interface FirecrawlAction {
  type: "wait" | "click" | "write" | "press" | "scroll" | "screenshot";
  selector?: string;
  text?: string;
  key?: string;
  milliseconds?: number;
  direction?: "up" | "down";
  amount?: number;
}

export interface FirecrawlScrapeOptions {
  formats?: ("markdown" | "html" | "links" | "screenshot")[];
  onlyMainContent?: boolean;
  includeTags?: string[];
  excludeTags?: string[];
  waitFor?: number;
  timeout?: number;
  actions?: FirecrawlAction[];
}

export interface FirecrawlScrapeResult {
  success: boolean;
  data?: {
    markdown?: string;
    html?: string;
    links?: string[];
    metadata?: {
      title?: string;
      description?: string;
      language?: string;
      sourceURL?: string;
      statusCode?: number;
      [key: string]: unknown;
    };
    screenshot?: string;
  };
  error?: string;
}

export interface FirecrawlExtractOptions {
  prompt?: string;
  schema: Record<string, unknown>;
}

export interface FirecrawlExtractResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Check if Firecrawl is configured and available
 */
export function isFirecrawlConfigured(): boolean {
  return !!FIRECRAWL_API_KEY;
}

/**
 * Scrape a URL using Firecrawl
 * Supports actions for form filling and navigation
 */
export async function scrapeUrl(
  url: string,
  options: FirecrawlScrapeOptions = {}
): Promise<FirecrawlScrapeResult> {
  if (!FIRECRAWL_API_KEY) {
    return {
      success: false,
      error: "FIRECRAWL_API_KEY is not configured",
    };
  }

  try {
    const response = await fetch(`${FIRECRAWL_BASE_URL}/scrape`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
      },
      body: JSON.stringify({
        url,
        formats: options.formats || ["markdown", "links"],
        onlyMainContent: options.onlyMainContent ?? false,
        includeTags: options.includeTags,
        excludeTags: options.excludeTags,
        waitFor: options.waitFor,
        timeout: options.timeout || 30000,
        actions: options.actions,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Firecrawl scrape error: ${response.status} - ${errorText}`);
      return {
        success: false,
        error: `Firecrawl API error: ${response.status}`,
      };
    }

    const result = await response.json();
    return result as FirecrawlScrapeResult;
  } catch (error) {
    console.error("Firecrawl scrape exception:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Extract structured data from a URL using Firecrawl's LLM extraction
 */
export async function extractFromUrl<T>(
  url: string,
  options: FirecrawlExtractOptions
): Promise<FirecrawlExtractResult<T>> {
  if (!FIRECRAWL_API_KEY) {
    return {
      success: false,
      error: "FIRECRAWL_API_KEY is not configured",
    };
  }

  try {
    const response = await fetch(`${FIRECRAWL_BASE_URL}/scrape`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
      },
      body: JSON.stringify({
        url,
        formats: ["extract"],
        extract: {
          prompt: options.prompt,
          schema: options.schema,
        },
        timeout: 60000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Firecrawl extract error: ${response.status} - ${errorText}`);
      return {
        success: false,
        error: `Firecrawl API error: ${response.status}`,
      };
    }

    const result = await response.json();
    
    if (result.success && result.data?.extract) {
      return {
        success: true,
        data: result.data.extract as T,
      };
    }

    return {
      success: false,
      error: result.error || "Extraction returned no data",
    };
  } catch (error) {
    console.error("Firecrawl extract exception:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Helper to build form-filling actions for Firecrawl
 */
export function buildSearchActions(
  searchText: string,
  inputSelector: string = 'input[type="text"]',
  submitSelector?: string
): FirecrawlAction[] {
  const actions: FirecrawlAction[] = [
    { type: "wait", milliseconds: 1000 },
    { type: "write", selector: inputSelector, text: searchText },
  ];

  if (submitSelector) {
    actions.push({ type: "click", selector: submitSelector });
  } else {
    actions.push({ type: "press", key: "Enter" });
  }

  actions.push({ type: "wait", milliseconds: 2000 });

  return actions;
}
