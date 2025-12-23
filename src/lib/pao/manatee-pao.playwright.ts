/**
 * Manatee County PAO Scraper - Playwright Implementation
 *
 * Replaces Firecrawl-based automation with Playwright for more reliable
 * form filling and deterministic result parsing.
 *
 * Key improvements over Firecrawl:
 * - Deterministic HTML parsing (no LLM hallucination)
 * - Proper "no results" detection
 * - Better error handling and debugging
 */

import "server-only";
import * as cheerio from "cheerio";
import { withPage, PlaywrightError, detectBlocking } from "@/lib/playwright/browser";
import type { Page, Frame } from "playwright-core";
import type {
  PropertyDetails,
  ValuationRecord,
  SaleRecord,
  PropertyBuilding,
  PropertyLand,
  PropertyBasicInfo,
  ExtraFeatureRecord,
  InspectionRecord,
} from "@/lib/property-search";

// ============================================================================
// Configuration
// ============================================================================

const PAO_SEARCH_URL = "https://www.manateepao.gov/search/";
const PAO_BASE_URL = "https://www.manateepao.gov";

// Form field selectors (discovered via browser inspection)
const SELECTORS = {
  // Text inputs
  ownerLast: "#OwnLast",
  ownerFirst: "#OwnFirst",
  parcelId: "#ParcelId",
  address: "#Address",
  zipCode: "#Zip",
  // Dropdowns
  rollType: "#RollType",
  postalCity: "#PostalCity",
  // Submit button
  submit: 'input[type="submit"].btn-success, input.btn.btn-success',
  // Results table
  resultsTable: "table.table, .search-results table, #searchResults table",
  resultsRow: "tbody tr",
  // No results indicator
  noResults: ".no-results, .alert-info, .alert-warning",
  // Detail page iframe (property data is loaded inside this iframe)
  detailIframe: 'iframe#skelOwnerContentIFrame, iframe[name="skelOwnerContentIFrame"]',
};

// ============================================================================
// Types
// ============================================================================

/** Extraction scope: iframeOnly is fast but partial, full includes JS-controlled sections */
export type ManateePaoScrapeScope = "iframeOnly" | "full";

export interface ManateePaoPlaywrightOptions {
  timeoutMs?: number;
  navTimeoutMs?: number;
  debug?: boolean;
  /** Extraction scope: "iframeOnly" for fast partial, "full" for complete data (default: "full") */
  scope?: ManateePaoScrapeScope;
  /** Prefetched iframe HTML from a previous search step (used for fast iframe-only extraction) */
  prefetched?: {
    detailUrl: string;
    iframeHtml: string;
    iframeUrl?: string;
  };
}

/** Result from finding a detail URL, optionally including prefetched iframe content */
export interface ManateePaoDetailUrlResult {
  detailUrl: string | null;
  debug: Record<string, unknown>;
  /** Prefetched iframe HTML if we already landed on the detail page */
  prefetched?: {
    detailUrl: string;
    iframeHtml: string;
    iframeUrl?: string;
  };
}

/** Result from the combined search + extract orchestrator */
export interface ManateePaoScrapeResult {
  detailUrl: string | null;
  scraped: Partial<PropertyDetails>;
  debug: Record<string, unknown>;
}

interface SearchRow {
  href: string | null;
  text: string;
  parcelId: string | null;
}

interface AddressParts {
  street?: string;
  city?: string;
  state?: string;
  zipCode?: string;
}

// ============================================================================
// Iframe Helpers
// ============================================================================

/**
 * Wait for the owner content iframe to be available and loaded with REAL content
 * (not just the skeleton placeholder skelA.html)
 */
async function waitForOwnerIframe(page: Page, timeoutMs: number): Promise<Frame> {
  // Wait for iframe element to be attached to DOM
  await page.waitForSelector(SELECTORS.detailIframe, {
    state: "attached",
    timeout: timeoutMs,
  });

  // Try to get frame by name first
  let frame = page.frame({ name: "skelOwnerContentIFrame" });

  // If not found by name, try via element handle
  if (!frame) {
    const iframeHandle = await page.$(SELECTORS.detailIframe);
    if (iframeHandle) {
      frame = await iframeHandle.contentFrame();
    }
  }

  if (!frame) {
    throw new PlaywrightError(
      "Could not access owner content iframe - frame not found",
      "PARSE_ERROR"
    );
  }

  // Wait for iframe document to be ready
  await frame.waitForLoadState("domcontentloaded");

  // CRITICAL: Wait for REAL content, not the skeleton placeholder (skelA.html)
  // The skeleton page is tiny and has no property data
  // Real content has parcel info, owner data, etc.
  const maxWaitTime = Math.min(timeoutMs, 30000);
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitTime) {
    const frameUrl = frame.url();
    const content = await frame.content();

    // Check if we're still on the skeleton page
    const isSkeletonPage = frameUrl.includes("skelA.html") ||
                           frameUrl.includes("skelB.html") ||
                           content.length < 2500;

    // Check for real property content markers
    const hasRealContent = content.toLowerCase().includes("parcel") ||
                          content.toLowerCase().includes("owner") ||
                          content.toLowerCase().includes("situs") ||
                          content.toLowerCase().includes("jurisdiction");

    if (!isSkeletonPage && hasRealContent) {
      console.log(`[PAO Playwright] Iframe loaded real content (${content.length} chars)`);
      return frame;
    }

    // Wait a bit and check again
    await page.waitForTimeout(500);

    // Re-acquire frame reference in case it was replaced
    frame = page.frame({ name: "skelOwnerContentIFrame" });
    if (!frame) {
      const iframeHandle = await page.$(SELECTORS.detailIframe);
      if (iframeHandle) {
        frame = await iframeHandle.contentFrame();
      }
    }

    if (!frame) {
      throw new PlaywrightError(
        "Iframe disappeared while waiting for content",
        "PARSE_ERROR"
      );
    }
  }

  // If we timed out waiting for real content, return what we have but log a warning
  console.warn("[PAO Playwright] Timed out waiting for real iframe content, using current state");
  return frame;
}

/**
 * Get the HTML content from the owner content iframe
 * Waits for the iframe to load and for content to be ready
 */
async function getOwnerIframeHtml(
  page: Page,
  timeoutMs: number
): Promise<{ iframeHtml: string; iframeUrl?: string }> {
  const frame = await waitForOwnerIframe(page, timeoutMs);

  // Wait for meaningful content inside the iframe
  // Try to wait for a table (valuations, sales, etc.) or specific content markers
  try {
    await frame.waitForSelector("table, .owner-info, #ownerInfo, .parcel-info", {
      timeout: Math.min(timeoutMs, 15000),
    });
  } catch {
    // If no specific element found, use a heuristic - wait for body to have content
    console.log("[PAO Playwright] No specific content marker found, using content length heuristic");
    try {
      await frame.waitForFunction(
        () => (document.body?.innerText?.length ?? 0) > 200,
        { timeout: Math.min(timeoutMs, 10000) }
      );
    } catch {
      console.log("[PAO Playwright] Content length heuristic timed out, continuing with available content");
    }
  }

  const iframeHtml = await frame.content();
  const iframeUrl = frame.url();

  console.log(`[PAO Playwright] Iframe content length: ${iframeHtml.length} chars`);
  console.log(`[PAO Playwright] Iframe URL: ${iframeUrl}`);

  return { iframeHtml, iframeUrl };
}

// ============================================================================
// Main Page JavaScript Section Extraction
// ============================================================================

/**
 * Click a JavaScript button on the main page and wait for content to appear
 * Returns the HTML of the revealed section, or null if failed
 *
 * NOTE: These buttons may not be available until the page fully loads.
 * We use short timeouts and don't fail the whole extraction if this fails.
 */
async function clickAndExtractSection(
  page: Page,
  buttonSelector: string,
  contentSelector: string,
  timeoutMs: number = 5000 // Short timeout - don't block for long
): Promise<string | null> {
  try {
    // Check if button exists and is visible/enabled
    const button = await page.$(buttonSelector);
    if (!button) {
      console.log(`[PAO Playwright] Button not found: ${buttonSelector}`);
      return null;
    }

    // Check if button is enabled before clicking
    const isDisabled = await button.evaluate((el) => {
      const htmlEl = el as HTMLElement;
      return htmlEl.hasAttribute("disabled") ||
             htmlEl.getAttribute("aria-disabled") === "true" ||
             htmlEl.classList.contains("disabled") ||
             getComputedStyle(htmlEl).pointerEvents === "none";
    });

    if (isDisabled) {
      console.log(`[PAO Playwright] Button is disabled: ${buttonSelector}`);
      return null;
    }

    // Use force: true to bypass actionability checks (the PAO site's JS may be slow)
    await button.click({ timeout: 3000, force: true });

    // Wait for content to appear (short timeout)
    try {
      await page.waitForSelector(contentSelector, {
        state: "visible",
        timeout: timeoutMs,
      });
    } catch {
      // Content selector not found - try getting whatever appeared
      console.log(`[PAO Playwright] Content selector ${contentSelector} not found after click`);
    }

    // Small delay for any animations/transitions
    await page.waitForTimeout(300);

    // Get the section content
    const sectionHandle = await page.$(contentSelector);
    if (!sectionHandle) {
      return null;
    }

    const sectionHtml = await sectionHandle.innerHTML();
    return sectionHtml;
  } catch (error) {
    // Log but don't throw - main page sections are optional
    const errorMsg = error instanceof Error ? error.message.split("\n")[0] : String(error);
    console.log(`[PAO Playwright] Section extraction skipped (${buttonSelector}): ${errorMsg}`);
    return null;
  }
}

/**
 * Extract owner/property info from the main page .owner-content section
 * NOTE: This data is NOT in the iframe - the iframe is just a CSS skeleton!
 */
