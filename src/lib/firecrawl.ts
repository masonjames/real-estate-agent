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

/**
 * Form field definition for multi-field forms
 */
export interface FormFieldFill {
  selector: string;       // CSS selector for the input
  value: string;          // Value to enter
  clearFirst?: boolean;   // Clear existing value first
  isDropdown?: boolean;   // Is this a select/dropdown
}

/**
 * Options for building form fill actions
 */
export interface FormFillOptions {
  preActions?: FirecrawlAction[];     // Actions before filling form
  fields: FormFieldFill[];            // Fields to fill
  submit?: {
    selector?: string;                // Submit button selector
    pressEnter?: boolean;             // Press Enter instead of clicking
  };
  postActions?: FirecrawlAction[];    // Actions after submit
  waitBetweenFields?: number;         // Ms to wait between fields (default 300)
  waitAfterSubmit?: number;           // Ms to wait after submit (default 3000)
}

/**
 * Build complex multi-field form filling actions for Firecrawl
 * Supports clearing fields, dropdowns, and multiple input fields
 */
export function buildFormFillActions(options: FormFillOptions): FirecrawlAction[] {
  const actions: FirecrawlAction[] = [];
  const waitBetween = options.waitBetweenFields ?? 300;
  const waitAfterSubmit = options.waitAfterSubmit ?? 3000;

  // Pre-actions (e.g., clicking a tab, waiting for page load)
  if (options.preActions) {
    actions.push(...options.preActions);
  }

  // Initial wait for form to be ready
  actions.push({ type: "wait", milliseconds: 1000 });

  // Fill each field
  for (const field of options.fields) {
    // Skip empty values
    if (!field.value) continue;

    // Clear field first if requested
    if (field.clearFirst) {
      actions.push({ type: "click", selector: field.selector });
      actions.push({ type: "wait", milliseconds: 100 });
      // Select all and delete
      actions.push({ type: "press", key: "Meta+a" }); // Cmd+A on Mac
      actions.push({ type: "wait", milliseconds: 50 });
      actions.push({ type: "press", key: "Backspace" });
      actions.push({ type: "wait", milliseconds: 100 });
    }

    if (field.isDropdown) {
      // For dropdowns, click to open then type to filter/select
      actions.push({ type: "click", selector: field.selector });
      actions.push({ type: "wait", milliseconds: 300 });
      actions.push({ type: "write", selector: field.selector, text: field.value });
      actions.push({ type: "wait", milliseconds: 200 });
      actions.push({ type: "press", key: "Enter" });
    } else {
      // Regular text input
      actions.push({ type: "write", selector: field.selector, text: field.value });
    }

    actions.push({ type: "wait", milliseconds: waitBetween });
  }

  // Submit the form
  if (options.submit) {
    if (options.submit.pressEnter) {
      actions.push({ type: "press", key: "Enter" });
    } else if (options.submit.selector) {
      actions.push({ type: "click", selector: options.submit.selector });
    }
  }

  // Wait for results to load
  actions.push({ type: "wait", milliseconds: waitAfterSubmit });

  // Post-actions (e.g., clicking on first result)
  if (options.postActions) {
    actions.push(...options.postActions);
  }

  return actions;
}

/**
 * Build Manatee PAO specific search actions
 *
 * IMPORTANT: Based on browser inspection of the PAO search form (https://www.manateepao.gov/search/):
 *
 * ACTUAL FORM STRUCTURE (discovered via dev-browser inspection):
 * - Main field checkboxes are ALREADY CHECKED AND DISABLED - no need to click them!
 * - Input IDs: #OwnLast, #OwnFirst, #ParcelId, #Address, #Zip
 * - Property Type dropdown: #RollType (Bootstrap Select, already has REAL PROPERTY selected)
 * - Postal City: Bootstrap Select dropdown
 * - Search button: input[type="submit"].btn-success
 *
 * The form expects:
 * - Wildcards (*) in owner name and parcel ID fields for address searches
 * - Address in the #Address field (has typeahead)
 * - City selected from dropdown (optional)
 * - Zipcode in #Zip field (optional)
 */
export function buildManateePaoSearchActions(params: {
  situsAddress?: string;
  city?: string;
  zipCode?: string;
  ownerLastName?: string;
  ownerFirstName?: string;
  parcelId?: string;
  useWildcards?: boolean;
}): FirecrawlAction[] {
  const actions: FirecrawlAction[] = [];
  const useWildcards = params.useWildcards ?? true;

  // Wait for dynamic form to load completely
  actions.push({ type: "wait", milliseconds: 3000 });

  // Step 1: Fill Owner Last Name with wildcard (field is already enabled)
  actions.push({ type: "click", selector: '#OwnLast' });
  actions.push({ type: "wait", milliseconds: 100 });
  actions.push({ type: "write", selector: '#OwnLast', text: useWildcards ? "*" : (params.ownerLastName || "*") });
  actions.push({ type: "wait", milliseconds: 200 });

  // Step 2: Fill Owner First Name with wildcard
  actions.push({ type: "click", selector: '#OwnFirst' });
  actions.push({ type: "wait", milliseconds: 100 });
  actions.push({ type: "write", selector: '#OwnFirst', text: useWildcards ? "*" : (params.ownerFirstName || "*") });
  actions.push({ type: "wait", milliseconds: 200 });

  // Step 3: Fill Parcel ID with wildcard
  actions.push({ type: "click", selector: '#ParcelId' });
  actions.push({ type: "wait", milliseconds: 100 });
  actions.push({ type: "write", selector: '#ParcelId', text: params.parcelId || "*" });
  actions.push({ type: "wait", milliseconds: 200 });

  // Step 4: Property Type - REAL PROPERTY is already selected by default, skip this

  // Step 5: Fill Situs Address (THE MAIN SEARCH FIELD - has typeahead)
  if (params.situsAddress) {
    actions.push({ type: "click", selector: '#Address' });
    actions.push({ type: "wait", milliseconds: 100 });
    actions.push({ type: "write", selector: '#Address', text: params.situsAddress });
    // Wait for typeahead to settle
    actions.push({ type: "wait", milliseconds: 500 });
    // Press Escape to close any typeahead dropdown
    actions.push({ type: "press", key: "Escape" });
    actions.push({ type: "wait", milliseconds: 200 });
  }

  // Step 6: Fill Zipcode (optional but helps narrow results)
  if (params.zipCode) {
    actions.push({ type: "click", selector: '#Zip' });
    actions.push({ type: "wait", milliseconds: 100 });
    actions.push({ type: "write", selector: '#Zip', text: params.zipCode });
    actions.push({ type: "wait", milliseconds: 200 });
  }

  // Step 7: Click the green Search button (submit)
  actions.push({ type: "wait", milliseconds: 300 });
  actions.push({ type: "click", selector: 'input[type="submit"].btn-success, input.btn.btn-success' });

  // Step 8: Wait for results to load (PAO site can be slow)
  actions.push({ type: "wait", milliseconds: 5000 });

  return actions;
}

/**
 * Build actions to navigate from PAO search results to detail page
 * Clicks on the first matching result link
 */
export function buildPaoResultClickActions(): FirecrawlAction[] {
  return [
    { type: "wait", milliseconds: 1000 },
    // Try various selectors for result links
    {
      type: "click",
      selector: 'table a[href*="parcel"], .results a, .search-results a, a[href*="detail"], a[href*="account"]',
    },
    { type: "wait", milliseconds: 3000 },
  ];
}
