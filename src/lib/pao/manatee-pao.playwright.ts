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
import { normalizeStreetForUsps } from "@/lib/address/normalize";
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
  // Owner content section (main page, NOT iframe)
  ownerContent: ".owner-content, #ownerContent",
  // Tab navigation (click to reveal content)
  tabs: {
    sales: "#sales-nav",
    values: "#valueHistory-nav",
    buildings: "#buildings-nav",
    features: "#features-nav",
    inspections: "#inspections-nav",
  },
  // Data tables (appear after clicking tabs)
  tables: {
    sales: "#tableSales",
    values: "#tableValue",
    buildings: "#tableBuildings",
    features: "#tableFeatures",
    inspections: "#tableInspections",
  },
};

// ============================================================================
// Types
// ============================================================================

export interface ManateePaoPlaywrightOptions {
  timeoutMs?: number;
  navTimeoutMs?: number;
  debug?: boolean;
}

/** Result from finding a detail URL */
export interface ManateePaoDetailUrlResult {
  detailUrl: string | null;
  debug: Record<string, unknown>;
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
// Main Page Data Extraction
// ============================================================================

/**
 * Extract owner/property info from the main page .owner-content section
 * NOTE: This data is NOT in the iframe - the iframe is just a CSS skeleton!
 */
async function extractOwnerInfoFromMainPage(page: Page): Promise<string | null> {
  console.log("[PAO Playwright] Extracting owner info from main page...");

  try {
    const ownerContent = await page.$(SELECTORS.ownerContent);
    if (ownerContent) {
      const html = await page.evaluate((el) => el.innerHTML, ownerContent);
      console.log(`[PAO Playwright] Found owner content: ${html?.length || 0} chars`);
      return html;
    }
  } catch {
    console.log("[PAO Playwright] Could not find owner content section");
  }

  return null;
}

/**
 * Click a tab and extract the corresponding table
 * The PAO site dynamically loads table content into card bodies when tabs are clicked
 * NOTE: If a tab is already active, it appears as "disabled" - in that case, the table is already visible
 */
async function clickTabAndExtractTable(
  page: Page,
  tabSelector: string,
  tableSelector: string,
  description: string
): Promise<string | null> {
  try {
    // First check if table is already visible (tab might be active)
    let table = await page.$(tableSelector);
    if (table) {
      const html = await page.evaluate((el) => el.outerHTML, table);
      const rowCount = await page.evaluate((sel) => {
        const t = document.querySelector(sel);
        return t?.querySelectorAll("tbody tr").length || 0;
      }, tableSelector);

      if (rowCount > 0) {
        console.log(`[PAO Playwright] ${description} table already visible: ${rowCount} rows, ${html?.length || 0} chars`);
        return html;
      }
    }

    // Table not visible or empty, need to click tab
    console.log(`[PAO Playwright] Clicking ${description} tab (${tabSelector})...`);
    const tab = await page.$(tabSelector);
    if (!tab) {
      console.log(`[PAO Playwright] ${description} tab not found: ${tabSelector}`);
      return null;
    }

    // Check if tab is disabled (already active) - try to read table anyway
    const isDisabled = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      return el?.hasAttribute("disabled") || el?.classList.contains("disabled");
    }, tabSelector);

    if (!isDisabled) {
      // Click the tab
      await tab.click();
      await page.waitForTimeout(800); // Wait for content to load
    } else {
      console.log(`[PAO Playwright] ${description} tab is active/disabled, reading table directly`);
    }

    // Wait for the table to appear
    try {
      await page.waitForSelector(tableSelector, { timeout: 3000 });
    } catch {
      console.log(`[PAO Playwright] Table ${tableSelector} not found after ${isDisabled ? 'checking' : 'clicking'} ${description} tab`);
      return null;
    }