async function extractOwnerInfoFromMainPage(page: Page): Promise<string | null> {
  console.log("[PAO Playwright] Extracting owner info from main page...");

  try {
    // The owner content is in .owner-content or .card-body.owner-content
    const ownerContent = await page.$(".owner-content, .card-body.owner-content");
    if (ownerContent) {
      const html = await page.evaluate((el) => el.innerHTML, ownerContent);
      console.log(`[PAO Playwright] Found owner content: ${html?.length || 0} chars`);
      return html;
    }
  } catch {
    console.log("[PAO Playwright] Could not find .owner-content");
  }

  // Fallback: try to get the first card body in the property card section
  try {
    const propertyCard = await page.$("#property-card .card-body, .property-card .card-body");
    if (propertyCard) {
      const html = await page.evaluate((el) => el.innerHTML, propertyCard);
      return html;
    }
  } catch {
    // Continue
  }

  return null;
}

/**
 * Click a tab and extract the pane content.
 * Resolves pane ID from tab's aria-controls, data-bs-target, or href attributes.
 */
async function clickTabAndExtract(
  page: Page,
  tabHref: string,
  description: string
): Promise<string | null> {
  try {
    console.log(`[PAO Playwright] Clicking ${description} tab (${tabHref})...`);

    const hrefId = tabHref.replace("#", "");

    // Try multiple selector patterns - Bootstrap uses various conventions
    const tabSelectors = [
      `a[href="${tabHref}"]`,
      `a[href$="${tabHref}"]`,  // Ends with (for full URLs with hash)
      `.nav-link[href="${tabHref}"]`,
      `[aria-controls="${hrefId}"]`,
      `[data-bs-target="${tabHref}"]`,
      `button[data-bs-target="${tabHref}"]`,
      // Text-based fallback
      `.nav-link:has-text("${description}")`,
      `a.nav-link:has-text("${description}")`,
    ];

    let tab = null;
    let usedSelector = "";
    for (const selector of tabSelectors) {
      try {
        tab = await page.$(selector);
        if (tab) {
          usedSelector = selector;
          break;
        }
      } catch {
        // Continue to next selector
      }
    }

    if (!tab) {
      console.log(`[PAO Playwright] ${description} tab not found with any selector`);
      return null;
    }

    console.log(`[PAO Playwright] Found ${description} tab with: ${usedSelector}`);

    // Get the pane ID from the tab element's attributes BEFORE clicking
    const paneSelector = await tab.evaluate((el) => {
      // Priority: aria-controls > data-bs-target > href
      const ariaControls = el.getAttribute("aria-controls");
      if (ariaControls) return `#${ariaControls}`;

      const dataBsTarget = el.getAttribute("data-bs-target");
      if (dataBsTarget) return dataBsTarget; // Already includes #

      const href = el.getAttribute("href");
      if (href) {
        // Handle both "#id" and "url#id" formats
        const hashIndex = href.indexOf("#");
        if (hashIndex !== -1) {
          return href.substring(hashIndex);
        }
      }

      return null;
    });

    console.log(`[PAO Playwright] Resolved pane selector: ${paneSelector}`);

    // Click the tab
    await tab.click();
    await page.waitForTimeout(500); // Wait for tab transition

    // Try to find the pane using resolved selector
    if (paneSelector) {
      const pane = await page.$(paneSelector);
      if (pane) {
        // Wait for pane to have content (dynamic loading)
        await page.waitForTimeout(300);
        const html = await page.evaluate((el) => el.innerHTML, pane);
        if (html && html.length > 50) {
          console.log(`[PAO Playwright] ${description} content: ${html.length} chars`);
          return html;
        }
      }
    }

    // Fallback: Look for any active tab pane near the clicked tab
    const fallbackHtml = await page.evaluate((desc) => {
      // Find active tab pane
      const activePanes = document.querySelectorAll(".tab-pane.active, .tab-pane.show");
      for (const pane of activePanes) {
        const text = pane.textContent?.toLowerCase() || "";
        // Check if this pane likely matches our tab based on content
        if (desc.toLowerCase() === "inspections" && (text.includes("inspection") || text.includes("inspector"))) {
          return pane.innerHTML;
        }
        if (desc.toLowerCase() === "features" && (text.includes("feature") || text.includes("extra"))) {
          return pane.innerHTML;
        }
      }
      return null;
    }, description);

    if (fallbackHtml && fallbackHtml.length > 50) {
      console.log(`[PAO Playwright] ${description} content (fallback): ${fallbackHtml.length} chars`);
      return fallbackHtml;
    }

    console.log(`[PAO Playwright] ${description} pane not found or empty`);
    return null;
  } catch (e) {
    const msg = e instanceof Error ? e.message.split('\n')[0] : String(e);
    console.log(`[PAO Playwright] Failed to extract ${description}: ${msg}`);
    return null;
  }
}

/**
 * Extract data from all sections on the main page
 *
 * PAGE STRUCTURE (discovered via browser inspection):
 * - Owner info: .owner-content (NOT in iframe - iframe is just a CSS skeleton!)
 * - Sales card tabs: Sales (default) | Exemptions | Businesses | Addresses | Inspections
 * - Values card tabs: Values (default) | Land | Buildings | Features | Permits
 *
 * Tables have specific IDs: #tableSales, #tableValue
 * Tabs use href attributes: a[href="#inspections"], a[href="#features"]
 */
async function extractMainPageSections(
  page: Page,
  _timeoutMs: number = 5000
): Promise<{
  ownerHtml: string | null;
  valueHistoryHtml: string | null;
  salesHtml: string | null;
  featuresHtml: string | null;
  inspectionsHtml: string | null;
}> {
  console.log("[PAO Playwright] Extracting main page sections...");

  // ===== OWNER INFO =====
  // This is on the main page in .owner-content, NOT in the iframe
  const ownerHtml = await extractOwnerInfoFromMainPage(page);

  // ===== VISIBLE BY DEFAULT: Values and Sales Tables =====
  // The PAO site uses specific table IDs: #tableValue and #tableSales

  console.log("[PAO Playwright] Extracting Values table (#tableValue)...");
  let valueHistoryHtml: string | null = null;
  try {
    const valueTable = await page.$("#tableValue");
    if (valueTable) {
      valueHistoryHtml = await page.evaluate((el) => el.outerHTML, valueTable);
      console.log(`[PAO Playwright] Found Values table: ${valueHistoryHtml?.length || 0} chars`);
    }
  } catch {
    console.log("[PAO Playwright] Could not find #tableValue");
  }

  console.log("[PAO Playwright] Extracting Sales table (#tableSales)...");
  let salesHtml: string | null = null;
  try {
    const salesTable = await page.$("#tableSales");
    if (salesTable) {
      salesHtml = await page.evaluate((el) => el.outerHTML, salesTable);
      console.log(`[PAO Playwright] Found Sales table: ${salesHtml?.length || 0} chars`);
    }
  } catch {
    console.log("[PAO Playwright] Could not find #tableSales");
  }

  // ===== TAB-BASED SECTIONS: Inspections and Features =====
  // These are in tab panes - click the tab to reveal content
  // Tab hrefs: #inspections (in Sales card), #features (in Values card)

  const inspectionsHtml = await clickTabAndExtract(page, "#inspections", "Inspections");
  const featuresHtml = await clickTabAndExtract(page, "#features", "Features");

  console.log(`[PAO Playwright] Main page sections extracted:`, {
    owner: ownerHtml ? `${ownerHtml.length} chars` : "NOT FOUND",
    valueHistory: valueHistoryHtml ? `${valueHistoryHtml.length} chars` : "NOT FOUND",
    sales: salesHtml ? `${salesHtml.length} chars` : "NOT FOUND",
    features: featuresHtml ? `${featuresHtml.length} chars` : "not found",
    inspections: inspectionsHtml ? `${inspectionsHtml.length} chars` : "not found",
  });

  return { ownerHtml, valueHistoryHtml, salesHtml, featuresHtml, inspectionsHtml };
}

/**
 * Parse extra features from HTML
 */
function parseExtraFeaturesFromHtml(html: string): ExtraFeatureRecord[] {
  const $ = cheerio.load(html);
  const features: ExtraFeatureRecord[] = [];

  // Look for feature tables or lists
  $("table tr, .feature-row, li").each((_, row) => {
    const $row = $(row);
    const text = $row.text().trim();

    // Skip headers
    if ($row.find("th").length > 0 || !text) return;

    const cells = $row.find("td");
    if (cells.length >= 1) {
      const description = $(cells[0]).text().trim();
      if (!description) return;

      const feature: ExtraFeatureRecord = { description };

      // Try to extract year, area, value from other cells
      cells.each((i, cell) => {
        if (i === 0) return; // Skip description
        const cellText = $(cell).text().trim();

        // Year pattern (4 digits)
        const yearMatch = cellText.match(/\b(19|20)\d{2}\b/);
        if (yearMatch && !feature.year) {
          feature.year = parseInt(yearMatch[0], 10);
        }

        // Area pattern (sq ft)
        const areaMatch = cellText.match(/([\d,]+)\s*(?:sq\s*ft|SF)/i);
        if (areaMatch && !feature.areaSqFt) {
          feature.areaSqFt = parseNumber(areaMatch[1]);
        }

        // Value pattern (money)
        const valueMatch = cellText.match(/\$[\d,]+/);
        if (valueMatch && !feature.value) {
          feature.value = parseMoney(valueMatch[0]);
        }
      });

      features.push(feature);
    }
  });

  return features;
}

/**
 * Parse inspections from HTML
 */
