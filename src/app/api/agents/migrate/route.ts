import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// POST /api/agents/migrate — One-time migration to create agent tables
// DELETE THIS ROUTE AFTER RUNNING IT ONCE
export async function POST() {
    try {
        // Create SyjAgent table
        await prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "SyjAgent" (
                "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
                "slug" TEXT NOT NULL,
                "name" TEXT NOT NULL,
                "description" TEXT,
                "status" TEXT NOT NULL DEFAULT 'idle',
                "schedule" TEXT,
                "config" JSONB,
                "lastRunAt" TIMESTAMP(3),
                "lastError" TEXT,
                "enabled" BOOLEAN NOT NULL DEFAULT true,
                "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "SyjAgent_pkey" PRIMARY KEY ("id")
            )
        `);
        await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "SyjAgent_slug_key" ON "SyjAgent"("slug")`);

        // Create SyjAgentRun table
        await prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "SyjAgentRun" (
                "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
                "agentId" TEXT NOT NULL,
                "status" TEXT NOT NULL DEFAULT 'running',
                "trigger" TEXT NOT NULL DEFAULT 'manual',
                "config" JSONB,
                "results" JSONB,
                "error" TEXT,
                "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "completedAt" TIMESTAMP(3),
                "durationMs" INTEGER,
                CONSTRAINT "SyjAgentRun_pkey" PRIMARY KEY ("id"),
                CONSTRAINT "SyjAgentRun_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "SyjAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE
            )
        `);
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SyjAgentRun_agentId_startedAt_idx" ON "SyjAgentRun"("agentId", "startedAt")`);

        // Create ScrapedLead table
        await prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "ScrapedLead" (
                "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
                "agentRunId" TEXT,
                "name" TEXT NOT NULL,
                "phone" TEXT,
                "email" TEXT,
                "website" TEXT,
                "address" TEXT,
                "city" TEXT,
                "market" TEXT NOT NULL,
                "source" TEXT NOT NULL DEFAULT 'google',
                "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
                "rating" DOUBLE PRECISION,
                "reviewCount" INTEGER,
                "googlePlaceId" TEXT,
                "googleMapsUrl" TEXT,
                "yelpUrl" TEXT,
                "hasOnlineBooking" BOOLEAN NOT NULL DEFAULT false,
                "hasQuoteForm" BOOLEAN NOT NULL DEFAULT false,
                "hasCta" BOOLEAN NOT NULL DEFAULT false,
                "mobileFriendly" BOOLEAN NOT NULL DEFAULT true,
                "sslValid" BOOLEAN NOT NULL DEFAULT true,
                "loadTimeSeconds" DOUBLE PRECISION,
                "techDetected" TEXT[] DEFAULT ARRAY[]::TEXT[],
                "socialLinks" JSONB,
                "contactPageUrl" TEXT,
                "smsMentioned" BOOLEAN NOT NULL DEFAULT false,
                "ownerName" TEXT,
                "notesFlags" TEXT[] DEFAULT ARRAY[]::TEXT[],
                "websiteScore" INTEGER NOT NULL DEFAULT 0,
                "leadScore" INTEGER NOT NULL DEFAULT 0,
                "grade" TEXT NOT NULL DEFAULT 'C',
                "qualification" TEXT NOT NULL DEFAULT 'NO',
                "reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
                "painPoints" TEXT[] DEFAULT ARRAY[]::TEXT[],
                "analysisSummary" TEXT,
                "analysisScore" INTEGER,
                "outreachStatus" TEXT NOT NULL DEFAULT 'new',
                "emailedAt" TIMESTAMP(3),
                "smsSentAt" TIMESTAMP(3),
                "repliedAt" TIMESTAMP(3),
                "convertedAt" TIMESTAMP(3),
                "outreachNotes" TEXT,
                "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "ScrapedLead_pkey" PRIMARY KEY ("id"),
                CONSTRAINT "ScrapedLead_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "SyjAgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE
            )
        `);
        await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "ScrapedLead_googlePlaceId_key" ON "ScrapedLead"("googlePlaceId")`);
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ScrapedLead_grade_outreachStatus_idx" ON "ScrapedLead"("grade", "outreachStatus")`);
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ScrapedLead_market_idx" ON "ScrapedLead"("market")`);
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ScrapedLead_agentRunId_idx" ON "ScrapedLead"("agentRunId")`);

        // Create BlogPost table
        await prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "BlogPost" (
                "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
                "agentRunId" TEXT,
                "title" TEXT NOT NULL,
                "slug" TEXT NOT NULL,
                "metaDescription" TEXT,
                "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
                "content" JSONB NOT NULL,
                "excerpt" TEXT,
                "topic" TEXT,
                "category" TEXT,
                "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
                "wordCount" INTEGER NOT NULL DEFAULT 0,
                "sources" JSONB,
                "status" TEXT NOT NULL DEFAULT 'draft',
                "publishedAt" TIMESTAMP(3),
                "rejectedReason" TEXT,
                "githubSha" TEXT,
                "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "BlogPost_pkey" PRIMARY KEY ("id"),
                CONSTRAINT "BlogPost_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "SyjAgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE
            )
        `);
        await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "BlogPost_slug_key" ON "BlogPost"("slug")`);
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "BlogPost_status_idx" ON "BlogPost"("status")`);
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "BlogPost_agentRunId_idx" ON "BlogPost"("agentRunId")`);

        // Add target column to BlogPost if missing
        await prisma.$executeRawUnsafe(`ALTER TABLE "BlogPost" ADD COLUMN IF NOT EXISTS "target" TEXT DEFAULT 'syj'`);
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "BlogPost_target_idx" ON "BlogPost"("target")`);

        // Create OutreachLog table
        await prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "OutreachLog" (
                "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
                "leadId" TEXT,
                "channel" TEXT NOT NULL,
                "direction" TEXT NOT NULL DEFAULT 'outbound',
                "sender" TEXT NOT NULL DEFAULT 'agent',
                "subject" TEXT,
                "content" TEXT NOT NULL,
                "status" TEXT NOT NULL DEFAULT 'sent',
                "readAt" TIMESTAMP(3),
                "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "OutreachLog_pkey" PRIMARY KEY ("id"),
                CONSTRAINT "OutreachLog_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "ScrapedLead"("id") ON DELETE CASCADE ON UPDATE CASCADE
            )
        `);
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "OutreachLog_leadId_idx" ON "OutreachLog"("leadId")`);
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "OutreachLog_direction_idx" ON "OutreachLog"("direction")`);

        // Create GeneratedContent table
        await prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "GeneratedContent" (
                "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
                "agentRunId" TEXT,
                "contentType" TEXT NOT NULL,
                "feature" TEXT NOT NULL,
                "platform" TEXT NOT NULL,
                "title" TEXT NOT NULL,
                "script" JSONB NOT NULL,
                "voiceoverUrl" TEXT,
                "videoUrl" TEXT,
                "thumbnailUrl" TEXT,
                "duration" INTEGER NOT NULL DEFAULT 0,
                "status" TEXT NOT NULL DEFAULT 'rendering',
                "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "GeneratedContent_pkey" PRIMARY KEY ("id"),
                CONSTRAINT "GeneratedContent_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "SyjAgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE
            )
        `);
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "GeneratedContent_status_idx" ON "GeneratedContent"("status")`);

        return NextResponse.json({ ok: true, message: "All 6 agent tables created successfully" });
    } catch (err) {
        console.error("Migration error:", err);
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}
