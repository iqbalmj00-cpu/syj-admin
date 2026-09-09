// Bounded reference inventory, verified against ScaleYourJunk vercel.json on
// 2026-09-09. This is a source snapshot, not live deployment/runner evidence.
// Maintain here until the owning application supplies a versioned inventory.
export const GENERAL_CRON_INVENTORY = [
    { jobName: "weekly-report", schedules: [{ path: "/api/cron/weekly-report?frequency=daily", schedule: "0 14 * * *" }, { path: "/api/cron/weekly-report?frequency=weekly", schedule: "0 14 * * 5" }] },
    { jobName: "follow-up", schedules: [{ path: "/api/cron/follow-up", schedule: "*/5 * * * *" }] },
    { jobName: "review-chaser", schedules: [{ path: "/api/cron/review-chaser", schedule: "*/5 * * * *" }] },
    { jobName: "plan-tomorrow", schedules: [{ path: "/api/cron/plan-tomorrow", schedule: "0 * * * *" }] },
    { jobName: "payment-reminders", schedules: [{ path: "/api/cron/payment-reminders", schedule: "0 15 * * *" }] },
    { jobName: "re-engagement", schedules: [{ path: "/api/cron/re-engagement", schedule: "0 16 * * *" }] },
    { jobName: "maintenance-alerts", schedules: [{ path: "/api/cron/maintenance-alerts", schedule: "0 13 * * 1" }] },
    { jobName: "day-before-reminder", schedules: [{ path: "/api/cron/day-before-reminder", schedule: "0 22 * * *" }] },
    { jobName: "recurring-jobs", schedules: [{ path: "/api/cron/recurring-jobs", schedule: "0 5 * * *" }] },
    { jobName: "data-cleanup", schedules: [{ path: "/api/cron/data-cleanup", schedule: "0 3 * * *" }] },
    { jobName: "lock-routes", schedules: [] },
    { jobName: "estimate-expiry", schedules: [] },
].map(job => ({
    ...job,
    owner: "ScaleYourJunk",
    definitionStatus: job.schedules.length ? "scheduled_in_reference" : "absent_from_reference",
    definitionReviewedAt: "2026-09-09",
    invocationEvidence: "not_connected",
}));