function parseInspectionsFromHtml(html: string): InspectionRecord[] {
  const $ = cheerio.load(html);
  const inspections: InspectionRecord[] = [];

  // Look for inspection tables
  $("table tr").each((_, row) => {
    const $row = $(row);

    // Skip headers
    if ($row.find("th").length > 0) return;

    const cells = $row.find("td");
    if (cells.length >= 2) {
      const inspection: InspectionRecord = {};

      cells.each((i, cell) => {
        const cellText = $(cell).text().trim();
        if (!cellText) return;

        // Date pattern
        if (!inspection.date && /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(cellText)) {
          inspection.date = cellText.match(/\d{1,2}\/\d{1,2}\/\d{2,4}/)?.[0];
        }
        // Type (usually first or second column)
        else if (i <= 1 && !inspection.type && cellText.length > 2 && cellText.length < 50) {
          inspection.type = cellText;
        }
        // Result/Status
        else if (!inspection.result && /pass|fail|complete|pending|approved/i.test(cellText)) {
          inspection.result = cellText;
        }
        // Inspector name (if it looks like a name)
        else if (!inspection.inspector && /^[A-Z][a-z]+ [A-Z]/.test(cellText)) {
          inspection.inspector = cellText;
        }
        // Notes (longer text)
        else if (!inspection.notes && cellText.length > 20) {
          inspection.notes = cellText;
        }
      });

      // Only add if we have at least date or type
      if (inspection.date || inspection.type) {
        inspections.push(inspection);
      }
    }
  });

  return inspections;
}

// ============================================================================
// Property Data Helpers (Parsing & Merging)
// ============================================================================

/**
 * Parse iframe HTML into property details (pure function, no Playwright)
 */
function parseIframePropertyHtml(
  iframeHtml: string,
  detailUrl: string
): Partial<PropertyDetails> {
  const $ = cheerio.load(iframeHtml);
  return extractPropertyData($, detailUrl);
}

/**
 * Parse owner/property info from main page HTML using DOM extraction
 * This extracts the same data that was previously in the iframe
 *
 * The .owner-content section has a structure like:
 * <div class="row">
 *   <div class="col">
 *     <div class="row"><div class="col font-weight-bold">Label</div></div>
 *     <div class="row"><div class="col">Value</div></div>
 *   </div>
 * </div>
 *
 * Or label-value pairs in adjacent elements.
 */
function parseOwnerInfoFromMainPageHtml(html: string): Partial<PropertyDetails> {
  const $ = cheerio.load(html);
  const details: Partial<PropertyDetails> = {
    basicInfo: {},
    building: {},
    land: {},
  };

  /**
   * Extract a field value by searching for a label in the DOM
   * Uses multiple strategies to find label-value pairs
   */
  const extractFieldFromDom = (labels: string[]): string | undefined => {
    for (const label of labels) {
      const lowerLabel = label.toLowerCase();

      // Strategy 1: Find bold label followed by value in adjacent div
      // <div class="font-weight-bold">Label</div> followed by value
      let found: string | undefined;
      $(".font-weight-bold, strong, b, .label").each((_, el) => {
        const labelText = $(el).text().toLowerCase().trim();
        if (labelText.includes(lowerLabel) || labelText.replace(/[:\s]/g, '') === lowerLabel.replace(/[:\s]/g, '')) {
          // Look for value in next sibling, parent's next sibling, or next row
          const parent = $(el).parent();
          const nextEl = $(el).next();
          const parentNext = parent.next();

          // Try next element
          if (nextEl.length && !nextEl.hasClass("font-weight-bold")) {
            const val = nextEl.text().trim();
            if (val && val.length > 0 && val.length < 500) {
              found = val;
              return false; // break
            }
          }

          // Try parent's next sibling (common in row-based layouts)
          if (!found && parentNext.length) {
            const val = parentNext.text().trim();
            if (val && val.length > 0 && val.length < 500 && !val.toLowerCase().includes(lowerLabel)) {
              found = val;
              return false;
            }
          }

          // Try adjacent column in same row
          const parentRow = parent.closest(".row");
          if (!found && parentRow.length) {
            const cols = parentRow.find(".col, .col-sm, [class*='col-']");
            let foundLabel = false;
            cols.each((_, col) => {
              const colText = $(col).text().trim();
              if (foundLabel && colText && !colText.toLowerCase().includes(lowerLabel)) {
                found = colText;
                return false;
              }
              if (colText.toLowerCase().includes(lowerLabel)) {
                foundLabel = true;
              }
            });
          }
        }
      });

      if (found) return found;

      // Strategy 2: Look for dt/dd pattern
      const ddValue = $(`dt:contains("${label}")`).next("dd").text().trim();
      if (ddValue) return ddValue;

      // Strategy 3: Look for table cells
      $("tr").each((_, row) => {
        const cells = $(row).find("td, th");
        cells.each((i, cell) => {
          if ($(cell).text().toLowerCase().includes(lowerLabel) && cells[i + 1]) {
            const value = $(cells[i + 1]).text().trim();
            if (value && value !== "-" && value !== "N/A") {
              found = value;
              return false;
            }
          }
        });
        if (found) return false;
      });

      if (found) return found;

      // Strategy 4: Look for any element containing the label followed by text
      $("div, span, p").each((_, el) => {
        const text = $(el).text();
        const labelIndex = text.toLowerCase().indexOf(lowerLabel);
        if (labelIndex !== -1) {
          // Extract text after the label
          const afterLabel = text.substring(labelIndex + label.length);
          // Clean up: remove leading colons/spaces, take first line
          const cleaned = afterLabel.replace(/^[:\s]+/, '').split('\n')[0].trim();
          // Make sure we're not just getting another label
          if (cleaned && cleaned.length > 0 && cleaned.length < 200 && !/^[A-Z][a-z]+:/.test(cleaned)) {
            found = cleaned;
            return false;
          }
        }
      });

      if (found) return found;
    }
    return undefined;
  };

  /**
   * Clean a value string - remove extra whitespace, links, trailing text
   */
  const cleanValue = (value: string | undefined): string | undefined => {
    if (!value) return undefined;
    return value
      .replace(/Go to.*$/i, '')
      .replace(/\[.*?\]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  };

  // Extract ownership info
  const ownership = extractFieldFromDom(['Ownership', 'Owner']);
  if (ownership) {
    // Owner name is usually the first part before semicolons or newlines
    const ownerName = ownership.split(/[;\n]/)[0].trim();
    // Clean up any trailing dates or extra info
    details.owner = ownerName.replace(/\s+\d{1,2}\/\d{1,2}\/\d{4}.*$/, '').trim();
  }

  const ownerType = cleanValue(extractFieldFromDom(['Owner Type']));
  if (ownerType && details.basicInfo) {
    details.basicInfo.ownerType = ownerType;
  }

  // Extract address
  const situsAddress = cleanValue(extractFieldFromDom(['Situs Address', 'Property Address', 'Site Address']));
  if (situsAddress) {
    details.address = situsAddress;
    // Try to parse city, state, zip
    // Format: "123 MAIN ST, BRADENTON FL 34208" or "123 MAIN ST, BRADENTON, FL 34208"
    const addressMatch = situsAddress.match(/^(.+?),\s*([A-Z]+)\s+(\d{5}(?:-\d{4})?)/i) ||
                         situsAddress.match(/^(.+?),\s*([^,]+),?\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)/i);
    if (addressMatch) {
      if (addressMatch.length === 5) {
        // Second pattern: street, city, state zip
        details.city = addressMatch[2]?.trim();
        details.state = addressMatch[3];
        details.zipCode = addressMatch[4];
      } else {
        // First pattern: street city, state zip
        const streetCity = addressMatch[1];
        const lastComma = streetCity.lastIndexOf(',');
        if (lastComma !== -1) {
          details.city = streetCity.substring(lastComma + 1).trim();
        }
        details.state = addressMatch[2];
        details.zipCode = addressMatch[3];
      }
    }
  }

  // Extract jurisdiction
  const jurisdiction = cleanValue(extractFieldFromDom(['Jurisdiction']));
  if (jurisdiction && details.basicInfo) {
    details.basicInfo.jurisdiction = jurisdiction;
  }

  // Extract tax district
  const taxDistrict = cleanValue(extractFieldFromDom(['Tax District']));
  if (taxDistrict && details.basicInfo) {
    details.basicInfo.taxDistrict = taxDistrict;
  }

  // Extract neighborhood
  const neighborhood = cleanValue(extractFieldFromDom(['Neighborhood']));
  if (neighborhood && details.basicInfo) {
    details.basicInfo.neighborhood = neighborhood;
  }

  // Extract subdivision
  const subdivision = cleanValue(extractFieldFromDom(['Subdivision']));
  if (subdivision && details.basicInfo) {
    details.basicInfo.subdivision = subdivision;
  }

  // Extract land use
  const landUse = cleanValue(extractFieldFromDom(['Land Use']));
  if (landUse && details.land) {
    details.land.landUse = landUse;
  }

  // Extract land size
  const landSize = extractFieldFromDom(['Land Size']);
  if (landSize && details.land) {
    const acresMatch = landSize.match(/([\d.]+)\s*Acres?/i);
    if (acresMatch) {
      details.land.lotSizeAcres = parseFloat(acresMatch[1]);
    }
    const sqftMatch = landSize.match(/([\d,]+)\s*(?:Square\s*Feet|Sq\s*Ft|SF)/i);
    if (sqftMatch) {
      details.land.lotSizeSqFt = parseNumber(sqftMatch[1]);
    }
  }

  // Extract building area
  const buildingArea = extractFieldFromDom(['Building Area']);
  if (buildingArea && details.building) {
    const underRoofMatch = buildingArea.match(/([\d,]+)\s*(?:SqFt|Sq\s*Ft|SF)?\s*Under\s*Roof/i);
    if (underRoofMatch) {
      details.building.totalAreaSqFt = parseNumber(underRoofMatch[1]);
    }
    const livingMatch = buildingArea.match(/([\d,]+)\s*(?:SqFt|Sq\s*Ft|SF)?\s*Living/i);
    if (livingMatch) {
      details.building.livingAreaSqFt = parseNumber(livingMatch[1]);
    }
  }

  // Extract living units
  const livingUnits = extractFieldFromDom(['Living Units']);
  if (livingUnits) {
    const units = parseInt(livingUnits, 10);
    if (!isNaN(units) && details.basicInfo) {
      details.basicInfo.livingUnits = units;
    }
  }

  // Extract short description
  const shortDesc = cleanValue(extractFieldFromDom(['Short Description']));
  if (shortDesc && details.basicInfo) {
    details.basicInfo.shortDescription = shortDesc;
  }

  return details;
}

