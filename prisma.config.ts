import path from "node:path";
import { PrismaConfig } from "prisma";
import { PrismaPg } from "@prisma/adapter-pg";

// Strip channel_binding from the connection string (not supported by pg driver)
function cleanUrl(url: string): string {
    return url.replace(/[&?]channel_binding=[^&]*/g, "");
}

export default {
    earlyAccess: true,
    schema: path.join("prisma", "schema.prisma"),
    migrate: {
        async adapter() {
            const url = cleanUrl(process.env.DIRECT_URL || process.env.DATABASE_URL || "");
            const pg = await import("pg");
            const pool = new pg.default.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
            return new PrismaPg(pool);
        },
    },
} satisfies PrismaConfig;
