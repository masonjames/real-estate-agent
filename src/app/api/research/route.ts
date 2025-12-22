import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db, propertySearches } from "@/db";
import { runPropertyResearchAgent } from "@/lib/agent";

export async function POST(request: NextRequest) {
  try {
    // Verify authentication
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { address } = body;

    if (!address || typeof address !== "string") {
      return NextResponse.json(
        { error: "Address is required" },
        { status: 400 }
      );
    }

    // Run the research agent
    const result = await runPropertyResearchAgent(address, {
      includeDemographics: true,
      includeBuyerSearch: true,
      includePersonas: true,
    });

    // Save the search to the database
    const [savedSearch] = await db
      .insert(propertySearches)
      .values({
        userId: session.user.id,
        address: address,
        city: result.property?.city,
        state: result.property?.state,
        zipCode: result.property?.zipCode,
        propertyData: result.property as unknown as Record<string, unknown>,
        demographicData: result.demographics as unknown as Record<string, unknown>,
        buyerMatches: {
          potentialBuyers: result.potentialBuyers,
          personas: result.buyerPersonas,
        },
      })
      .returning();

    return NextResponse.json({
      success: true,
      searchId: savedSearch.id,
      result,
    });
  } catch (error) {
    console.error("Research API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    // Verify authentication
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Get search ID from query params
    const searchParams = request.nextUrl.searchParams;
    const searchId = searchParams.get("id");

    if (searchId) {
      // Get specific search
      const search = await db.query.propertySearches.findFirst({
        where: (searches, { eq, and }) =>
          and(
            eq(searches.id, parseInt(searchId)),
            eq(searches.userId, session.user.id)
          ),
      });

      if (!search) {
        return NextResponse.json(
          { error: "Search not found" },
          { status: 404 }
        );
      }

      return NextResponse.json({ search });
    }

    // Get all searches for user
    const searches = await db.query.propertySearches.findMany({
      where: (searches, { eq }) => eq(searches.userId, session.user.id),
      orderBy: (searches, { desc }) => [desc(searches.createdAt)],
      limit: 50,
    });

    return NextResponse.json({ searches });
  } catch (error) {
    console.error("Research API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