/**
 * Extract all data from main page sections
 * Returns parsed property data (owner info, valuations, sales, features, inspections)
 */
async function extractSupplementalFromMainPage(
  page: Page,
  timeoutMs: number
): Promise<Partial<PropertyDetails>> {
  const sections = await extractMainPageSections(page, timeoutMs);
  let supplemental: Partial<PropertyDetails> = {};

  // Parse owner info from main page (NOT iframe!)
  if (sections.ownerHtml) {
    supplemental = parseOwnerInfoFromMainPageHtml(sections.ownerHtml);
    console.log(`[PAO Playwright] Parsed owner info: ${supplemental.owner || 'unknown'}`);
  }

  // Parse value history
  if (sections.valueHistoryHtml) {
    const $values = cheerio.load(sections.valueHistoryHtml);
    supplemental.valuations = parseValuationsTable($values);
    console.log(`[PAO Playwright] Parsed ${supplemental.valuations?.length || 0} valuation records`);
  }

  // Parse sales history
  if (sections.salesHtml) {
    const $sales = cheerio.load(sections.salesHtml);
    supplemental.salesHistory = parseSalesTable($sales);
    console.log(`[PAO Playwright] Parsed ${supplemental.salesHistory?.length || 0} sale records`);
  }

  // Parse features
  if (sections.featuresHtml) {
    const paoExtraFeatures = parseExtraFeaturesFromHtml(sections.featuresHtml);
    if (paoExtraFeatures.length > 0) {
      supplemental.extras = { ...supplemental.extras, paoExtraFeatures };
      console.log(`[PAO Playwright] Parsed ${paoExtraFeatures.length} extra features`);
    }
  }

  // Parse inspections
  if (sections.inspectionsHtml) {
    const inspections = parseInspectionsFromHtml(sections.inspectionsHtml);
    if (inspections.length > 0) {
      supplemental.extras = { ...supplemental.extras, inspections };
      console.log(`[PAO Playwright] Parsed ${inspections.length} inspection records`);
    }
  }

  return supplemental;
}

/**
 * Merge base property details with supplemental data, avoiding duplicates
 * Supplemental values override base values for scalar fields if base is missing
 */
function mergePropertyDetails(
  base: Partial<PropertyDetails>,
  supplemental: Partial<PropertyDetails>
): Partial<PropertyDetails> {
  const merged = { ...base };

  // Merge scalar fields - supplemental fills in missing values
  // These are the key fields extracted from .owner-content on main page
  if (!merged.owner && supplemental.owner) {
    merged.owner = supplemental.owner;
  }
  if (!merged.address && supplemental.address) {
    merged.address = supplemental.address;
  }
  if (!merged.city && supplemental.city) {
    merged.city = supplemental.city;
  }
  if (!merged.state && supplemental.state) {
    merged.state = supplemental.state;
  }
  if (!merged.zipCode && supplemental.zipCode) {
    merged.zipCode = supplemental.zipCode;
  }
  if (!merged.ownerType && supplemental.ownerType) {
    merged.ownerType = supplemental.ownerType;
  }

  // Merge basicInfo object (deep merge)
  if (supplemental.basicInfo) {
    merged.basicInfo = merged.basicInfo || {};
    // Copy each field from supplemental if not present in base
    for (const [key, value] of Object.entries(supplemental.basicInfo)) {
      if (value !== undefined && (merged.basicInfo as Record<string, unknown>)[key] === undefined) {
        (merged.basicInfo as Record<string, unknown>)[key] = value;
      }
    }
  }

  // Merge building object (deep merge)
  if (supplemental.building) {
    merged.building = merged.building || {};
    for (const [key, value] of Object.entries(supplemental.building)) {
      if (value !== undefined && (merged.building as Record<string, unknown>)[key] === undefined) {
        (merged.building as Record<string, unknown>)[key] = value;
      }
    }
  }

  // Merge land object (deep merge)
  if (supplemental.land) {
    merged.land = merged.land || {};
    for (const [key, value] of Object.entries(supplemental.land)) {
      if (value !== undefined && (merged.land as Record<string, unknown>)[key] === undefined) {
        (merged.land as Record<string, unknown>)[key] = value;
      }
    }
  }

  // Merge valuations (avoid duplicates by year)
  if (supplemental.valuations && supplemental.valuations.length > 0) {
    const existingYears = new Set((merged.valuations || []).map((v) => v.year));
    const newValuations = supplemental.valuations.filter((v) => !existingYears.has(v.year));
    merged.valuations = [...(merged.valuations || []), ...newValuations];
  }

  // Merge sales history (avoid duplicates by date)
  if (supplemental.salesHistory && supplemental.salesHistory.length > 0) {
    const existingDates = new Set((merged.salesHistory || []).map((s) => s.date));
    const newSales = supplemental.salesHistory.filter((s) => !existingDates.has(s.date));
    merged.salesHistory = [...(merged.salesHistory || []), ...newSales];
  }

  // Merge extras (features, inspections)
  if (supplemental.extras) {
    merged.extras = merged.extras || {};
    if (supplemental.extras.paoExtraFeatures) {
      merged.extras.paoExtraFeatures = supplemental.extras.paoExtraFeatures;
    }
    if (supplemental.extras.inspections) {
      merged.extras.inspections = supplemental.extras.inspections;
    }
  }

  return merged;
}

// ============================================================================
// Page-Scoped Primitives (accept Page, don't own browser lifecycle)
// ============================================================================

/**
 * Find detail URL by address on an existing page (page-scoped, no withPage)
 * This is the internal primitive used by the orchestrator
 */
async function findManateePaoDetailUrlOnPage(
  page: Page,
  address: string,
  options?: ManateePaoPlaywrightOptions
): Promise<{
  detailUrl: string | null;
  addressFound: boolean;
  alreadyOnDetailPage: boolean;
  debug: Record<string, unknown>;
}> {
  const navTimeoutMs = options?.navTimeoutMs || 45000;
  const debug: Record<string, unknown> = {
    address,
    startTime: new Date().toISOString(),
  };

  const parsedAddress = parseAddress(address);
  debug.parsedAddress = parsedAddress;

  // Navigate to search page
  console.log("[PAO Playwright] Navigating to search page...");
  await page.goto(PAO_SEARCH_URL, { waitUntil: "domcontentloaded" });

  // Wait for form to be ready
  await page.waitForSelector(SELECTORS.address, { timeout: 10000 });
  console.log("[PAO Playwright] Search form loaded");

  // Check for blocking
  const pageContent = await page.content();
  const blockCheck = detectBlocking(pageContent);
  if (blockCheck.blocked) {
    throw new PlaywrightError(
      `PAO site blocking detected: ${blockCheck.reason}`,
      "BLOCKED"
    );
  }

  // Fill the search form
  await fillSearchForm(page, parsedAddress);
  console.log("[PAO Playwright] Form filled, submitting...");

  // Submit the form
  const submitButton = await page.$(SELECTORS.submit);
  if (!submitButton) {
    throw new PlaywrightError("Submit button not found", "PARSE_ERROR");
  }

  // Click and wait for navigation
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: navTimeoutMs }),
    submitButton.click(),
  ]);

  // Wait for results/detail page
  try {
    await page.waitForSelector(
      `${SELECTORS.detailIframe}, ${SELECTORS.resultsTable}, ${SELECTORS.noResults}, table.table`,
      { timeout: navTimeoutMs }
    );
  } catch {
    console.log("[PAO Playwright] No specific result indicator found, continuing...");
  }

  await page.waitForTimeout(1000);

  // Get results page content
  const resultsHtml = await page.content();
  const currentUrl = page.url();
  debug.resultsPageLength = resultsHtml.length;
  debug.resultsUrl = currentUrl;

  // Check if we landed directly on a parcel detail page
  const directParcelMatch = currentUrl.match(/[?&]parid=(\d{10})/i);
  if (directParcelMatch) {
    console.log(`[PAO Playwright] Direct navigation to detail page! Parcel ID: ${directParcelMatch[1]}`);
    return {
      detailUrl: currentUrl,
      addressFound: true,
      alreadyOnDetailPage: true,
      debug,
    };
  }

  // Check for blocking on results page
  const resultsBlockCheck = detectBlocking(resultsHtml);
  if (resultsBlockCheck.blocked) {
    throw new PlaywrightError(
      `PAO site blocking on results: ${resultsBlockCheck.reason}`,
      "BLOCKED"
    );
  }

  // Parse search results
  const rows = parseSearchResults(resultsHtml);
  debug.rowsFound = rows.length;

  if (rows.length === 0) {
    debug.noResultsDetected = detectNoResults(resultsHtml);
    return { detailUrl: null, addressFound: false, alreadyOnDetailPage: false, debug };
  }

  // Find best matching row
  const match = selectBestResult(rows, address);
  debug.matchResult = match;

  if (!match.href) {
    return { detailUrl: null, addressFound: match.addressFound, alreadyOnDetailPage: false, debug };
  }

  // Construct full URL
  const detailUrl = match.href.startsWith("http")
    ? match.href
    : `${PAO_BASE_URL}${match.href.startsWith("/") ? "" : "/"}${match.href}`;

  return {
    detailUrl,
    addressFound: match.addressFound,
    alreadyOnDetailPage: false,
    debug,
  };
}

/**
 * Extract property data from a detail page (page-scoped, assumes we're on the detail page)
 * This is the internal primitive used by the orchestrator
 */