    // Extract the table HTML
    table = await page.$(tableSelector);
    if (table) {
      const html = await page.evaluate((el) => el.outerHTML, table);
      console.log(`[PAO Playwright] ${description} table: ${html?.length || 0} chars`);
      return html;
    }

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
 * PAGE STRUCTURE (discovered via browser inspection December 2024):
 * - Owner info: .owner-content (NOT in iframe - iframe is just a CSS skeleton!)
 * - Sales card (#dgSmall) tabs: Sales | Exemptions | Businesses | Addresses | Inspections
 * - Values card (#dgLarge) tabs: Values | Land | Buildings | Features | Permits
 *
 * Tables are dynamically loaded when tabs are clicked:
 * - #tableSales, #tableValue, #tableBuildings, #tableFeatures, #tableInspections
 */
async function extractMainPageSections(
  page: Page
): Promise<{
  ownerHtml: string | null;
  salesHtml: string | null;
  valuesHtml: string | null;
  buildingsHtml: string | null;
  featuresHtml: string | null;
  inspectionsHtml: string | null;
}> {
  console.log("[PAO Playwright] Extracting main page sections...");

  // ===== OWNER INFO =====
  const ownerHtml = await extractOwnerInfoFromMainPage(page);

  // ===== SALES CARD TABS =====
  // Click Sales tab first to load sales data
  const salesHtml = await clickTabAndExtractTable(
    page,
    SELECTORS.tabs.sales,
    SELECTORS.tables.sales,
    "Sales"
  );

  // Click Inspections tab (same card as Sales)
  const inspectionsHtml = await clickTabAndExtractTable(
    page,
    SELECTORS.tabs.inspections,
    SELECTORS.tables.inspections,
    "Inspections"
  );

  // ===== VALUES CARD TABS =====
  // Click Values tab first to load valuations
  const valuesHtml = await clickTabAndExtractTable(
    page,
    SELECTORS.tabs.values,
    SELECTORS.tables.values,
    "Values"
  );

  // Click Buildings tab (same card as Values) - has bedroom/bathroom info
  const buildingsHtml = await clickTabAndExtractTable(
    page,
    SELECTORS.tabs.buildings,
    SELECTORS.tables.buildings,
    "Buildings"
  );

  // Click Features tab (same card as Values)
  const featuresHtml = await clickTabAndExtractTable(
    page,
    SELECTORS.tabs.features,
    SELECTORS.tables.features,
    "Features"
  );

  console.log(`[PAO Playwright] Main page sections extracted:`, {
    owner: ownerHtml ? `${ownerHtml.length} chars` : "NOT FOUND",
    sales: salesHtml ? `${salesHtml.length} chars` : "not found",
    values: valuesHtml ? `${valuesHtml.length} chars` : "not found",
    buildings: buildingsHtml ? `${buildingsHtml.length} chars` : "not found",
    features: featuresHtml ? `${featuresHtml.length} chars` : "not found",
    inspections: inspectionsHtml ? `${inspectionsHtml.length} chars` : "not found",
  });

  return { ownerHtml, salesHtml, valuesHtml, buildingsHtml, featuresHtml, inspectionsHtml };
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

/**
 * Parse building info from the Buildings table HTML
 * Extracts: type, year built, stories, sqft under roof, living area, rooms (bed/bath), construction, roof
 *
 * Table columns: Type | Bldg | Classification | Yrblt | Effyr | Stories | UnRoof | LivBus | Rooms | Const/ExtWall | RoofMaterial | RoofType
 * Rooms format: "3/2/0" = 3 bedrooms / 2 bathrooms / 0 half baths
 */
function parseBuildingsFromHtml(html: string): Partial<PropertyDetails> {
  const $ = cheerio.load(html);
  const details: Partial<PropertyDetails> = {
    building: {},
  };

  // Find the first data row (skip header)
  const dataRow = $("table tbody tr").first();
  if (!dataRow.length) {
    return details;
  }

  const cells = dataRow.find("td");

  // Map cells to column indices based on PAO table structure
  // Type | Bldg | Classification | Yrblt | Effyr | Stories | UnRoof | LivBus | Rooms | Const/ExtWall | RoofMaterial | RoofType
  const getValue = (index: number): string => {
    return cells.eq(index).text().trim();
  };

  // Year built (column 3)
  const yearBuilt = getValue(3);
  if (yearBuilt && /^\d{4}$/.test(yearBuilt)) {
    details.building!.yearBuilt = parseInt(yearBuilt, 10);
  }

  // Effective year (column 4)
  const effYear = getValue(4);
  if (effYear && /^\d{4}$/.test(effYear)) {
    details.building!.effectiveYearBuilt = parseInt(effYear, 10);
  }

  // Stories (column 5)
  const stories = getValue(5);
  if (stories) {
    const storiesNum = parseFloat(stories);
    if (!isNaN(storiesNum)) {
      details.building!.stories = storiesNum;
    }
  }

  // Under Roof sqft (column 6)
  const underRoof = getValue(6);
  if (underRoof) {
    const sqft = parseNumber(underRoof);
    if (sqft) {
      details.building!.totalAreaSqFt = sqft;
    }
  }

  // Living/Business area sqft (column 7)
  const livBus = getValue(7);
  if (livBus) {
    const sqft = parseNumber(livBus);
    if (sqft) {
      details.building!.livingAreaSqFt = sqft;
    }
  }

  // Rooms - format "3/2/0" = bedrooms/bathrooms/half-baths (column 8)
  const rooms = getValue(8);
  if (rooms) {
    const roomParts = rooms.split("/");
    if (roomParts.length >= 2) {
      const bedrooms = parseInt(roomParts[0], 10);
      const bathrooms = parseInt(roomParts[1], 10);
      const halfBaths = roomParts[2] ? parseInt(roomParts[2], 10) : 0;

      if (!isNaN(bedrooms)) {
        details.building!.bedrooms = bedrooms;
      }
      if (!isNaN(bathrooms)) {
        // Full bathrooms + half baths as decimal
        details.building!.bathrooms = bathrooms + (halfBaths * 0.5);
        details.building!.fullBathrooms = bathrooms;
        details.building!.halfBathrooms = halfBaths;
      }
    }
  }

  // Construction/Exterior Wall (column 9) - e.g., "MASONRY/STUCCO"
  const construction = getValue(9);
  if (construction) {
    const parts = construction.split("/");
    details.building!.constructionType = parts[0]?.trim();
    if (parts[1]) {
      details.building!.exteriorWalls = parts[1].trim();
    }
  }

  // Roof Material (column 10) - e.g., "SHEET METAL"
  const roofMaterial = getValue(10);
  if (roofMaterial) {
    details.building!.roofCover = roofMaterial;
  }

  // Roof Type (column 11) - e.g., "HIP AND/OR GABLE"
  const roofType = getValue(11);
  if (roofType) {
    details.building!.roofStructure = roofType;
  }

  return details;
}

// ============================================================================
// Property Data Helpers (Parsing & Merging)
// ============================================================================

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
 * Returns parsed property data (owner info, valuations, sales, buildings, features, inspections)
 */
async function extractSupplementalFromMainPage(
  page: Page
): Promise<Partial<PropertyDetails>> {
  const sections = await extractMainPageSections(page);
  let supplemental: Partial<PropertyDetails> = {};

  // Parse owner info from main page (NOT iframe!)
  if (sections.ownerHtml) {
    supplemental = parseOwnerInfoFromMainPageHtml(sections.ownerHtml);
    console.log(`[PAO Playwright] Parsed owner info: ${supplemental.owner || 'unknown'}`);
  }

  // Parse valuations (Values tab)
  if (sections.valuesHtml) {
    const $values = cheerio.load(sections.valuesHtml);
    supplemental.valuations = parseValuationsTable($values);
    console.log(`[PAO Playwright] Parsed ${supplemental.valuations?.length || 0} valuation records`);
  }

  // Parse sales history (Sales tab)
  if (sections.salesHtml) {
    const $sales = cheerio.load(sections.salesHtml);
    supplemental.salesHistory = parseSalesTable($sales);
    console.log(`[PAO Playwright] Parsed ${supplemental.salesHistory?.length || 0} sale records`);
  }

  // Parse buildings info (Buildings tab) - has bedroom/bathroom info
  if (sections.buildingsHtml) {
    const buildingInfo = parseBuildingsFromHtml(sections.buildingsHtml);
    if (buildingInfo.building) {
      supplemental.building = { ...supplemental.building, ...buildingInfo.building };
      console.log(`[PAO Playwright] Parsed building info: ${buildingInfo.building.bedrooms || 0} bed, ${buildingInfo.building.bathrooms || 0} bath`);
    }
  }

  // Parse features (Features tab)
  if (sections.featuresHtml) {
    const paoExtraFeatures = parseExtraFeaturesFromHtml(sections.featuresHtml);
    if (paoExtraFeatures.length > 0) {
      supplemental.extras = { ...supplemental.extras, paoExtraFeatures };
      console.log(`[PAO Playwright] Parsed ${paoExtraFeatures.length} extra features`);
    }
  }

  // Parse inspections (Inspections tab)
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
      `${SELECTORS.ownerContent}, ${SELECTORS.resultsTable}, ${SELECTORS.noResults}, table.table`,
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
 *
 * NOTE: All data is extracted from the main page by clicking tabs.
 * The iframe on the PAO site is just a CSS skeleton placeholder.
 */
async function extractManateePaoPropertyFromDetailPage(
  page: Page,
  detailUrl: string,
  _options?: ManateePaoPlaywrightOptions
): Promise<{ scraped: Partial<PropertyDetails>; debug: Record<string, unknown> }> {
  const debug: Record<string, unknown> = {
    detailUrl,
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

  // Extract all data from main page by clicking tabs
  // NOTE: The iframe is just a skeleton placeholder - real data is on main page
  console.log("[PAO Playwright] Extracting property data from main page tabs...");
  try {
    const scraped = await extractSupplementalFromMainPage(page);

    debug.mainPageSectionsExtracted = true;
    debug.valuations = scraped.valuations?.length || 0;
    debug.salesHistory = scraped.salesHistory?.length || 0;
    debug.extraFeatures = scraped.extras?.paoExtraFeatures?.length || 0;
    debug.inspections = scraped.extras?.inspections?.length || 0;
    debug.hasOwner = !!scraped.owner;
    debug.hasBuildingInfo = !!(scraped.building?.bedrooms || scraped.building?.yearBuilt);

    debug.totalFieldsExtracted = Object.keys(scraped).filter(
      (k) => scraped[k as keyof typeof scraped] !== undefined
    ).length;

    return { scraped, debug };
  } catch (error) {
    debug.mainPageSectionsError = error instanceof Error ? error.message : String(error);
    console.error("[PAO Playwright] Failed to extract main page sections:", error);
    throw error;
  }
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

        // Wait for either results table, no-results message, or owner content (direct redirect)
        // This is more deterministic than networkidle
        try {
          await page.waitForSelector(
            `${SELECTORS.ownerContent}, ${SELECTORS.resultsTable}, ${SELECTORS.noResults}, table.table`,
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
          return {
            detailUrl: currentUrl,
            addressFound: true,
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
 * All property data is extracted from the main page by clicking tabs.
 * The iframe on the PAO site is just a CSS skeleton placeholder.
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

  try {
    const result = await withPage(
      async (page) => {
        // Navigate to detail page
        console.log(`[PAO Playwright] Navigating to detail page: ${detailUrl}`);
        await page.goto(detailUrl, { waitUntil: "domcontentloaded" });

        // Wait for page content to load
        await page.waitForTimeout(1000);

        // Extract property data from main page
        return await extractManateePaoPropertyFromDetailPage(page, detailUrl, options);
      },
      { opTimeoutMs: timeoutMs, navTimeoutMs }
    );

    return {
      scraped: result.scraped,
      debug: { ...debug, ...result.debug, success: true },
    };
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
 * 3. Extract all property data by clicking tabs
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
  const debug: Record<string, unknown> = {
    address,
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

        // Step 3: Extract all property data from main page tabs
        console.log("[PAO Orchestrator] Extracting property data...");
        const extractResult = await extractManateePaoPropertyFromDetailPage(
          page,
          findResult.detailUrl,
          options
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
 * Normalizes street address to USPS abbreviations for reliable search
 */
async function fillSearchForm(page: Page, address: AddressParts): Promise<void> {
  // Clear and fill owner fields with wildcards
  await clearAndFill(page, SELECTORS.ownerLast, "*");
  await clearAndFill(page, SELECTORS.ownerFirst, "*");
  await clearAndFill(page, SELECTORS.parcelId, "*");

  // Fill address (the main search field)
  // Normalize street to USPS abbreviations (defense-in-depth, should already be normalized)
  if (address.street) {
    const normalizedStreet = normalizeStreetForUsps(address.street);
    if (normalizedStreet !== address.street) {
      console.log(`[PAO Playwright] Street normalized: "${address.street}" → "${normalizedStreet}"`);
    }
    await clearAndFill(page, SELECTORS.address, normalizedStreet);
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
