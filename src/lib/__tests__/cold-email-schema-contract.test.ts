import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const schema = readFileSync(join(process.cwd(), "prisma", "schema.prisma"), "utf8");

function modelBlock(name: string) {
    const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`, "m"));
    assert.ok(match, `Expected Prisma model ${name}`);
    return match[1];
}

const packageOneModels = [
    "ColdEmailCompany",
    "ColdEmailContact",
    "ColdEmailEmailIdentity",
    "ColdEmailDoNotContact",
    "ColdEmailAffiliation",
    "ColdEmailIdentityReview",
    "ColdEmailTemporaryHold",
    "ColdEmailTemplateVersion",
    "ColdEmailSequenceVersion",
    "ColdEmailSequenceStep",
    "ColdEmailVariant",
    "ColdEmailCampaign",
    "ColdEmailCampaignVersion",
    "ColdEmailCampaignTimezoneGroup",
    "ColdEmailAudienceSnapshot",
    "ColdEmailAudienceMember",
    "ColdEmailEnrollment",
    "ColdEmailVariantAssignment",
    "ColdEmailEligibilityDecision",
    "ColdEmailSendingDomain",
    "ColdEmailSendingAccount",
    "ColdEmailSendingPool",
    "ColdEmailSendingPoolMembership",
    "ColdEmailCapacityReservation",
    "ColdEmailHealthSnapshot",
    "ColdEmailProviderMapping",
    "ColdEmailProviderCapability",
    "ColdEmailProviderOperation",
    "ColdEmailProviderEvent",
    "ColdEmailSyncCursor",
    "ColdEmailReconciliationRun",
    "ColdEmailDeadLetter",
    "ColdEmailAlert",
    "ColdEmailAuditEvent",
] as const;

const packageTwoModels = [
    "ColdEmailOperator",
    "ColdEmailConversation",
    "ColdEmailThread",
    "ColdEmailMessage",
    "ColdEmailAttachmentMetadata",
    "ColdEmailDraft",
    "ColdEmailScheduledReply",
    "ColdEmailReminder",
    "ColdEmailSnooze",
    "ColdEmailAssignment",
    "ColdEmailOpportunity",
    "ColdEmailOpportunityStageHistory",
    "ColdEmailTask",
    "ColdEmailMeeting",
    "ColdEmailProposal",
    "ColdEmailAttributionToken",
    "ColdEmailAttributionTouch",
    "ColdEmailCustomerLink",
    "ColdEmailPaymentProjection",
    "ColdEmailManualPaymentEvidence",
    "ColdEmailBlackoutDate",
    "ColdEmailPlacementTest",
    "ColdEmailSavedView",
    "ColdEmailExportJob",
    "ColdEmailRetentionRun",
    "ColdEmailMetricSnapshot",
] as const;

test("cold-email schema package declares every namespaced model exactly once", () => {
    for (const name of [...packageOneModels, ...packageTwoModels]) {
        assert.equal(schema.match(new RegExp(`^model ${name} \\{`, "gm"))?.length, 1, name);
    }
});

test("inbox and conversion package preserves cross-system ownership links", () => {
    assert.match(modelBlock("User"), /coldEmailCustomerLink\s+ColdEmailCustomerLink\?/);
    assert.match(modelBlock("DemoBooking"), /coldEmailMeeting\s+ColdEmailMeeting\?/);
    assert.match(modelBlock("ColdEmailMessage"), /contentExpiresAt\s+DateTime/);
    assert.match(modelBlock("ColdEmailScheduledReply"), /providerOperationId\s+String\?\s+@unique/);
    assert.match(modelBlock("ColdEmailAttributionToken"), /tokenHash\s+String\s+@unique/);
    assert.match(modelBlock("ColdEmailCustomerLink"), /scaleYourJunkUserId\s+String\?\s+@unique/);
    assert.match(modelBlock("ColdEmailPaymentProjection"), /stripeEventId\s+String\?\s+@unique/);
    assert.match(modelBlock("ColdEmailManualPaymentEvidence"), /idempotencyKey\s+String\s+@unique/);
});

test("schema package adds only the expected inverse relations to legacy models", () => {
    assert.match(modelBlock("ScrapedLead"), /coldEmailContact\s+ColdEmailContact\?/);
    assert.match(modelBlock("ScrapedLead"), /coldEmailAudienceMembers\s+ColdEmailAudienceMember\[\]/);
    assert.match(modelBlock("LeadGroup"), /coldEmailAudienceSnapshots\s+ColdEmailAudienceSnapshot\[\]/);
    assert.match(modelBlock("EmailTemplate"), /coldEmailTemplateVersions\s+ColdEmailTemplateVersion\[\]/);
    assert.match(modelBlock("CampaignLaunch"), /canonicalCampaign\s+ColdEmailCampaign\?/);
});

test("manual Do Not Contact is auditable and never represented as compliance policy", () => {
    const dnc = modelBlock("ColdEmailDoNotContact");
    assert.match(dnc, /source\s+String\s+@default\("manual"\)/);
    assert.match(dnc, /createdBy\s+String/);
    assert.match(dnc, /releasedBy\s+String\?/);
    assert.match(dnc, /releaseReason\s+String\?/);
    assert.match(dnc, /providerBlockState\s+String/);
    assert.match(dnc, /activeKey\s+String\?\s+@unique/);
    assert.doesNotMatch(schema, /^model ColdEmailCompliance/m);
    assert.doesNotMatch(schema, /^model (CompliancePolicy|PolicyVersion|PolicySnapshot)/m);
});

test("shared email addresses are not globally merged", () => {
    const identity = modelBlock("ColdEmailEmailIdentity");
    assert.match(identity, /normalizedEmail\s+String\s*(?:\n|\/\/)/);
    assert.doesNotMatch(identity, /normalizedEmail\s+String\s+@unique/);
    assert.match(identity, /@@unique\(\[contactId, normalizedEmail\]\)/);
    assert.match(identity, /providerUnsubscribedAt\s+DateTime\?/);
});

test("provider mutations have durable reconciliation fields", () => {
    const operation = modelBlock("ColdEmailProviderOperation");
    for (const field of [
        "idempotencyKey",
        "requestFingerprint",
        "redactedRequestPayload",
        "state",
        "attemptCount",
        "nextAttemptAt",
        "leaseOwner",
        "leaseExpiresAt",
        "heartbeatAt",
        "redactedError",
        "reconciliationStrategy",
    ]) {
        assert.match(operation, new RegExp(`\\b${field}\\b`), field);
    }
});

test("recipient-timezone provider grouping is durable and enrollment-scoped", () => {
    const group = modelBlock("ColdEmailCampaignTimezoneGroup");
    assert.match(group, /@@unique\(\[campaignVersionId, timezone\]\)/);
    const enrollment = modelBlock("ColdEmailEnrollment");
    assert.match(enrollment, /timezoneGroupId\s+String\?/);
    assert.match(enrollment, /timezoneSource\s+String\s+@default\("campaign_fallback"\)/);
});

test("provider events have recoverable expiring processing leases", () => {
    const model = modelBlock("ColdEmailProviderEvent");
    for (const field of [
        "processingAttemptCount",
        "processingLeaseOwner",
        "processingLeaseExpiresAt",
        "processingHeartbeatAt",
        "nextProcessingAttemptAt",
    ]) {
        assert.match(model, new RegExp(`\\b${field}\\b`));
    }
});

test("canonical operational records retain idempotency and provider field units", () => {
    assert.match(modelBlock("ColdEmailAttachmentMetadata"), /fingerprint\s+String\s+@unique/);
    assert.match(modelBlock("ColdEmailDeadLetter"), /dedupeKey\s+String\s+@unique/);
    const account = modelBlock("ColdEmailSendingAccount");
    assert.match(account, /sendingGapMinutes\s+Int\?/);
    assert.doesNotMatch(account, /sendingGapSeconds/);
});

test("schema braces remain balanced without invoking Prisma", () => {
    const opens = schema.match(/\{/g)?.length ?? 0;
    const closes = schema.match(/\}/g)?.length ?? 0;
    assert.equal(opens, closes);
});

test("every explicit Cold Email relation has an inverse model field", () => {
    const blocks = new Map(
        Array.from(schema.matchAll(/^model\s+(\w+)\s+\{([\s\S]*?)^\}/gm), (match) => [match[1], match[2]] as const),
    );
    const missing: string[] = [];
    for (const [modelName, block] of blocks) {
        if (!modelName.startsWith("ColdEmail")) continue;
        for (const line of block.split("\n")) {
            const relation = line.match(/^\s*(\w+)\s+(\w+)\??\s+@relation(?:\("([^"]+)"|\()/);
            if (!relation) continue;
            const [, fieldName, targetName, relationName] = relation;
            const targetBlock = blocks.get(targetName);
            if (!targetBlock) {
                missing.push(`${modelName}.${fieldName} -> missing model ${targetName}`);
                continue;
            }
            const inverseType = new RegExp(`^\\s*\\w+\\s+${modelName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\?|\\[\\])`, "m");
            if (!inverseType.test(targetBlock)) {
                missing.push(`${modelName}.${fieldName} -> ${targetName} has no ${modelName} inverse`);
                continue;
            }
            if (relationName && !new RegExp(`@relation\\("${relationName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`).test(targetBlock)) {
                missing.push(`${modelName}.${fieldName} -> ${targetName} lacks relation name ${relationName}`);
            }
        }
    }
    assert.deepEqual(missing, []);
});