async function extractManateePaoPropertyFromDetailPage(
  page: Page,
  detailUrl: string,
  options?: ManateePaoPlaywrightOptions
): Promise<{ scraped: Partial<PropertyDetails>; debug: Record<string, unknown> }> {
  const navTimeoutMs = options?.navTimeoutMs || 45000;
  const scope = options?.scope || "full";
  const debug: Record<string, unknown> = {
    detailUrl,
    scope,
    startTime: new Date().toISOString(),
  };

  // Get outer page content for blocking check
  const outerHtml = await page.content();
  debug.outerHtmlLength = outerHtml.length;

  const blockCheck = detectBlocking(outerHtml);
  if (blockCheck.blocked) {
    throw new PlaywrightError(
      `PAO detail page blocking: ${blockCheck.reason}`,
      "BLOCKED"
    );
  }

  // Extract iframe content
  console.log("[PAO Playwright] Waiting for owner content iframe...");
  const { iframeHtml, iframeUrl } = await getOwnerIframeHtml(page, navTimeoutMs);
  debug.iframeHtmlLength = iframeHtml.length;
  debug.iframeUrl = iframeUrl;

  // Check blocking in iframe
  const iframeBlockCheck = detectBlocking(iframeHtml);
  if (iframeBlockCheck.blocked) {
    throw new PlaywrightError(
      `PAO iframe content blocking: ${iframeBlockCheck.reason}`,
      "BLOCKED"
    );
  }

  // Parse iframe data
  let scraped = parseIframePropertyHtml(iframeHtml, detailUrl);
  debug.iframeFieldsExtracted = Object.keys(scraped).filter(
    (k) => scraped[k as keyof typeof scraped] !== undefined
  ).length;

  // If scope is "full", also extract main page sections
  if (scope === "full") {
    console.log("[PAO Playwright] Extracting main page JavaScript sections...");
    try {
      const supplemental = await extractSupplementalFromMainPage(page, navTimeoutMs);
      scraped = mergePropertyDetails(scraped, supplemental);
      debug.mainPageSectionsExtracted = true;
      debug.supplementalValuations = supplemental.valuations?.length || 0;
      debug.supplementalSales = supplemental.salesHistory?.length || 0;
      debug.supplementalFeatures = supplemental.extras?.paoExtraFeatures?.length || 0;
      debug.supplementalInspections = supplemental.extras?.inspections?.length || 0;
    } catch (error) {
      debug.mainPageSectionsError = error instanceof Error ? error.message : String(error);
      console.warn("[PAO Playwright] Failed to extract main page sections:", error);
    }
  } else {
    debug.mainPageSectionsSkipped = true;
  }

  debug.totalFieldsExtracted = Object.keys(scraped).filter(
    (k) => scraped[k as keyof typeof scraped] !== undefined
  ).length;

  return { scraped, debug };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Search the PAO site and find the detail page URL for an address
 * Returns null if no matching property is found (NOT a fake result)
 *
 * When a single result is found (direct redirect to detail page), this function
 * will prefetch the iframe HTML to avoid a redundant navigation in extraction.
 */
export async function findManateePaoDetailUrlByAddressPlaywright(
  address: string,
  options?: ManateePaoPlaywrightOptions
): Promise<ManateePaoDetailUrlResult> {
  const timeoutMs = options?.timeoutMs || 60000;
  const navTimeoutMs = options?.navTimeoutMs || 45000;
  const debug: Record<string, unknown> = {
    address,
    startTime: new Date().toISOString(),
  };

  const parsedAddress = parseAddress(address);
  debug.parsedAddress = parsedAddress;

  try {
    const result = await withPage(
      async (page) => {
        // Navigate to search page
        console.log("[PAO Playwright] Navigating to search page...");
        await page.goto(PAO_SEARCH_URL, { waitUntil: "domcontentloaded" });

        // Wait for form to be ready
        await page.waitForSelector(SELECTORS.address, { timeout: 10000 });
        console.log("[PAO Playwright] Search form loaded");

        // Check for blocking
        const pageContent = await page.content();
        const blockCheck = detectBlocking(pageContent);
        if (blockCheck.blocked) {
          throw new PlaywrightError(
            `PAO site blocking detected: ${blockCheck.reason}`,
            "BLOCKED"
          );
        }

        // Fill the search form
        await fillSearchForm(page, parsedAddress);
        console.log("[PAO Playwright] Form filled, submitting...");

        // Submit the form - use navigation wait pattern for form POST
        // The PAO site does a form POST which causes full page navigation
        const submitButton = await page.$(SELECTORS.submit);
        if (!submitButton) {
          throw new PlaywrightError("Submit button not found", "PARSE_ERROR");
        }

        // Click and wait for navigation to complete
        await Promise.all([
          page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: navTimeoutMs }),
          submitButton.click(),
        ]);

        // Wait for either results table, no-results message, or detail iframe (direct redirect)
        // This is more deterministic than networkidle
        try {
          await page.waitForSelector(
            `${SELECTORS.detailIframe}, ${SELECTORS.resultsTable}, ${SELECTORS.noResults}, table.table`,
            { timeout: navTimeoutMs }
          );
        } catch {
          console.log("[PAO Playwright] No specific result indicator found, continuing...");
        }

        // Brief wait for any dynamic content to settle
        await page.waitForTimeout(1000);

        // Get results page content
        const resultsHtml = await page.content();
        const currentUrl = page.url();
        debug.resultsPageLength = resultsHtml.length;
        debug.resultsUrl = currentUrl;
        console.log(`[PAO Playwright] Results page URL: ${currentUrl}`);
        console.log(`[PAO Playwright] Results page length: ${resultsHtml.length} chars`);

        // Check if we landed directly on a parcel detail page (single result auto-redirect)
        // PAO site skips the results list when there's exactly one match
        const directParcelMatch = currentUrl.match(/[?&]parid=(\d{10})/i);
        if (directParcelMatch) {
          const parcelId = directParcelMatch[1];
          console.log(`[PAO Playwright] Direct navigation to parcel detail page! Parcel ID: ${parcelId}`);

          // Prefetch iframe HTML since we're already on the detail page
          // This avoids a redundant browser navigation in extractManateePaoPropertyPlaywright
          let prefetched: ManateePaoDetailUrlResult["prefetched"] | undefined;
          try {
            console.log("[PAO Playwright] Prefetching iframe content from detail page...");
            const { iframeHtml, iframeUrl } = await getOwnerIframeHtml(page, navTimeoutMs);
            prefetched = {
              detailUrl: currentUrl,
              iframeHtml,
              iframeUrl,
            };
            console.log(`[PAO Playwright] Prefetched iframe: ${iframeHtml.length} chars`);
          } catch (prefetchError) {
            // Non-fatal: extraction can still navigate to the page itself
            console.warn("[PAO Playwright] Could not prefetch iframe, extraction will navigate:", prefetchError);
          }

          return {
            detailUrl: currentUrl,
            addressFound: true,
            prefetched,
          };
        }

        // Check for blocking on results page
        const resultsBlockCheck = detectBlocking(resultsHtml);
        if (resultsBlockCheck.blocked) {
          throw new PlaywrightError(
            `PAO site blocking on results: ${resultsBlockCheck.reason}`,
            "BLOCKED"
          );
        }

        // Parse search results (we're on a results list page)
        const rows = parseSearchResults(resultsHtml);
        debug.rowsFound = rows.length;
        console.log(`[PAO Playwright] Found ${rows.length} result rows`);
        
        // Log first few rows for debugging
        if (rows.length > 0) {
          console.log(`[PAO Playwright] First row: ${rows[0].text.substring(0, 100)}...`);
          console.log(`[PAO Playwright] First row href: ${rows[0].href}`);
        } else {
          // Log a snippet of the page to help debug
          const bodyText = resultsHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
          console.log(`[PAO Playwright] Page text snippet: ${bodyText.substring(0, 500)}...`);
        }

        // Check for no results
        if (rows.length === 0) {
          const noResultsDetected = detectNoResults(resultsHtml);
          debug.noResultsDetected = noResultsDetected;
          console.log("[PAO Playwright] No results found for this address");
          return { detailUrl: null, addressFound: false };
        }

        // Find the best matching row
        const match = selectBestResult(rows, address);
        debug.matchResult = match;

        if (!match.href) {
          console.log("[PAO Playwright] No matching result found for address");
          return { detailUrl: null, addressFound: match.addressFound };
        }

        // Construct full URL
        const detailUrl = match.href.startsWith("http")
          ? match.href
          : `${PAO_BASE_URL}${match.href.startsWith("/") ? "" : "/"}${match.href}`;

        console.log(`[PAO Playwright] Found detail URL: ${detailUrl}`);
        return { detailUrl, addressFound: match.addressFound };
      },
      { opTimeoutMs: timeoutMs, navTimeoutMs }
    );

    debug.detailUrl = result.detailUrl;
    debug.addressFound = result.addressFound;
    debug.hasPrefetchedIframe = !!result.prefetched;
    debug.success = true;

    // Important: Only return URL if address was actually found in results
    // This prevents scraping the wrong property
    if (result.detailUrl && !result.addressFound) {
      console.warn("[PAO Playwright] Rejecting URL because searched address was not found in results");
      return { detailUrl: null, debug };
    }

    return {
      detailUrl: result.detailUrl,
      debug,
      prefetched: result.prefetched,
    };
  } catch (error) {
    debug.error = error instanceof Error ? error.message : String(error);
    debug.errorType = error instanceof PlaywrightError ? error.code : "UNKNOWN";
    debug.success = false;

    console.error("[PAO Playwright] Search failed:", debug.error);

    // Re-throw blocking errors
    if (error instanceof PlaywrightError && error.code === "BLOCKED") {
      throw error;
    }

    return { detailUrl: null, debug };
  }
}

/**
 * Extract property details from a PAO detail page
 * Uses deterministic HTML parsing (Cheerio) instead of LLM extraction
 *
 * The PAO detail pages load property data inside an iframe (skelOwnerContentIFrame).
 * This function extracts HTML from that iframe and parses it with Cheerio.
 *
 * If prefetched iframe HTML is provided (from findManateePaoDetailUrlByAddressPlaywright),
 * it skips browser navigation entirely and parses directly.
 */
export async function extractManateePaoPropertyPlaywright(
  detailUrl: string,
  options?: ManateePaoPlaywrightOptions
): Promise<{ scraped: Partial<PropertyDetails>; debug: Record<string, unknown> }> {
  const timeoutMs = options?.timeoutMs || 60000;
  const navTimeoutMs = options?.navTimeoutMs || 45000;
  const debug: Record<string, unknown> = {
    detailUrl,
    startTime: new Date().toISOString(),
  };

  // Fast path: use prefetched iframe HTML if available (skips Playwright navigation)
  // NOTE: When using prefetched mode, we only get iframe data (basic property info).
  // Main page sections (value history, sales, features, inspections) require browser navigation.
  if (options?.prefetched?.iframeHtml) {
    console.log("[PAO Playwright] Using prefetched iframe HTML - skipping browser navigation");
    console.log("[PAO Playwright] Note: Main page sections (history/sales/features/inspections) not available in prefetched mode");
    debug.usedPrefetchedIframe = true;
    debug.prefetchedIframeLength = options.prefetched.iframeHtml.length;
    debug.prefetchedIframeUrl = options.prefetched.iframeUrl;
    debug.mainPageSectionsSkipped = true;

    try {
      const $ = cheerio.load(options.prefetched.iframeHtml);
      const scraped = extractPropertyData($, detailUrl);
      debug.fieldsExtracted = Object.keys(scraped).filter(
        (k) => scraped[k as keyof typeof scraped] !== undefined
      ).length;
      debug.success = true;
      return { scraped, debug };
    } catch (error) {
      debug.prefetchedParseError = error instanceof Error ? error.message : String(error);
      console.warn("[PAO Playwright] Failed to parse prefetched HTML, falling back to browser navigation");
      // Fall through to browser navigation
    }
  }

  try {
    const result = await withPage(
      async (page) => {
        // Navigate to detail page (use domcontentloaded, not networkidle)
        console.log(`[PAO Playwright] Navigating to detail page: ${detailUrl}`);
        await page.goto(detailUrl, { waitUntil: "domcontentloaded" });

        // Get outer page content for blocking check only
        const outerHtml = await page.content();
        debug.outerHtmlLength = outerHtml.length;

        // Check for blocking on outer page
        const blockCheck = detectBlocking(outerHtml);
        if (blockCheck.blocked) {
          throw new PlaywrightError(
            `PAO detail page blocking: ${blockCheck.reason}`,
            "BLOCKED"
          );
        }

        // Wait for and extract iframe content - this is where the actual property data lives
        console.log("[PAO Playwright] Waiting for owner content iframe...");
        const { iframeHtml, iframeUrl } = await getOwnerIframeHtml(page, navTimeoutMs);
        debug.iframeHtmlLength = iframeHtml.length;
        debug.iframeUrl = iframeUrl;

        // Check for blocking in iframe content too
        const iframeBlockCheck = detectBlocking(iframeHtml);
        if (iframeBlockCheck.blocked) {
          throw new PlaywrightError(
            `PAO iframe content blocking: ${iframeBlockCheck.reason}`,
            "BLOCKED"
          );
        }

        // Parse the iframe HTML with Cheerio
        const $ = cheerio.load(iframeHtml);

        // Extract all property data from iframe content
        const scraped = extractPropertyData($, detailUrl);

        // Now extract data from main page JavaScript-controlled sections
        // These include: Value History, Sales, Features, Inspections
        console.log("[PAO Playwright] Now extracting main page JavaScript sections...");
        try {
          const mainPageSections = await extractMainPageSections(page, navTimeoutMs);

          // Parse and merge value history if available
          if (mainPageSections.valueHistoryHtml) {
            const valueHistoryHtml = mainPageSections.valueHistoryHtml;
            const $values = cheerio.load(valueHistoryHtml);
            const additionalValuations = parseValuationsTable($values);
            if (additionalValuations.length > 0) {
              // Merge with existing valuations, avoiding duplicates by year
              const existingYears = new Set((scraped.valuations || []).map(v => v.year));
              const newValuations = additionalValuations.filter(v => !existingYears.has(v.year));
              scraped.valuations = [...(scraped.valuations || []), ...newValuations];
              console.log(`[PAO Playwright] Added ${newValuations.length} valuations from main page`);
            }
          }

          // Parse and merge sales history if available
          if (mainPageSections.salesHtml) {
            const salesHtml = mainPageSections.salesHtml;
            const $sales = cheerio.load(salesHtml);
            const additionalSales = parseSalesTable($sales);
            if (additionalSales.length > 0) {
              // Merge with existing sales, avoiding obvious duplicates
              const existingDates = new Set((scraped.salesHistory || []).map(s => s.date));
              const newSales = additionalSales.filter(s => !existingDates.has(s.date));
              scraped.salesHistory = [...(scraped.salesHistory || []), ...newSales];
              console.log(`[PAO Playwright] Added ${newSales.length} sales from main page`);
            }
          }

          // Parse and add extra features if available
          if (mainPageSections.featuresHtml) {
            const extraFeatures = parseExtraFeaturesFromHtml(mainPageSections.featuresHtml);
            if (extraFeatures.length > 0) {
              scraped.extras = scraped.extras || {};
              scraped.extras.paoExtraFeatures = extraFeatures;
              console.log(`[PAO Playwright] Added ${extraFeatures.length} extra features from main page`);
            }
          }

          // Parse and add inspections if available
          if (mainPageSections.inspectionsHtml) {
            const inspections = parseInspectionsFromHtml(mainPageSections.inspectionsHtml);
            if (inspections.length > 0) {
              scraped.extras = scraped.extras || {};
              scraped.extras.inspections = inspections;
              console.log(`[PAO Playwright] Added ${inspections.length} inspections from main page`);
            }
          }
        } catch (mainPageError) {
          // Don't fail the whole extraction if main page sections fail
          console.warn("[PAO Playwright] Failed to extract some main page sections:", mainPageError);
          debug.mainPageSectionsError = mainPageError instanceof Error ? mainPageError.message : String(mainPageError);
        }

        debug.fieldsExtracted = Object.keys(scraped).filter(
          (k) => scraped[k as keyof typeof scraped] !== undefined
        ).length;

        return scraped;
      },
      { opTimeoutMs: timeoutMs, navTimeoutMs }
    );

    debug.success = true;
    return { scraped: result, debug };
  } catch (error) {
    debug.error = error instanceof Error ? error.message : String(error);
    debug.errorType = error instanceof PlaywrightError ? error.code : "UNKNOWN";
    debug.success = false;

    console.error("[PAO Playwright] Extraction failed:", debug.error);

    return { scraped: {}, debug };
  }
}

/**
 * RECOMMENDED: Single-session orchestrator that searches for a property and extracts all data
 *
 * This is the most efficient approach - it uses a single browser session to:
 * 1. Search for the property by address
 * 2. Navigate to the detail page (or stay if already there)
 * 3. Extract BOTH iframe data AND main page JavaScript sections
 *
 * Unlike the separate find + extract functions, this never misses data because
 * it doesn't close the browser between steps.
 */
export async function scrapeManateePaoPropertyByAddressPlaywright(
  address: string,
  options?: ManateePaoPlaywrightOptions
): Promise<ManateePaoScrapeResult> {
  const timeoutMs = options?.timeoutMs || 60000;
  const navTimeoutMs = options?.navTimeoutMs || 45000;
  const scope = options?.scope || "full";
  const debug: Record<string, unknown> = {
    address,
    scope,
    orchestratorUsed: true,
    startTime: new Date().toISOString(),
  };

  try {
    const result = await withPage(
      async (page) => {
        // Step 1: Find the detail page URL
        console.log(`[PAO Orchestrator] Starting search for: "${address}"`);
        const findResult = await findManateePaoDetailUrlOnPage(page, address, options);
        debug.findDebug = findResult.debug;

        if (!findResult.detailUrl) {
          console.log("[PAO Orchestrator] No property found for this address");
          return {
            detailUrl: null,
            scraped: {} as Partial<PropertyDetails>,
          };
        }

        // Validate that address was found (prevent wrong property)
        if (!findResult.addressFound) {
          console.warn("[PAO Orchestrator] Rejecting URL because address was not found in results");
          return {
            detailUrl: null,
            scraped: {} as Partial<PropertyDetails>,
          };
        }

        debug.detailUrl = findResult.detailUrl;
        debug.alreadyOnDetailPage = findResult.alreadyOnDetailPage;

        // Step 2: Navigate to detail page if not already there
        if (!findResult.alreadyOnDetailPage) {
          console.log(`[PAO Orchestrator] Navigating to detail page: ${findResult.detailUrl}`);
          await page.goto(findResult.detailUrl, { waitUntil: "domcontentloaded" });
        } else {
          console.log("[PAO Orchestrator] Already on detail page, skipping navigation");
        }

        // Step 3: Extract all property data (iframe + main page sections)
        console.log("[PAO Orchestrator] Extracting property data...");
        const extractResult = await extractManateePaoPropertyFromDetailPage(
          page,
          findResult.detailUrl,
          { ...options, scope }
        );
        debug.extractDebug = extractResult.debug;

        return {
          detailUrl: findResult.detailUrl,
          scraped: extractResult.scraped,
        };
      },
      { opTimeoutMs: timeoutMs, navTimeoutMs }
    );

    debug.success = true;
    return {
      detailUrl: result.detailUrl,
      scraped: result.scraped,
      debug,
    };
  } catch (error) {
    debug.error = error instanceof Error ? error.message : String(error);
    debug.errorType = error instanceof PlaywrightError ? error.code : "UNKNOWN";
    debug.success = false;

    console.error("[PAO Orchestrator] Scrape failed:", debug.error);

    // Re-throw blocking errors
    if (error instanceof PlaywrightError && error.code === "BLOCKED") {
      throw error;
    }

    return {
      detailUrl: null,
      scraped: {},
      debug,
    };
  }
}

// ============================================================================
// Form Filling
// ============================================================================

/**
 * Fill the PAO search form with address data
 */
async function fillSearchForm(page: Page, address: AddressParts): Promise<void> {
  // Clear and fill owner fields with wildcards
  await clearAndFill(page, SELECTORS.ownerLast, "*");
  await clearAndFill(page, SELECTORS.ownerFirst, "*");
  await clearAndFill(page, SELECTORS.parcelId, "*");

  // Fill address (the main search field)
  if (address.street) {
    await clearAndFill(page, SELECTORS.address, address.street);
    // Wait for typeahead to settle
    await page.waitForTimeout(500);
    // Press Escape to close any typeahead dropdown
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
  }

  // Fill zip code if provided
  if (address.zipCode) {
    await clearAndFill(page, SELECTORS.zipCode, address.zipCode);
  }

  // Note: RollType dropdown defaults to "REAL PROPERTY" which is correct
  // We don't need to change it
}

/**
 * Clear a field and fill it with new value
 */
async function clearAndFill(page: Page, selector: string, value: string): Promise<void> {
  try {
    await page.click(selector);
    await page.waitForTimeout(50);
    // Select all and clear
    await page.keyboard.press("Control+a");
    await page.waitForTimeout(50);
    await page.fill(selector, value);
    await page.waitForTimeout(100);
  } catch (error) {
    console.warn(`[PAO Playwright] Could not fill ${selector}:`, error);
  }
}

// ============================================================================
// Results Parsing
// ============================================================================

/**
 * Parse search results table from HTML
 */
function parseSearchResults(html: string): SearchRow[] {
  const $ = cheerio.load(html);
  const rows: SearchRow[] = [];

  // Try multiple table selectors
  const tableSelectors = [
    "table.table tbody tr",
    ".search-results table tbody tr",
    "#searchResults tbody tr",
    "table tbody tr",
  ];

  for (const selector of tableSelectors) {
    $(selector).each((_, row) => {
      const $row = $(row);
      const text = $row.text().trim();

      // Skip header rows
      if ($row.find("th").length > 0) return;

      // Find link with parcel ID
      let href: string | null = null;
      let parcelId: string | null = null;

      $row.find("a").each((_, link) => {
        const linkHref = $(link).attr("href") || "";
        // Look for parcel detail links
        if (linkHref.includes("parcel") || linkHref.includes("parid") || linkHref.includes("detail")) {
          href = linkHref;
          // Extract parcel ID from URL
          const parcelMatch = linkHref.match(/(?:parid|parcel|parcelid)=(\d{10})/i);
          if (parcelMatch) {
            parcelId = parcelMatch[1];
          }
        }
      });

      // Also try to extract parcel ID from text
      if (!parcelId) {
        const textParcelMatch = text.match(/\b(\d{10})\b/);
        if (textParcelMatch) {
          parcelId = textParcelMatch[1];
        }
      }

      if (text && (href || parcelId)) {
        rows.push({ href, text, parcelId });
      }
    });

    if (rows.length > 0) break;
  }

  return rows;
}

/**
 * Detect if the page shows a "no results" message
 */
function detectNoResults(html: string): boolean {
  const lowerHtml = html.toLowerCase();
  const noResultsPatterns = [
    "no results",
    "no records found",
    "no properties found",
    "no matching",
    "0 results",
    "zero results",
    "search returned no",
  ];

  return noResultsPatterns.some((pattern) => lowerHtml.includes(pattern));
}

/**
 * Select the best matching result row based on address matching
 */
function selectBestResult(
  rows: SearchRow[],
  searchAddress: string
): { href: string | null; addressFound: boolean; matchedText?: string } {
  const parsed = parseAddress(searchAddress);
  const streetParts = (parsed.street || "").toLowerCase().split(/\s+/);
  const streetNumber = streetParts[0] || "";
  const streetName = streetParts.slice(1).join(" ");

  // Find rows that match our address
  for (const row of rows) {
    const rowTextLower = row.text.toLowerCase();

    // Must have street number
    if (!rowTextLower.includes(streetNumber)) continue;

    // Check for street name parts (at least one significant word)
    const streetNameWords = streetName.split(" ").filter((w) => w.length > 2);
    const hasStreetMatch = streetNameWords.some((word) => rowTextLower.includes(word));

    if (hasStreetMatch) {
      // Build URL from href or parcel ID
      let href = row.href;
      if (!href && row.parcelId) {
        href = `/parcel/?parid=${row.parcelId}`;
      }

      return {
        href,
        addressFound: true,
        matchedText: row.text.substring(0, 100),
      };
    }
  }

  // No match found - return first row's href but mark addressFound=false
  // This allows caller to reject it and try Exa fallback
  const firstRow = rows[0];
  return {
    href: firstRow?.href || (firstRow?.parcelId ? `/parcel/?parid=${firstRow.parcelId}` : null),
    addressFound: false,
    matchedText: firstRow?.text.substring(0, 100),
  };
}

// ============================================================================
// Property Data Extraction (Cheerio-based)
// ============================================================================

/**
 * Extract all property data from detail page HTML
 */
function extractPropertyData($: cheerio.CheerioAPI, detailUrl: string): Partial<PropertyDetails> {
  const property: Partial<PropertyDetails> = {};

  // ===== Core Identification =====
  property.parcelId = extractByLabel($, ["Parcel ID", "Parcel #", "Account", "Account #"]) ||
    extractParcelIdFromUrl(detailUrl);

  property.address = extractByLabel($, ["Situs Address", "Property Address", "Site Address"]) || "";
  property.owner = extractByLabel($, ["Owner", "Owner Name", "Ownership"]);
  property.ownerType = extractByLabel($, ["Owner Type"]);
  property.propertyType = extractByLabel($, ["Property Type", "Land Use", "Use Description"]);

  // Parse city/state/zip from address if present
  const addressText = property.address || "";
  const cityStateMatch = addressText.match(/,\s*([^,]+),?\s*(\w{2})?\s*(\d{5})?/);
  if (cityStateMatch) {
    property.city = cityStateMatch[1]?.trim();
    property.state = cityStateMatch[2] || "FL";
    property.zipCode = cityStateMatch[3];
  }

  // ===== Basic Info Section =====
  property.basicInfo = extractBasicInfo($);

  // ===== Valuations Table =====
  property.valuations = parseValuationsTable($);

  // Derive summary values from latest valuation
  if (property.valuations && property.valuations.length > 0) {
    const latest = property.valuations.reduce((a, b) =>
      (b.year || 0) > (a.year || 0) ? b : a
    );
    property.marketValue = latest.just?.total;
    property.assessedValue = latest.assessed?.total;
    property.taxAmount = (latest.adValoremTaxes || 0) + (latest.nonAdValoremTaxes || 0);
  }

  // ===== Building Details =====
  property.building = extractBuildingSection($);
  property.yearBuilt = property.building?.yearBuilt;
  property.bedrooms = property.building?.bedrooms;
  property.bathrooms = property.building?.bathrooms;
  property.sqft = property.building?.livingAreaSqFt;

  // ===== Land Details =====
  property.land = extractLandSection($);
  if (property.land?.lotSizeAcres) {
    property.lotSize = `${property.land.lotSizeAcres} acres`;
  } else if (property.land?.lotSizeSqFt) {
    property.lotSize = `${property.land.lotSizeSqFt.toLocaleString()} sq ft`;
  }

  // ===== Sales History =====
  property.salesHistory = parseSalesTable($);

  // Derive last sale from history
  if (property.salesHistory && property.salesHistory.length > 0) {
    const qualifiedSales = property.salesHistory.filter((s) => s.price && s.price > 0);
    if (qualifiedSales.length > 0) {
      property.lastSalePrice = qualifiedSales[0].price;
      property.lastSaleDate = qualifiedSales[0].date;
    }
  }

  return property;
}

/**
 * Extract basic property info
 */
function extractBasicInfo($: cheerio.CheerioAPI): PropertyBasicInfo {
  return {
    mailingAddress: extractByLabel($, ["Mailing Address"]),
    jurisdiction: extractByLabel($, ["Jurisdiction"]),
    taxDistrict: extractByLabel($, ["Tax District"]),
    sectionTownshipRange: extractByLabel($, ["Sec/Twp/Rge", "Section"]),
    neighborhood: extractByLabel($, ["Neighborhood"]),
    subdivision: extractByLabel($, ["Subdivision"]),
    shortDescription: extractByLabel($, ["Short Description"]),
    legalDescription: extractByLabel($, ["Legal Description", "Full Description"]),
    useCode: extractByLabel($, ["Land Use Code", "Use Code"]),
    useDescription: extractByLabel($, ["Land Use Description", "Use Description"]),
    femaValue: parseNumber(extractByLabel($, ["FEMA Value"])),
    homesteadExemption: $("body").text().toLowerCase().includes("homestead"),
  };
}

/**
 * Extract building section data
 */
function extractBuildingSection($: cheerio.CheerioAPI): PropertyBuilding {
  const building: PropertyBuilding = {};

  building.yearBuilt = parseNumber(extractByLabel($, ["Year Built", "Built"]));
  building.effectiveYearBuilt = parseNumber(extractByLabel($, ["Effective Year Built"]));
  building.livingAreaSqFt = parseNumber(extractByLabel($, ["Living Area", "Living or Business Area", "Living Sqft"]));
  building.totalAreaSqFt = parseNumber(extractByLabel($, ["Total Area", "Area Under Roof", "Total Sqft"]));
  building.bedrooms = parseNumber(extractByLabel($, ["Bedrooms", "Beds"]));
  building.bathrooms = parseNumber(extractByLabel($, ["Bathrooms", "Baths", "Total Baths"]));
  building.fullBathrooms = parseNumber(extractByLabel($, ["Full Bathrooms", "Full Baths"]));
  building.halfBathrooms = parseNumber(extractByLabel($, ["Half Bathrooms", "Half Baths"]));
  building.stories = parseNumber(extractByLabel($, ["Stories", "Floors"]));
  building.units = parseNumber(extractByLabel($, ["Living Units", "Units"]));
  building.constructionType = extractByLabel($, ["Construction", "Construction Type"]);
  building.foundation = extractByLabel($, ["Foundation"]);
  building.exteriorWalls = extractByLabel($, ["Exterior Walls", "Exterior"]);
  building.roofCover = extractByLabel($, ["Roof Cover", "Roof"]);
  building.roofStructure = extractByLabel($, ["Roof Structure"]);
  building.flooring = extractByLabel($, ["Flooring", "Floor"]);
  building.heating = extractByLabel($, ["Heating", "Heat"]);
  building.cooling = extractByLabel($, ["Cooling", "Air Conditioning", "A/C"]);

  // Pool detection
  const bodyText = $("body").text().toLowerCase();
  building.pool = bodyText.includes("pool") && !bodyText.includes("no pool")
    ? { hasPool: true }
    : undefined;

  return building;
}

/**
 * Extract land section data
 */
function extractLandSection($: cheerio.CheerioAPI): PropertyLand {
  const land: PropertyLand = {};

  land.lotSizeSqFt = parseNumber(extractByLabel($, ["Lot Size", "Land Size"])?.replace(/sq\s*ft/i, ""));
  land.lotSizeAcres = parseNumber(extractByLabel($, ["Acres", "Lot Acres"]));
  land.landUse = extractByLabel($, ["Land Use"]);
  land.landUseCode = extractByLabel($, ["Land Use Code", "DOR Code"]);
  land.roadSurfaceType = extractByLabel($, ["Road Surface", "Road Type"]);

  // Try to extract acres from lot size text
  const lotSizeText = extractByLabel($, ["Lot Size", "Land Size"]) || "";
  if (!land.lotSizeAcres) {
    const acresMatch = lotSizeText.match(/([\d.]+)\s*acres?/i);
    if (acresMatch) {
      land.lotSizeAcres = parseFloat(acresMatch[1]);
    }
  }

  return land;
}

/**
 * Parse valuations table from PAO
 *
 * PAO table columns (from #tableValue):
 * 0: January 1 Tax Year
 * 1: Homestead Exemption (Yes/No)
 * 2: Land Value
 * 3: Improvements Value
 * 4: Just/Market Value
 * 5: Non-School Assessed Value
 * 6: School Assessed Value
 * 7: County Taxable Value
 * (may have more columns for taxes)
 */
function parseValuationsTable($: cheerio.CheerioAPI): ValuationRecord[] {
  const valuations: ValuationRecord[] = [];

  // Look for all tables (handles both direct table and table#tableValue)
  $("table").each((_, table) => {
    const $table = $(table);
    const headerText = $table.find("th, thead").text().toLowerCase();

    // Check if this looks like a values table
    if (headerText.includes("year") || headerText.includes("land") || headerText.includes("market") || headerText.includes("value")) {
      $table.find("tbody tr").each((_, row) => {
        const cells = $(row).find("td");
        if (cells.length < 4) return;

        const firstCell = $(cells[0]).text().trim();
        const year = parseInt(firstCell, 10);

        // Must be a valid year (2000-2100)
        if (year < 2000 || year > 2100) return;

        // Column mapping for PAO table:
        // 0: Year, 1: Homestead, 2: Land, 3: Improvements, 4: Just/Market
        // 5: Non-School Assessed, 6: School Assessed, 7: County Taxable
        const valuation: ValuationRecord = {
          year,
          just: {
            land: parseMoney($(cells[2]).text()),
            building: parseMoney($(cells[3]).text()),
            total: parseMoney($(cells[4]).text()),
          },
        };

        // Assessed values (columns 5-6)
        if (cells.length > 5) {
          valuation.assessed = { total: parseMoney($(cells[5]).text()) };
        }

        // Taxable value (column 7)
        if (cells.length > 7) {
          valuation.taxable = { total: parseMoney($(cells[7]).text()) };
        }

        // Look for tax columns (usually at the end)
        if (cells.length > 9) {
          // Ad Valorem and Non-Ad Valorem taxes are typically the last columns
          const lastCells = cells.toArray().slice(-2);
          valuation.adValoremTaxes = parseMoney($(lastCells[0]).text());
          valuation.nonAdValoremTaxes = parseMoney($(lastCells[1]).text());
        }

        valuations.push(valuation);
      });
    }
  });

  // Sort by year descending (most recent first)
  valuations.sort((a, b) => (b.year || 0) - (a.year || 0));

  return valuations;
}

/**
 * Parse sales history table from PAO
 *
 * PAO table columns (from #tableSales):
 * 0: Sale Date
 * 1: Book / Page Instrument
 * 2: Instrument Type (QC, WD, etc.)
 * 3: Vacant / Improved (V or I)
 * 4: Qualification Code
 * 5: Sale Price
 * 6: Grantee
 */
function parseSalesTable($: cheerio.CheerioAPI): SaleRecord[] {
  const sales: SaleRecord[] = [];

  // Look for all tables (handles both direct table and table#tableSales)
  $("table").each((_, table) => {
    const $table = $(table);
    const headerText = $table.find("th, thead").text().toLowerCase();

    if (headerText.includes("sale") || headerText.includes("grantee") || headerText.includes("price")) {
      $table.find("tbody tr").each((_, row) => {
        const cells = $(row).find("td");
        if (cells.length < 5) return;

        // Column mapping for PAO table:
        // 0: Sale Date, 1: Book/Page, 2: Instrument Type, 3: V/I, 4: Qual Code, 5: Price, 6: Grantee
        const dateText = $(cells[0]).text().trim();
        const bookPageText = $(cells[1]).text().trim();
        const instrumentType = $(cells[2]).text().trim();
        const vacantImproved = $(cells[3]).text().trim();
        const qualCode = $(cells[4]).text().trim();
        const priceText = $(cells[5]).text().trim();
        const granteeText = cells.length > 6 ? $(cells[6]).text().trim() : "";

        // Parse date
        const dateMatch = dateText.match(/\d{1,2}\/\d{1,2}\/\d{4}/);
        const date = dateMatch ? dateMatch[0] : dateText;

        // Parse price
        const price = parseMoney(priceText);

        // Skip rows without meaningful data
        if (!date && !price) return;

        const sale: SaleRecord = {
          date,
          bookPage: bookPageText || undefined,
          deedType: instrumentType || undefined,
          vacantOrImproved: vacantImproved || undefined,
          qualificationCode: qualCode || undefined,
          price,
          grantee: granteeText || undefined,
        };

        sales.push(sale);
      });
    }
  });

  // Sort by date descending (most recent first)
  sales.sort((a, b) => {
    if (!a.date || !b.date) return 0;
    const dateA = new Date(a.date);
    const dateB = new Date(b.date);
    return dateB.getTime() - dateA.getTime();
  });

  return sales;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Extract value by looking for label patterns
 */
function extractByLabel($: cheerio.CheerioAPI, labels: string[]): string | undefined {
  for (const label of labels) {
    const lowerLabel = label.toLowerCase();

    // Try dt/dd pattern
    const ddValue = $(`dt:contains("${label}")`).next("dd").text().trim();
    if (ddValue) return ddValue;

    // Try table row pattern
    let foundValue: string | undefined;
    $("tr").each((_, row) => {
      const cells = $(row).find("td, th");
      cells.each((i, cell) => {
        if ($(cell).text().toLowerCase().includes(lowerLabel) && cells[i + 1]) {
          const value = $(cells[i + 1]).text().trim();
          if (value && value !== "-" && value !== "N/A") {
            foundValue = value;
            return false; // break
          }
        }
      });
      if (foundValue) return false; // break
    });
    if (foundValue) return foundValue;

    // Try label: value pattern in text
    const bodyText = $("body").text();
    const labelRegex = new RegExp(`${label}[:\\s]+([^\\n]+)`, "i");
    const match = bodyText.match(labelRegex);
    if (match && match[1]?.trim()) {
      return match[1].trim().split(/\s{2,}/)[0]; // Take first part before double space
    }
  }

  return undefined;
}

/**
 * Extract parcel ID from URL
 */
function extractParcelIdFromUrl(url: string): string | undefined {
  const match = url.match(/(?:parid|parcel|parcelid)=(\d{10})/i);
  return match?.[1];
}

/**
 * Parse money string to number
 */
function parseMoney(input?: string): number | undefined {
  if (!input) return undefined;
  const cleaned = input.replace(/[$,\s]/g, "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? undefined : num;
}

/**
 * Parse string to number
 */
function parseNumber(input?: string): number | undefined {
  if (!input) return undefined;
  const cleaned = input.replace(/[,\s]/g, "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? undefined : num;
}

/**
 * Parse address string into components
 */
function parseAddress(address: string): AddressParts {
  const parts = address.split(",").map((p) => p.trim());
  const result: AddressParts = {};

  if (parts.length >= 1) {
    result.street = parts[0];
  }
  if (parts.length >= 2) {
    result.city = parts[1];
  }
  if (parts.length >= 3) {
    const stateZip = parts[2].split(" ");
    result.state = stateZip[0];
    if (stateZip.length > 1) {
      result.zipCode = stateZip[1];
    }
  }
  if (parts.length >= 4) {
    result.zipCode = parts[3];
  }

  return result;
}
