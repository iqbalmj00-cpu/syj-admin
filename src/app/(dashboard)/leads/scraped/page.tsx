"use client";

import { useEffect, useState, useCallback } from "react";
import { Badge } from "@/components/ui/Badge";
import { Kpi } from "@/components/ui/Kpi";
import { painTagsByCategory, praiseTagsByCategory } from "@/lib/pain-taxonomy";

interface Lead {
    id: string; name: string; phone: string | null; email: string | null; website: string | null;
    market: string; grade: string; leadScore: number; websiteScore: number; qualification: string;
    outreachStatus: string; painPoints: string[]; reasons: string[]; notesFlags: string[];
    createdAt: string;
    // Enrichment fields
    serviceTypes?: string[]; phoneType?: string | null; hasActiveWebsite?: boolean;
    usingCompetitor?: boolean; competitorPlatform?: string | null;
    estimatedEmployees?: number | null; estimatedFleetSize?: number | null;
    serviceAreaCities?: string[]; serviceAreaSize?: string | null;
    enrichedAt?: string | null; isExistingClient?: boolean;
    emailDeliverable?: boolean | null; emailRiskScore?: number | null; emailVerifiedAt?: string | null;
    emailVerificationState?: string | null; emailVerificationReason?: string | null; emailVerificationScore?: number | null;
    emailCleanedAt?: string | null; archivedAt?: string | null; archiveReason?: string | null;
}

interface FunnelData { total: number; new: number; emailed: number; sms_sent: number; replied: number; converted: number; skipped: number }

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
    return (
        <button onClick={onClick} style={{
            padding: "5px 12px", fontSize: 11, fontWeight: active ? 600 : 500, cursor: "pointer",
            border: "1px solid", borderColor: active ? "var(--border)" : "transparent",
            borderRadius: 6, background: active ? "var(--white)" : "transparent",
            color: active ? "var(--text)" : "var(--text-light)", transition: "all 0.1s",
            boxShadow: active ? "0 1px 2px rgba(0,0,0,0.02)" : "none"
        }}>{label}</button>
    );
}

export default function ScrapedLeadsPage() {
    const [leads, setLeads] = useState<Lead[]>([]);
    const [funnel, setFunnel] = useState<FunnelData>({ total: 0, new: 0, emailed: 0, sms_sent: 0, replied: 0, converted: 0, skipped: 0 });
    const [loading, setLoading] = useState(true);
    const [toast, setToast] = useState<{ msg: string; type: string } | null>(null);

    // Filters
    const [gradeFilter, setGradeFilter] = useState<string>("all");
    const [outreachFilter, setOutreachFilter] = useState<string>("all");
    const [searchQuery, setSearchQuery] = useState("");
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);
    const [sortBy, setSortBy] = useState("createdAt");
    const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
    const [marketFilter, setMarketFilter] = useState("all");
    const [availableMarkets, setAvailableMarkets] = useState<string[]>([]);
    const [companyTypeFilter, setCompanyTypeFilter] = useState("all");
    const [enrichedFilter, setEnrichedFilter] = useState("all");
    const [competitorFilter, setCompetitorFilter] = useState("all");
    const [phoneTypeFilter, setPhoneTypeFilter] = useState("all");
    const [existingClientFilter, setExistingClientFilter] = useState("false");
    // Data presence filters
    const [hasOwnerName, setHasOwnerName] = useState("all");
    const [hasPhone, setHasPhone] = useState("all");
    const [hasEmail, setHasEmail] = useState("all");
    const [hasWebsite, setHasWebsite] = useState("all");
    const [sourceFilter, setSourceFilter] = useState("all");
    const [diyFilter, setDiyFilter] = useState("all");
    const [serviceTypeFilter, setServiceTypeFilter] = useState("all");
    // Segmentation filters — review / business age / booking
    const [reviewPainFilter, setReviewPainFilter] = useState("all");
    const [reviewCountRangeFilter, setReviewCountRangeFilter] = useState("all");
    const [ownerResponseRateFilter, setOwnerResponseRateFilter] = useState("all");
    const [lastReviewWithinDays, setLastReviewWithinDays] = useState("all");
    const [yearsInBusinessRangeFilter, setYearsInBusinessRangeFilter] = useState("all");
    const [hasTrueBookingFilter, setHasTrueBookingFilter] = useState("all");
    const [bookingFlowTypeFilter, setBookingFlowTypeFilter] = useState("all");
    // Canonical pain/praise tag filters (multi-select — AND semantics)
    const [selectedPainTags, setSelectedPainTags] = useState<Set<string>>(new Set());
    const [selectedPraiseTags, setSelectedPraiseTags] = useState<Set<string>>(new Set());
    const [painTagCountMin, setPainTagCountMin] = useState("all");
    const [negativeReviewPercentMin, setNegativeReviewPercentMin] = useState("all");
    const [mostRecentNegativeWithinDays, setMostRecentNegativeWithinDays] = useState("all");
    // GBP filters (Phase 2)
    const [starRatingBucket, setStarRatingBucket] = useState("all");
    const [profileCompletenessBucket, setProfileCompletenessBucket] = useState("all");
    const [respondsToNegatives, setRespondsToNegatives] = useState("all");
    const [hasRecentGbpPosts, setHasRecentGbpPosts] = useState("all");
    const [hasBusinessDescription, setHasBusinessDescription] = useState("all");
    // Booking sophistication (Phase 2.5)
    const [selectedBookingTiers, setSelectedBookingTiers] = useState<Set<string>>(new Set());
    const [bookingHasInstantQuote, setBookingHasInstantQuote] = useState("all");
    const [bookingHasJobSizeInput, setBookingHasJobSizeInput] = useState("all");
    const [bookingHasItemSelector, setBookingHasItemSelector] = useState("all");
    const [bookingCollectsPayment, setBookingCollectsPayment] = useState("all");
    const [bookingIsQuoteRequestOnly, setBookingIsQuoteRequestOnly] = useState("all");
    // Competitor + payment stack (Phase 3)
    const [selectedCompetitorStack, setSelectedCompetitorStack] = useState<Set<string>>(new Set());
    const [selectedPaymentStack, setSelectedPaymentStack] = useState<Set<string>>(new Set());
    const [mentionsCashOnly, setMentionsCashOnly] = useState("all");
    const [hasOnlinePayment, setHasOnlinePayment] = useState("all");
    // Phase 4 — captured-but-dark filters
    const [selectedCms, setSelectedCms] = useState<Set<string>>(new Set());
    const [selectedBookingPlatforms, setSelectedBookingPlatforms] = useState<Set<string>>(new Set());
    const [bookingCtaTargetsPhone, setBookingCtaTargetsPhone] = useState("all");
    const [marketingMaturityBucket, setMarketingMaturityBucket] = useState("all");
    const [loadTimeBucket, setLoadTimeBucket] = useState("all");
    const [mobileFriendly, setMobileFriendly] = useState("all");
    const [sslValid, setSslValid] = useState("all");
    const [hasGoogleAds, setHasGoogleAds] = useState("all");
    const [hasCallTracking, setHasCallTracking] = useState("all");
    const [hasChatWidget, setHasChatWidget] = useState("all");
    const [hasGTM, setHasGTM] = useState("all");
    const [hasFacebookPixel, setHasFacebookPixel] = useState("all");
    const [hasGoogleAnalytics, setHasGoogleAnalytics] = useState("all");
    const [employeeBucket, setEmployeeBucket] = useState("all");
    const [fleetBucket, setFleetBucket] = useState("all");
    const [selectedWebsiteBuiltBy, setSelectedWebsiteBuiltBy] = useState<Set<string>>(new Set());
    const [selectedMarketCompetitionLevel, setSelectedMarketCompetitionLevel] = useState<Set<string>>(new Set());
    const [marketRankPercentileMin, setMarketRankPercentileMin] = useState("all");
    const [hasFacebook, setHasFacebook] = useState("all");
    const [hasYouTube, setHasYouTube] = useState("all");
    const [isVeteranOwned, setIsVeteranOwned] = useState("all");
    const [isFamilyBusiness, setIsFamilyBusiness] = useState("all");
    const [reviewVelocityBucket, setReviewVelocityBucket] = useState("all");
    // Phase 5 — contact quality
    const [selectedEmailDomainType, setSelectedEmailDomainType] = useState<Set<string>>(new Set());
    const [emailDomainMatchesWebsite, setEmailDomainMatchesWebsite] = useState("all");
    const [emailDeliverable, setEmailDeliverable] = useState("all");
    const [emailVerificationState, setEmailVerificationState] = useState("all");
    const [selectedPhoneLineType, setSelectedPhoneLineType] = useState<Set<string>>(new Set());
    const [phoneDeliverable, setPhoneDeliverable] = useState("all");
    const [hasOwnerFullName, setHasOwnerFullName] = useState("all");
    const [hasOwnerLinkedIn, setHasOwnerLinkedIn] = useState("all");
    const [isDirectContact, setIsDirectContact] = useState("all");
    // Phase 6 — website crawl depth
    const [lastUpdatedYearBucket, setLastUpdatedYearBucket] = useState("all");
    const [hasPricingPage, setHasPricingPage] = useState("all");
    const [hasBlog, setHasBlog] = useState("all");
    const [hasServiceAreaPublishedOnSite, setHasServiceAreaPublishedOnSite] = useState("all");
    const [totalPageCountBucket, setTotalPageCountBucket] = useState("all");
    // Personalization filters (HIGH-impact Round 7)
    const [selectedPrimaryBottleneck, setSelectedPrimaryBottleneck] = useState<Set<string>>(new Set());
    const [websiteAgeYearsMin, setWebsiteAgeYearsMin] = useState("all");
    // Round 8: trend + severity
    const [selectedReviewTrend, setSelectedReviewTrend] = useState<Set<string>>(new Set());
    const [painSeverityMin, setPainSeverityMin] = useState("all");
    const [showSegmentFilters, setShowSegmentFilters] = useState(false);
    const LEADS_PER_PAGE = 50;

    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [expandedLeadId, setExpandedLeadId] = useState<string | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [enriching, setEnriching] = useState(false);
    const [cleaningEmails, setCleaningEmails] = useState(false);
    const [sendingOutreach, setSendingOutreach] = useState(false);
    const [addingToGroup, setAddingToGroup] = useState(false);
    const [groups, setGroups] = useState<Array<{ id: string; name: string; memberCount: number }>>([]);
    const [showGroupSelect, setShowGroupSelect] = useState(false);
    const [newGroupName, setNewGroupName] = useState("");
    // Manual add lead
    const [showAddLead, setShowAddLead] = useState(false);
    const [addingLead, setAddingLead] = useState(false);
    const [newLead, setNewLead] = useState({ name: "", phone: "", email: "", website: "", market: "", ownerName: "" });
    const [archivedFilter, setArchivedFilter] = useState("active");

    const showToast = (msg: string, type = "success") => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };

    const fetchLeads = useCallback(async () => {
        try {
            const params = new URLSearchParams();
            if (gradeFilter !== "all") params.set("grade", gradeFilter);
            if (archivedFilter !== "active") params.set("archived", archivedFilter);
            if (outreachFilter !== "all") params.set("outreachStatus", outreachFilter);
            if (marketFilter !== "all") params.set("market", marketFilter);
            if (companyTypeFilter !== "all") params.set("companyType", companyTypeFilter);
            if (enrichedFilter !== "all") params.set("enriched", enrichedFilter);
            if (competitorFilter !== "all") params.set("usingCompetitor", competitorFilter);
            if (phoneTypeFilter !== "all") params.set("phoneType", phoneTypeFilter);
            if (existingClientFilter !== "all") params.set("isExistingClient", existingClientFilter);
            if (hasOwnerName !== "all") params.set("hasOwnerName", hasOwnerName);
            if (hasPhone !== "all") params.set("hasPhone", hasPhone);
            if (hasEmail !== "all") params.set("hasEmail", hasEmail);
            if (hasWebsite !== "all") params.set("hasWebsite", hasWebsite);
            if (sourceFilter !== "all") params.set("discoveredVia", sourceFilter);
            if (diyFilter !== "all") params.set("isDiyBuilder", diyFilter);
            if (serviceTypeFilter !== "all") params.set("serviceType", serviceTypeFilter);
            // Segmentation filters
            if (reviewPainFilter !== "all") params.set("reviewPain", reviewPainFilter);
            if (reviewCountRangeFilter !== "all") params.set("reviewCountRange", reviewCountRangeFilter);
            if (ownerResponseRateFilter !== "all") params.set("ownerResponseRateBucket", ownerResponseRateFilter);
            if (lastReviewWithinDays !== "all") params.set("lastReviewWithinDays", lastReviewWithinDays);
            if (yearsInBusinessRangeFilter !== "all") params.set("yearsInBusinessRange", yearsInBusinessRangeFilter);
            if (hasTrueBookingFilter !== "all") params.set("hasTrueOnlineBooking", hasTrueBookingFilter);
            if (bookingFlowTypeFilter !== "all") params.set("bookingFlowType", bookingFlowTypeFilter);
            if (selectedPainTags.size > 0) params.set("painTags", Array.from(selectedPainTags).join(","));
            if (selectedPraiseTags.size > 0) params.set("praiseTags", Array.from(selectedPraiseTags).join(","));
            if (painTagCountMin !== "all") params.set("painTagCountMin", painTagCountMin);
            if (negativeReviewPercentMin !== "all") params.set("negativeReviewPercentMin", negativeReviewPercentMin);
            if (mostRecentNegativeWithinDays !== "all") params.set("mostRecentNegativeWithinDays", mostRecentNegativeWithinDays);
            if (starRatingBucket !== "all") params.set("starRatingBucket", starRatingBucket);
            if (profileCompletenessBucket !== "all") params.set("profileCompletenessBucket", profileCompletenessBucket);
            if (respondsToNegatives !== "all") params.set("respondsToNegatives", respondsToNegatives);
            if (hasRecentGbpPosts !== "all") params.set("hasRecentGbpPosts", hasRecentGbpPosts);
            if (hasBusinessDescription !== "all") params.set("hasBusinessDescription", hasBusinessDescription);
            if (selectedBookingTiers.size > 0) params.set("bookingSophistication", Array.from(selectedBookingTiers).join(","));
            if (bookingHasInstantQuote !== "all") params.set("bookingHasInstantQuote", bookingHasInstantQuote);
            if (bookingHasJobSizeInput !== "all") params.set("bookingHasJobSizeInput", bookingHasJobSizeInput);
            if (bookingHasItemSelector !== "all") params.set("bookingHasItemSelector", bookingHasItemSelector);
            if (bookingCollectsPayment !== "all") params.set("bookingCollectsPayment", bookingCollectsPayment);
            if (bookingIsQuoteRequestOnly !== "all") params.set("bookingIsQuoteRequestOnly", bookingIsQuoteRequestOnly);
            if (selectedCompetitorStack.size > 0) params.set("competitorStack", Array.from(selectedCompetitorStack).join(","));
            if (selectedPaymentStack.size > 0) params.set("paymentStack", Array.from(selectedPaymentStack).join(","));
            if (mentionsCashOnly !== "all") params.set("mentionsCashOnly", mentionsCashOnly);
            if (hasOnlinePayment !== "all") params.set("hasOnlinePayment", hasOnlinePayment);
            if (selectedCms.size > 0) params.set("cmsDetected", Array.from(selectedCms).join(","));
            if (selectedBookingPlatforms.size > 0) params.set("bookingPlatform", Array.from(selectedBookingPlatforms).join(","));
            if (bookingCtaTargetsPhone !== "all") params.set("bookingCtaTargetsPhone", bookingCtaTargetsPhone);
            if (marketingMaturityBucket !== "all") params.set("marketingMaturityBucket", marketingMaturityBucket);
            if (loadTimeBucket !== "all") params.set("loadTimeBucket", loadTimeBucket);
            if (mobileFriendly !== "all") params.set("mobileFriendly", mobileFriendly);
            if (sslValid !== "all") params.set("sslValid", sslValid);
            if (hasGoogleAds !== "all") params.set("hasGoogleAds", hasGoogleAds);
            if (hasCallTracking !== "all") params.set("hasCallTracking", hasCallTracking);
            if (hasChatWidget !== "all") params.set("hasChatWidget", hasChatWidget);
            if (hasGTM !== "all") params.set("hasGTM", hasGTM);
            if (hasFacebookPixel !== "all") params.set("hasFacebookPixel", hasFacebookPixel);
            if (hasGoogleAnalytics !== "all") params.set("hasGoogleAnalytics", hasGoogleAnalytics);
            if (employeeBucket !== "all") params.set("employeeBucket", employeeBucket);
            if (fleetBucket !== "all") params.set("fleetBucket", fleetBucket);
            if (selectedWebsiteBuiltBy.size > 0) params.set("websiteBuiltBy", Array.from(selectedWebsiteBuiltBy).join(","));
            if (selectedMarketCompetitionLevel.size > 0) params.set("marketCompetitionLevel", Array.from(selectedMarketCompetitionLevel).join(","));
            if (marketRankPercentileMin !== "all") params.set("marketRankPercentileMin", marketRankPercentileMin);
            if (hasFacebook !== "all") params.set("hasFacebook", hasFacebook);
            if (hasYouTube !== "all") params.set("hasYouTube", hasYouTube);
            if (isVeteranOwned !== "all") params.set("isVeteranOwned", isVeteranOwned);
            if (isFamilyBusiness !== "all") params.set("isFamilyBusiness", isFamilyBusiness);
            if (reviewVelocityBucket !== "all") params.set("reviewVelocityBucket", reviewVelocityBucket);
            if (selectedEmailDomainType.size > 0) params.set("emailDomainType", Array.from(selectedEmailDomainType).join(","));
            if (emailDomainMatchesWebsite !== "all") params.set("emailDomainMatchesWebsite", emailDomainMatchesWebsite);
            if (emailDeliverable !== "all") params.set("emailDeliverable", emailDeliverable);
            if (emailVerificationState !== "all") params.set("emailVerificationState", emailVerificationState);
            if (selectedPhoneLineType.size > 0) params.set("phoneLineType", Array.from(selectedPhoneLineType).join(","));
            if (phoneDeliverable !== "all") params.set("phoneDeliverable", phoneDeliverable);
            if (hasOwnerFullName !== "all") params.set("hasOwnerFullName", hasOwnerFullName);
            if (hasOwnerLinkedIn !== "all") params.set("hasOwnerLinkedIn", hasOwnerLinkedIn);
            if (isDirectContact !== "all") params.set("isDirectContact", isDirectContact);
            if (lastUpdatedYearBucket !== "all") params.set("lastUpdatedYearBucket", lastUpdatedYearBucket);
            if (hasPricingPage !== "all") params.set("hasPricingPage", hasPricingPage);
            if (hasBlog !== "all") params.set("hasBlog", hasBlog);
            if (hasServiceAreaPublishedOnSite !== "all") params.set("hasServiceAreaPublishedOnSite", hasServiceAreaPublishedOnSite);
            if (totalPageCountBucket !== "all") params.set("totalPageCountBucket", totalPageCountBucket);
            if (selectedPrimaryBottleneck.size > 0) params.set("primaryBottleneck", Array.from(selectedPrimaryBottleneck).join(","));
            if (websiteAgeYearsMin !== "all") params.set("websiteAgeYearsMin", websiteAgeYearsMin);
            if (selectedReviewTrend.size > 0) params.set("recentReviewTrend", Array.from(selectedReviewTrend).join(","));
            if (painSeverityMin !== "all") params.set("painSeverityMin", painSeverityMin);
            if (searchQuery) params.set("search", searchQuery);
            params.set("page", String(page));
            params.set("limit", String(LEADS_PER_PAGE));
            params.set("sortBy", sortBy);
            params.set("sortOrder", sortOrder);
            
            const res = await fetch(`/api/agents/leads?${params}`);
            if (res.ok) {
                const data = await res.json();
                setLeads(data.leads);
                setTotal(data.total);
                setFunnel(data.funnel);
                if (data.markets) setAvailableMarkets(data.markets);
            }
        } catch { /* ignore */ }
        setLoading(false);
    }, [gradeFilter, archivedFilter, outreachFilter, marketFilter, companyTypeFilter, enrichedFilter, competitorFilter, phoneTypeFilter, existingClientFilter, hasOwnerName, hasPhone, hasEmail, hasWebsite, sourceFilter, diyFilter, serviceTypeFilter, reviewPainFilter, reviewCountRangeFilter, ownerResponseRateFilter, lastReviewWithinDays, yearsInBusinessRangeFilter, hasTrueBookingFilter, bookingFlowTypeFilter, selectedPainTags, selectedPraiseTags, painTagCountMin, negativeReviewPercentMin, mostRecentNegativeWithinDays, starRatingBucket, profileCompletenessBucket, respondsToNegatives, hasRecentGbpPosts, hasBusinessDescription, selectedBookingTiers, bookingHasInstantQuote, bookingHasJobSizeInput, bookingHasItemSelector, bookingCollectsPayment, bookingIsQuoteRequestOnly, selectedCompetitorStack, selectedPaymentStack, mentionsCashOnly, hasOnlinePayment, selectedCms, selectedBookingPlatforms, bookingCtaTargetsPhone, marketingMaturityBucket, loadTimeBucket, mobileFriendly, sslValid, hasGoogleAds, hasCallTracking, hasChatWidget, hasGTM, hasFacebookPixel, hasGoogleAnalytics, employeeBucket, fleetBucket, selectedWebsiteBuiltBy, selectedMarketCompetitionLevel, marketRankPercentileMin, hasFacebook, hasYouTube, isVeteranOwned, isFamilyBusiness, reviewVelocityBucket, selectedEmailDomainType, emailDomainMatchesWebsite, emailDeliverable, emailVerificationState, selectedPhoneLineType, phoneDeliverable, hasOwnerFullName, hasOwnerLinkedIn, isDirectContact, lastUpdatedYearBucket, hasPricingPage, hasBlog, hasServiceAreaPublishedOnSite, totalPageCountBucket, selectedPrimaryBottleneck, websiteAgeYearsMin, selectedReviewTrend, painSeverityMin, searchQuery, page, sortBy, sortOrder]);

    useEffect(() => { fetchLeads(); }, [fetchLeads]);
    useEffect(() => { fetch("/api/agents/lead-groups").then(r => r.json()).then(d => setGroups(d.groups || [])).catch(() => {}); }, []);

    const addToGroup = async (groupId: string) => {
        if (selectedIds.size === 0) return;
        setAddingToGroup(true);
        try {
            const res = await fetch("/api/agents/lead-groups/members", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ groupId, leadIds: Array.from(selectedIds) }),
            });
            const data = await res.json();
            if (res.ok) { showToast(`Added ${data.added} lead(s) to group`); setSelectedIds(new Set()); setSelectAllMatching(false); setShowGroupSelect(false); }
            else showToast(data.error || "Failed to add to group", "error");
        } catch { showToast("Failed to add to group", "error"); }
        setAddingToGroup(false);
    };

    const createGroupAndAdd = async () => {
        if (!newGroupName.trim() || selectedIds.size === 0) return;
        setAddingToGroup(true);
        try {
            const createRes = await fetch("/api/agents/lead-groups", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: newGroupName.trim(), channel: "sms" }),
            });
            if (!createRes.ok) { showToast("Failed to create group", "error"); setAddingToGroup(false); return; }
            const group = await createRes.json();
            await addToGroup(group.id);
            setNewGroupName("");
            // Refresh groups list
            fetch("/api/agents/lead-groups").then(r => r.json()).then(d => setGroups(d.groups || [])).catch(() => {});
        } catch { showToast("Failed to create group", "error"); }
        setAddingToGroup(false);
    };

    const totalPages = Math.max(1, Math.ceil(total / LEADS_PER_PAGE));
    const [selectAllMatching, setSelectAllMatching] = useState(false);
    const [loadingSelectAll, setLoadingSelectAll] = useState(false);
    const allOnPageSelected = leads.length > 0 && leads.every(l => selectedIds.has(l.id));
    const canSelectAllMatching = allOnPageSelected && total > leads.length && !selectAllMatching;

    const toggleSelect = (id: string) => setSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });
    const toggleSelectAll = () => {
        // Clicking the header checkbox toggles only the current page.
        // "Select all matching" is a separate explicit action via the banner below.
        if (allOnPageSelected) {
            setSelectedIds(new Set());
            setSelectAllMatching(false);
        } else {
            setSelectedIds(new Set(leads.map(l => l.id)));
        }
    };

    // "Select all matching filters across every page" — explicit second click via the banner.
    // Issues one query with `idsOnly=true` that respects every active filter.
    const selectAllMatchingLeads = async () => {
        if (loadingSelectAll) return;
        setLoadingSelectAll(true);
        try {
            const params = new URLSearchParams();
            if (gradeFilter !== "all") params.set("grade", gradeFilter);
            if (archivedFilter !== "active") params.set("archived", archivedFilter);
            if (outreachFilter !== "all") params.set("outreachStatus", outreachFilter);
            if (marketFilter !== "all") params.set("market", marketFilter);
            if (companyTypeFilter !== "all") params.set("companyType", companyTypeFilter);
            if (enrichedFilter !== "all") params.set("enriched", enrichedFilter);
            if (competitorFilter !== "all") params.set("usingCompetitor", competitorFilter);
            if (phoneTypeFilter !== "all") params.set("phoneType", phoneTypeFilter);
            if (existingClientFilter !== "all") params.set("isExistingClient", existingClientFilter);
            if (hasOwnerName !== "all") params.set("hasOwnerName", hasOwnerName);
            if (hasPhone !== "all") params.set("hasPhone", hasPhone);
            if (hasEmail !== "all") params.set("hasEmail", hasEmail);
            if (hasWebsite !== "all") params.set("hasWebsite", hasWebsite);
            if (sourceFilter !== "all") params.set("discoveredVia", sourceFilter);
            if (diyFilter !== "all") params.set("isDiyBuilder", diyFilter);
            if (serviceTypeFilter !== "all") params.set("serviceType", serviceTypeFilter);
            if (reviewPainFilter !== "all") params.set("reviewPain", reviewPainFilter);
            if (reviewCountRangeFilter !== "all") params.set("reviewCountRange", reviewCountRangeFilter);
            if (ownerResponseRateFilter !== "all") params.set("ownerResponseRateBucket", ownerResponseRateFilter);
            if (lastReviewWithinDays !== "all") params.set("lastReviewWithinDays", lastReviewWithinDays);
            if (yearsInBusinessRangeFilter !== "all") params.set("yearsInBusinessRange", yearsInBusinessRangeFilter);
            if (hasTrueBookingFilter !== "all") params.set("hasTrueOnlineBooking", hasTrueBookingFilter);
            if (bookingFlowTypeFilter !== "all") params.set("bookingFlowType", bookingFlowTypeFilter);
            if (selectedPainTags.size > 0) params.set("painTags", Array.from(selectedPainTags).join(","));
            if (selectedPraiseTags.size > 0) params.set("praiseTags", Array.from(selectedPraiseTags).join(","));
            if (painTagCountMin !== "all") params.set("painTagCountMin", painTagCountMin);
            if (negativeReviewPercentMin !== "all") params.set("negativeReviewPercentMin", negativeReviewPercentMin);
            if (mostRecentNegativeWithinDays !== "all") params.set("mostRecentNegativeWithinDays", mostRecentNegativeWithinDays);
            if (starRatingBucket !== "all") params.set("starRatingBucket", starRatingBucket);
            if (profileCompletenessBucket !== "all") params.set("profileCompletenessBucket", profileCompletenessBucket);
            if (respondsToNegatives !== "all") params.set("respondsToNegatives", respondsToNegatives);
            if (hasRecentGbpPosts !== "all") params.set("hasRecentGbpPosts", hasRecentGbpPosts);
            if (hasBusinessDescription !== "all") params.set("hasBusinessDescription", hasBusinessDescription);
            if (selectedBookingTiers.size > 0) params.set("bookingSophistication", Array.from(selectedBookingTiers).join(","));
            if (bookingHasInstantQuote !== "all") params.set("bookingHasInstantQuote", bookingHasInstantQuote);
            if (bookingHasJobSizeInput !== "all") params.set("bookingHasJobSizeInput", bookingHasJobSizeInput);
            if (bookingHasItemSelector !== "all") params.set("bookingHasItemSelector", bookingHasItemSelector);
            if (bookingCollectsPayment !== "all") params.set("bookingCollectsPayment", bookingCollectsPayment);
            if (bookingIsQuoteRequestOnly !== "all") params.set("bookingIsQuoteRequestOnly", bookingIsQuoteRequestOnly);
            if (selectedCompetitorStack.size > 0) params.set("competitorStack", Array.from(selectedCompetitorStack).join(","));
            if (selectedPaymentStack.size > 0) params.set("paymentStack", Array.from(selectedPaymentStack).join(","));
            if (mentionsCashOnly !== "all") params.set("mentionsCashOnly", mentionsCashOnly);
            if (hasOnlinePayment !== "all") params.set("hasOnlinePayment", hasOnlinePayment);
            if (selectedCms.size > 0) params.set("cmsDetected", Array.from(selectedCms).join(","));
            if (selectedBookingPlatforms.size > 0) params.set("bookingPlatform", Array.from(selectedBookingPlatforms).join(","));
            if (bookingCtaTargetsPhone !== "all") params.set("bookingCtaTargetsPhone", bookingCtaTargetsPhone);
            if (marketingMaturityBucket !== "all") params.set("marketingMaturityBucket", marketingMaturityBucket);
            if (loadTimeBucket !== "all") params.set("loadTimeBucket", loadTimeBucket);
            if (mobileFriendly !== "all") params.set("mobileFriendly", mobileFriendly);
            if (sslValid !== "all") params.set("sslValid", sslValid);
            if (hasGoogleAds !== "all") params.set("hasGoogleAds", hasGoogleAds);
            if (hasCallTracking !== "all") params.set("hasCallTracking", hasCallTracking);
            if (hasChatWidget !== "all") params.set("hasChatWidget", hasChatWidget);
            if (hasGTM !== "all") params.set("hasGTM", hasGTM);
            if (hasFacebookPixel !== "all") params.set("hasFacebookPixel", hasFacebookPixel);
            if (hasGoogleAnalytics !== "all") params.set("hasGoogleAnalytics", hasGoogleAnalytics);
            if (employeeBucket !== "all") params.set("employeeBucket", employeeBucket);
            if (fleetBucket !== "all") params.set("fleetBucket", fleetBucket);
            if (selectedWebsiteBuiltBy.size > 0) params.set("websiteBuiltBy", Array.from(selectedWebsiteBuiltBy).join(","));
            if (selectedMarketCompetitionLevel.size > 0) params.set("marketCompetitionLevel", Array.from(selectedMarketCompetitionLevel).join(","));
            if (marketRankPercentileMin !== "all") params.set("marketRankPercentileMin", marketRankPercentileMin);
            if (hasFacebook !== "all") params.set("hasFacebook", hasFacebook);
            if (hasYouTube !== "all") params.set("hasYouTube", hasYouTube);
            if (isVeteranOwned !== "all") params.set("isVeteranOwned", isVeteranOwned);
            if (isFamilyBusiness !== "all") params.set("isFamilyBusiness", isFamilyBusiness);
            if (reviewVelocityBucket !== "all") params.set("reviewVelocityBucket", reviewVelocityBucket);
            if (selectedEmailDomainType.size > 0) params.set("emailDomainType", Array.from(selectedEmailDomainType).join(","));
            if (emailDomainMatchesWebsite !== "all") params.set("emailDomainMatchesWebsite", emailDomainMatchesWebsite);
            if (emailDeliverable !== "all") params.set("emailDeliverable", emailDeliverable);
            if (emailVerificationState !== "all") params.set("emailVerificationState", emailVerificationState);
            if (selectedPhoneLineType.size > 0) params.set("phoneLineType", Array.from(selectedPhoneLineType).join(","));
            if (phoneDeliverable !== "all") params.set("phoneDeliverable", phoneDeliverable);
            if (hasOwnerFullName !== "all") params.set("hasOwnerFullName", hasOwnerFullName);
            if (hasOwnerLinkedIn !== "all") params.set("hasOwnerLinkedIn", hasOwnerLinkedIn);
            if (isDirectContact !== "all") params.set("isDirectContact", isDirectContact);
            if (lastUpdatedYearBucket !== "all") params.set("lastUpdatedYearBucket", lastUpdatedYearBucket);
            if (hasPricingPage !== "all") params.set("hasPricingPage", hasPricingPage);
            if (hasBlog !== "all") params.set("hasBlog", hasBlog);
            if (hasServiceAreaPublishedOnSite !== "all") params.set("hasServiceAreaPublishedOnSite", hasServiceAreaPublishedOnSite);
            if (totalPageCountBucket !== "all") params.set("totalPageCountBucket", totalPageCountBucket);
            if (selectedPrimaryBottleneck.size > 0) params.set("primaryBottleneck", Array.from(selectedPrimaryBottleneck).join(","));
            if (websiteAgeYearsMin !== "all") params.set("websiteAgeYearsMin", websiteAgeYearsMin);
            if (selectedReviewTrend.size > 0) params.set("recentReviewTrend", Array.from(selectedReviewTrend).join(","));
            if (painSeverityMin !== "all") params.set("painSeverityMin", painSeverityMin);
            if (searchQuery) params.set("search", searchQuery);
            params.set("idsOnly", "true");
            const res = await fetch(`/api/agents/leads?${params}`);
            if (!res.ok) throw new Error("Failed to fetch matching IDs");
            const data = await res.json();
            setSelectedIds(new Set(data.ids));
            setSelectAllMatching(true);
            showToast(`Selected all ${data.total} matching leads`);
        } catch {
            showToast("Failed to select all matching leads", "error");
        }
        setLoadingSelectAll(false);
    };

    // Drag-to-select: hold mouse down and drag across checkboxes to SELECT multiple
    // Deselecting is click-only (no drag deselect)
    const [isDragging, setIsDragging] = useState(false);
    const handleDragStart = (id: string) => {
        // Only start drag-select from an unchecked box
        if (!selectedIds.has(id)) {
            setIsDragging(true);
            setSelectedIds(prev => new Set(prev).add(id));
        }
    };
    const handleDragEnter = (id: string) => {
        if (!isDragging) return;
        setSelectedIds(prev => new Set(prev).add(id));
    };
    const handleDragEnd = () => setIsDragging(false);
    useEffect(() => { window.addEventListener("mouseup", handleDragEnd); return () => window.removeEventListener("mouseup", handleDragEnd); }, []);

    const deleteSelected = async () => {
        if (selectedIds.size === 0 || !confirm(`Delete ${selectedIds.size} lead(s)? This cannot be undone.`)) return;
        setDeleting(true);
        try {
            const res = await fetch("/api/agents/leads", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: Array.from(selectedIds) }) });
            if (res.ok) { showToast(`Deleted leads`); setSelectedIds(new Set()); setSelectAllMatching(false); fetchLeads(); }
        } catch { showToast("Failed to delete leads", "error"); }
        setDeleting(false);
    };

    const enrichSelected = async () => {
        if (selectedIds.size === 0) return;
        setEnriching(true);
        try {
            const res = await fetch("/api/agents/enrichment", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ leadIds: Array.from(selectedIds) }),
            });
            const data = await res.json();
            if (res.ok) {
                showToast(data.message || `Enrichment queued for ${data.queued || selectedIds.size} lead(s). Watch the Agents tab for progress.`);
                setSelectedIds(new Set());
                setSelectAllMatching(false);
                // Refresh leads after a short delay so the enriched state starts showing
                setTimeout(() => fetchLeads(), 2000);
            } else {
                showToast(data.error || "Enrichment failed to queue", "error");
            }
        } catch {
            showToast("Enrichment failed — is the local agent running?", "error");
        }
        setEnriching(false);
    };

    const pollEmailCleanerBatch = (runId: string) => {
        let attempts = 0;
        const poll = async () => {
            attempts++;
            try {
                const res = await fetch(`/api/agents/email-cleaner/status?runId=${encodeURIComponent(runId)}`);
                const data = await res.json().catch(() => ({}));
                if (res.ok && data.status === "completed") {
                    const summary = data.summary || data.results?.summary;
                    showToast(summary ? `Email cleaning finished: ${summary.deliverable || 0} deliverable, ${summary.archived || 0} hard failures archived` : "Email cleaning finished");
                    fetchLeads();
                    return;
                }
                if (res.ok && data.status === "failed") {
                    showToast("Email cleaning batch failed", "error");
                    return;
                }
            } catch {
                // keep polling; the callback may still complete independently
            }
            if (attempts < 18) setTimeout(poll, 10000);
        };
        setTimeout(poll, 10000);
    };

    const cleanSelectedEmails = async () => {
        if (selectedIds.size === 0) return;
        if (!confirm(`Verify ${selectedIds.size} selected lead(s) with Emailable? Hard failures will be archived; risky or unknown emails will stay active for review.`)) return;
        setCleaningEmails(true);
        try {
            const res = await fetch("/api/agents/email-cleaner", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ leadIds: Array.from(selectedIds) }),
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                const summary = data.summary || data.immediateSummary;
                const summaryText = summary
                    ? `${summary.deliverable || 0} deliverable, ${summary.archived || 0} archived`
                    : data.message || "Email cleaning queued";
                showToast(data.mode === "batch" ? data.message || "Email cleaning batch queued" : `Email cleaning finished: ${summaryText}`);
                setSelectedIds(new Set());
                setSelectAllMatching(false);
                if (data.mode === "batch" && data.runId) pollEmailCleanerBatch(data.runId);
                setTimeout(() => fetchLeads(), data.mode === "batch" ? 5000 : 1000);
            } else {
                showToast(data.error || "Email cleaning failed", "error");
            }
        } catch {
            showToast("Email cleaning failed", "error");
        }
        setCleaningEmails(false);
    };

    const addManualLead = async () => {
        if (!newLead.name.trim()) { showToast("Company name is required", "error"); return; }
        setAddingLead(true);
        try {
            const res = await fetch("/api/agents/leads", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    secret: "manual_add",
                    leads: [{
                        name: newLead.name.trim(),
                        phone: newLead.phone.trim() || null,
                        email: newLead.email.trim() || null,
                        website: newLead.website.trim() || null,
                        market: newLead.market.trim() || "Unknown",
                        ownerName: newLead.ownerName.trim() || null,
                        discoveredVia: "manual",
                        source: "manual",
                        categories: [],
                        companyType: "junk_removal",
                    }],
                }),
            });
            if (res.ok) {
                showToast("Lead added");
                setNewLead({ name: "", phone: "", email: "", website: "", market: "", ownerName: "" });
                setShowAddLead(false);
                fetchLeads();
            } else {
                const data = await res.json().catch(() => ({}));
                showToast(data.error || "Failed to add lead", "error");
            }
        } catch { showToast("Failed to add lead", "error"); }
        setAddingLead(false);
    };

    const sendToOutreach = async () => {
        if (selectedIds.size === 0) return;
        setSendingOutreach(true);
        try {
            const res = await fetch("/api/agents/outreach", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leadIds: Array.from(selectedIds), leads: leads.filter(l => selectedIds.has(l.id)) }) });
            if (res.ok) { showToast(`Sent leads to outreach`); setSelectedIds(new Set()); setSelectAllMatching(false); fetchLeads(); }
        } catch { showToast("Failed to send to outreach", "error"); }
        setSendingOutreach(false);
    };

    const copyEmails = async () => {
        if (selectedIds.size === 0) return;
        const selected = leads.filter(l => selectedIds.has(l.id));
        const emails = selected.map(l => l.email).filter((e): e is string => !!e && e.trim().length > 0);
        const missing = selectedIds.size - emails.length;
        if (emails.length === 0) {
            showToast("None of the selected leads have an email", "error");
            return;
        }
        try {
            await navigator.clipboard.writeText(emails.join("\n"));
            showToast(`Copied ${emails.length} email${emails.length === 1 ? "" : "s"}${missing > 0 ? ` (${missing} lead${missing === 1 ? "" : "s"} had no email)` : ""}`);
        } catch {
            showToast("Failed to copy — clipboard access denied", "error");
        }
    };

    const copyPhones = async () => {
        if (selectedIds.size === 0) return;
        const selected = leads.filter(l => selectedIds.has(l.id));
        const phones = selected.map(l => l.phone).filter((p): p is string => !!p && p.trim().length > 0);
        const missing = selectedIds.size - phones.length;
        if (phones.length === 0) {
            showToast("None of the selected leads have a phone number", "error");
            return;
        }
        try {
            await navigator.clipboard.writeText(phones.join("\n"));
            showToast(`Copied ${phones.length} phone number${phones.length === 1 ? "" : "s"}${missing > 0 ? ` (${missing} lead${missing === 1 ? "" : "s"} had no phone)` : ""}`);
        } catch {
            showToast("Failed to copy — clipboard access denied", "error");
        }
    };

    const handleSort = (field: string) => { sortBy === field ? setSortOrder(sortOrder === "asc" ? "desc" : "asc") : (setSortBy(field), setSortOrder(field === "name" || field === "market" ? "asc" : "desc")); };

    const SortHeader = ({ label, field, w }: { label: string; field: string; w?: number }) => (
        <th style={{ width: w, cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }} onClick={() => handleSort(field)}>
            {label} {sortBy === field ? (sortOrder === "asc" ? "▲" : "▼") : <span style={{ opacity: 0.25 }}>⇅</span>}
        </th>
    );

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Header & Meta */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                    <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 4px", fontFamily: "var(--font-heading)" }}>Outbound Scraped Leads</h1>
                    <p style={{ fontSize: 13, color: "var(--text-light)", margin: 0 }}>Review, curate, and trigger campaigns for leads discovered by the AI Lead Scraper.</p>
                </div>
                <button className="btn btn-sm btn-primary" onClick={() => setShowAddLead(!showAddLead)}>
                    {showAddLead ? "Cancel" : "+ Add Lead"}
                </button>
            </div>

            {showAddLead && (
                <div className="card" style={{ padding: "16px 20px" }}>
                    <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, fontFamily: "var(--font-heading)" }}>Add Lead Manually</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 12 }}>
                        <div>
                            <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 3 }}>Company Name *</label>
                            <input value={newLead.name} onChange={e => setNewLead(p => ({ ...p, name: e.target.value }))} placeholder="Bob's Junk Hauling"
                                style={{ width: "100%", padding: "7px 10px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 6, outline: "none" }} />
                        </div>
                        <div>
                            <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 3 }}>Owner Name</label>
                            <input value={newLead.ownerName} onChange={e => setNewLead(p => ({ ...p, ownerName: e.target.value }))} placeholder="Bob Smith"
                                style={{ width: "100%", padding: "7px 10px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 6, outline: "none" }} />
                        </div>
                        <div>
                            <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 3 }}>Market / City</label>
                            <input value={newLead.market} onChange={e => setNewLead(p => ({ ...p, market: e.target.value }))} placeholder="Houston"
                                style={{ width: "100%", padding: "7px 10px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 6, outline: "none" }} />
                        </div>
                        <div>
                            <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 3 }}>Phone</label>
                            <input value={newLead.phone} onChange={e => setNewLead(p => ({ ...p, phone: e.target.value }))} placeholder="(713) 555-1234"
                                style={{ width: "100%", padding: "7px 10px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 6, outline: "none" }} />
                        </div>
                        <div>
                            <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 3 }}>Email</label>
                            <input value={newLead.email} onChange={e => setNewLead(p => ({ ...p, email: e.target.value }))} placeholder="bob@junkremoval.com"
                                style={{ width: "100%", padding: "7px 10px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 6, outline: "none" }} />
                        </div>
                        <div>
                            <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 3 }}>Website</label>
                            <input value={newLead.website} onChange={e => setNewLead(p => ({ ...p, website: e.target.value }))} placeholder="https://bobsjunk.com"
                                style={{ width: "100%", padding: "7px 10px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 6, outline: "none" }} />
                        </div>
                    </div>
                    <button className="btn btn-sm btn-primary" onClick={addManualLead} disabled={!newLead.name.trim() || addingLead}>
                        {addingLead ? "Adding..." : "Add Lead"}
                    </button>
                </div>
            )}

            {/* Micro KPIs */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10 }}>
                {[
                    { label: "Total Discovered", value: funnel.total },
                    { label: "New Leads", value: funnel.new },
                    { label: "Emailed", value: funnel.emailed },
                    { label: "SMS Sent", value: funnel.sms_sent },
                    { label: "Replied", value: funnel.replied },
                    { label: "Converted", value: funnel.converted },
                ].map(f => (
                    <div key={f.label} style={{ background: "var(--white)", borderRadius: 6, padding: "12px", border: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 4 }}>
                        <div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{f.label}</div>
                        <div style={{ fontSize: 20, fontWeight: 600, color: "var(--text)" }}>{f.value}</div>
                    </div>
                ))}
            </div>

            {/* Data Presence Filters */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", padding: "8px 12px", background: "var(--white)", border: "1px solid var(--border-light)", borderRadius: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-faint)", marginRight: 4 }}>Show only:</span>
                {[
                    { label: "Has Owner Name", state: hasOwnerName, setter: setHasOwnerName },
                    { label: "Has Phone", state: hasPhone, setter: setHasPhone },
                    { label: "Has Email", state: hasEmail, setter: setHasEmail },
                    { label: "Has Website", state: hasWebsite, setter: setHasWebsite },
                    { label: "DIY Builder", state: diyFilter, setter: setDiyFilter },
                ].map(f => (
                    <button key={f.label} onClick={() => f.setter(f.state === "true" ? "all" : "true")}
                        style={{
                            padding: "4px 10px", fontSize: 11, fontWeight: 600, borderRadius: 6, cursor: "pointer",
                            border: `1px solid ${f.state === "true" ? "var(--success)" : "var(--border)"}`,
                            background: f.state === "true" ? "rgba(0,216,74,0.08)" : "var(--white)",
                            color: f.state === "true" ? "#00A83A" : "var(--text-light)",
                        }}>
                        {f.state === "true" ? "✓ " : ""}{f.label}
                    </button>
                ))}
                <div style={{ width: 1, height: 16, background: "var(--border)", margin: "0 4px" }} />
                <select value={serviceTypeFilter} onChange={e => setServiceTypeFilter(e.target.value)}
                    style={{ padding: "4px 8px", fontSize: 11, border: "1px solid var(--border)", borderRadius: 6, background: "var(--white)" }}>
                    <option value="all">All Services</option>
                    <option value="junk_removal">Junk Removal</option>
                    <option value="dumpster_rental">Dumpster Rental</option>
                    <option value="demolition">Demolition</option>
                </select>
                <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}
                    style={{ padding: "4px 8px", fontSize: 11, border: "1px solid var(--border)", borderRadius: 6, background: "var(--white)" }}>
                    <option value="all">All Sources</option>
                    <option value="google_maps">Google Maps</option>
                    <option value="facebook_group">Facebook</option>
                    <option value="manual">Manual</option>
                </select>
            </div>

            {/* Segment Filters — collapsible */}
            <div style={{ background: "var(--white)", border: "1px solid var(--border-light)", borderRadius: 8 }}>
                <button
                    onClick={() => setShowSegmentFilters(s => !s)}
                    style={{
                        width: "100%", padding: "8px 12px", display: "flex", alignItems: "center", justifyContent: "space-between",
                        background: "transparent", border: "none", cursor: "pointer", fontSize: 11, fontWeight: 600, color: "var(--text-light)",
                    }}>
                    <span>🎯 Segment Filters (Pain · Praise · GBP · Reviews · Booking · Stack · Tech · Marketing · Team · Market · Contact · Site)
                        {(() => {
                            const dropdowns = [reviewPainFilter, reviewCountRangeFilter, ownerResponseRateFilter, lastReviewWithinDays, yearsInBusinessRangeFilter, hasTrueBookingFilter, bookingFlowTypeFilter, painTagCountMin, negativeReviewPercentMin, mostRecentNegativeWithinDays, starRatingBucket, profileCompletenessBucket, respondsToNegatives, hasRecentGbpPosts, hasBusinessDescription, bookingHasInstantQuote, bookingHasJobSizeInput, bookingHasItemSelector, bookingCollectsPayment, bookingIsQuoteRequestOnly, mentionsCashOnly, hasOnlinePayment, bookingCtaTargetsPhone, marketingMaturityBucket, loadTimeBucket, mobileFriendly, sslValid, hasGoogleAds, hasCallTracking, hasChatWidget, hasGTM, hasFacebookPixel, hasGoogleAnalytics, employeeBucket, fleetBucket, marketRankPercentileMin, hasFacebook, hasYouTube, isVeteranOwned, isFamilyBusiness, reviewVelocityBucket, emailDomainMatchesWebsite, emailDeliverable, phoneDeliverable, hasOwnerFullName, hasOwnerLinkedIn, isDirectContact, lastUpdatedYearBucket, hasPricingPage, hasBlog, hasServiceAreaPublishedOnSite, totalPageCountBucket, websiteAgeYearsMin, painSeverityMin].filter(f => f !== "all").length;
                            const active = dropdowns + selectedPainTags.size + selectedPraiseTags.size + selectedBookingTiers.size + selectedCompetitorStack.size + selectedPaymentStack.size + selectedCms.size + selectedBookingPlatforms.size + selectedWebsiteBuiltBy.size + selectedMarketCompetitionLevel.size + selectedEmailDomainType.size + selectedPhoneLineType.size + selectedPrimaryBottleneck.size + selectedReviewTrend.size;
                            return active > 0 ? <span style={{ marginLeft: 6, padding: "1px 6px", fontSize: 10, background: "var(--orange)", color: "#fff", borderRadius: 10, fontWeight: 700 }}>{active}</span> : null;
                        })()}
                    </span>
                    <span style={{ fontSize: 10, color: "var(--text-faint)" }}>{showSegmentFilters ? "▲ Hide" : "▼ Show"}</span>
                </button>

                {showSegmentFilters && (
                    <div style={{ padding: "8px 12px 12px", borderTop: "1px solid var(--border-light)", display: "flex", flexDirection: "column", gap: 10 }}>
                        {/* ── Primary Bottleneck (HIGH-impact Round 7) — the single most important outreach filter ── */}
                        <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingBottom: 8, borderBottom: "1px dashed var(--border-light)" }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.04em" }}>🎯 Primary Bottleneck (single biggest outreach angle)</span>
                                {selectedPrimaryBottleneck.size > 0 && (
                                    <button onClick={() => setSelectedPrimaryBottleneck(new Set())} style={{ fontSize: 10, padding: "2px 8px", border: "1px solid var(--border)", borderRadius: 4, background: "var(--white)", color: "var(--text-light)", cursor: "pointer" }}>Clear {selectedPrimaryBottleneck.size}</button>
                                )}
                            </div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
                                {[
                                    { value: "missed_calls", label: "📞 Missed calls" },
                                    { value: "no_online_booking", label: "🚫 No online booking" },
                                    { value: "poor_response_rate", label: "💬 Poor response rate" },
                                    { value: "outdated_website", label: "🌐 Outdated website" },
                                    { value: "no_reviews", label: "🕳 No reviews" },
                                    { value: "stale_reviews", label: "💤 Stale reviews" },
                                    { value: "negative_review_trend", label: "📉 Negative review trend" },
                                    { value: "none", label: "✨ None (healthy)" },
                                ].map(b => {
                                    const active = selectedPrimaryBottleneck.has(b.value);
                                    return (
                                        <button key={b.value}
                                            onClick={() => setSelectedPrimaryBottleneck(prev => {
                                                const next = new Set(prev);
                                                if (next.has(b.value)) next.delete(b.value); else next.add(b.value);
                                                return next;
                                            })}
                                            style={{
                                                padding: "3px 10px", fontSize: 11, fontWeight: 600, borderRadius: 12, cursor: "pointer",
                                                border: `1px solid ${active ? "var(--orange)" : "var(--border)"}`,
                                                background: active ? "rgba(255,107,0,0.08)" : "transparent",
                                                color: active ? "var(--orange)" : "var(--text-light)",
                                            }}>
                                            {b.label}
                                        </button>
                                    );
                                })}
                            </div>
                            <label style={{ fontSize: 11, color: "var(--text-light)" }}>
                                <span style={{ fontWeight: 600, marginRight: 4 }}>Website age ≥:</span>
                                <select value={websiteAgeYearsMin} onChange={e => setWebsiteAgeYearsMin(e.target.value)}
                                    style={{ padding: "3px 6px", fontSize: 11, border: "1px solid var(--border)", borderRadius: 4, background: "var(--white)" }}>
                                    <option value="all">Any</option>
                                    <option value="3">3+ years old</option>
                                    <option value="5">5+ years old</option>
                                    <option value="7">7+ years old</option>
                                </select>
                            </label>
                            <label style={{ fontSize: 11, color: "var(--text-light)" }}>
                                <span style={{ fontWeight: 600, marginRight: 4 }}>Pain severity ≥:</span>
                                <select value={painSeverityMin} onChange={e => setPainSeverityMin(e.target.value)}
                                    style={{ padding: "3px 6px", fontSize: 11, border: "1px solid var(--border)", borderRadius: 4, background: "var(--white)" }}>
                                    <option value="all">Any</option>
                                    <option value="40">40+ (moderate)</option>
                                    <option value="60">60+ (high)</option>
                                    <option value="80">80+ (critical)</option>
                                </select>
                            </label>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center", marginTop: 2 }}>
                                <span style={{ fontSize: 10, fontWeight: 600, color: "var(--text-faint)" }}>Review trend:</span>
                                {[
                                    { value: "improving", label: "📈 Improving" },
                                    { value: "stable", label: "➖ Stable" },
                                    { value: "declining", label: "📉 Declining" },
                                    { value: "dormant", label: "💤 Dormant" },
                                    { value: "insufficient_data", label: "❓ Insufficient data" },
                                ].map(t => {
                                    const active = selectedReviewTrend.has(t.value);
                                    return (
                                        <button key={t.value}
                                            onClick={() => setSelectedReviewTrend(prev => {
                                                const next = new Set(prev);
                                                if (next.has(t.value)) next.delete(t.value); else next.add(t.value);
                                                return next;
                                            })}
                                            style={{ padding: "3px 8px", fontSize: 10, fontWeight: 600, borderRadius: 10, cursor: "pointer",
                                                border: `1px solid ${active ? "var(--orange)" : "var(--border)"}`,
                                                background: active ? "rgba(255,107,0,0.08)" : "transparent",
                                                color: active ? "var(--orange)" : "var(--text-light)" }}>
                                            {t.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* ── Canonical pain tags (multi-select, grouped by category) ── */}
                        <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingBottom: 8, borderBottom: "1px dashed var(--border-light)" }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Pain Tags (multi-select, AND)</span>
                                {selectedPainTags.size > 0 && (
                                    <button onClick={() => setSelectedPainTags(new Set())} style={{ fontSize: 10, padding: "2px 8px", border: "1px solid var(--border)", borderRadius: 4, background: "var(--white)", color: "var(--text-light)", cursor: "pointer" }}>Clear {selectedPainTags.size}</button>
                                )}
                            </div>
                            {Object.entries(painTagsByCategory()).map(([cat, tags]) => (
                                <div key={cat} style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
                                    <span style={{ fontSize: 9, fontWeight: 600, color: "var(--text-faint)", minWidth: 110 }}>{cat}</span>
                                    {tags.map(t => {
                                        const active = selectedPainTags.has(t.id);
                                        return (
                                            <button key={t.id} title={t.description}
                                                onClick={() => setSelectedPainTags(prev => {
                                                    const next = new Set(prev);
                                                    if (next.has(t.id)) next.delete(t.id); else next.add(t.id);
                                                    return next;
                                                })}
                                                style={{
                                                    padding: "3px 8px", fontSize: 10, fontWeight: 600, borderRadius: 12, cursor: "pointer",
                                                    border: `1px solid ${active ? "var(--danger)" : "var(--border)"}`,
                                                    background: active ? "rgba(239,68,68,0.08)" : "transparent",
                                                    color: active ? "var(--danger)" : "var(--text-light)",
                                                }}>
                                                {t.emoji} {t.label}
                                            </button>
                                        );
                                    })}
                                </div>
                            ))}
                        </div>

                        {/* ── Canonical praise tags (multi-select, grouped by category) ── */}
                        <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingBottom: 8, borderBottom: "1px dashed var(--border-light)" }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Praise Tags (multi-select, AND)</span>
                                {selectedPraiseTags.size > 0 && (
                                    <button onClick={() => setSelectedPraiseTags(new Set())} style={{ fontSize: 10, padding: "2px 8px", border: "1px solid var(--border)", borderRadius: 4, background: "var(--white)", color: "var(--text-light)", cursor: "pointer" }}>Clear {selectedPraiseTags.size}</button>
                                )}
                            </div>
                            {Object.entries(praiseTagsByCategory()).map(([cat, tags]) => (
                                <div key={cat} style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
                                    <span style={{ fontSize: 9, fontWeight: 600, color: "var(--text-faint)", minWidth: 110 }}>{cat}</span>
                                    {tags.map(t => {
                                        const active = selectedPraiseTags.has(t.id);
                                        return (
                                            <button key={t.id} title={t.description}
                                                onClick={() => setSelectedPraiseTags(prev => {
                                                    const next = new Set(prev);
                                                    if (next.has(t.id)) next.delete(t.id); else next.add(t.id);
                                                    return next;
                                                })}
                                                style={{
                                                    padding: "3px 8px", fontSize: 10, fontWeight: 600, borderRadius: 12, cursor: "pointer",
                                                    border: `1px solid ${active ? "var(--success)" : "var(--border)"}`,
                                                    background: active ? "rgba(0,216,74,0.08)" : "transparent",
                                                    color: active ? "#00A83A" : "var(--text-light)",
                                                }}>
                                                {t.emoji} {t.label}
                                            </button>
                                        );
                                    })}
                                </div>
                            ))}
                        </div>

                        {/* ── Severity dropdowns ── */}
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", paddingBottom: 8, borderBottom: "1px dashed var(--border-light)" }}>
                            <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.04em", marginRight: 4 }}>Severity:</span>
                            <label style={{ fontSize: 11, color: "var(--text-light)" }}>
                                <span style={{ fontWeight: 600, marginRight: 4 }}>Pain intensity:</span>
                                <select value={painTagCountMin} onChange={e => setPainTagCountMin(e.target.value)}
                                    style={{ padding: "3px 6px", fontSize: 11, border: "1px solid var(--border)", borderRadius: 4, background: "var(--white)" }}>
                                    <option value="all">Any</option>
                                    <option value="1">1+ pains</option>
                                    <option value="2">2+ pains</option>
                                    <option value="3">3+ pains</option>
                                    <option value="5">5+ pains</option>
                                </select>
                            </label>
                            <label style={{ fontSize: 11, color: "var(--text-light)" }}>
                                <span style={{ fontWeight: 600, marginRight: 4 }}>% negative reviews:</span>
                                <select value={negativeReviewPercentMin} onChange={e => setNegativeReviewPercentMin(e.target.value)}
                                    style={{ padding: "3px 6px", fontSize: 11, border: "1px solid var(--border)", borderRadius: 4, background: "var(--white)" }}>
                                    <option value="all">Any</option>
                                    <option value="0.1">10%+</option>
                                    <option value="0.25">25%+</option>
                                    <option value="0.5">50%+</option>
                                </select>
                            </label>
                            <label style={{ fontSize: 11, color: "var(--text-light)" }}>
                                <span style={{ fontWeight: 600, marginRight: 4 }}>Most recent negative within:</span>
                                <select value={mostRecentNegativeWithinDays} onChange={e => setMostRecentNegativeWithinDays(e.target.value)}
                                    style={{ padding: "3px 6px", fontSize: 11, border: "1px solid var(--border)", borderRadius: 4, background: "var(--white)" }}>
                                    <option value="all">Any</option>
                                    <option value="7">7 days</option>
                                    <option value="30">30 days</option>
                                    <option value="90">90 days</option>
                                </select>
                            </label>
                        </div>

                        {/* ── GBP Profile dropdowns ── */}
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", paddingBottom: 8, borderBottom: "1px dashed var(--border-light)" }}>
                            <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.04em", marginRight: 4 }}>GBP Profile:</span>
                            <label style={{ fontSize: 11, color: "var(--text-light)" }}>
                                <span style={{ fontWeight: 600, marginRight: 4 }}>Star rating:</span>
                                <select value={starRatingBucket} onChange={e => setStarRatingBucket(e.target.value)}
                                    style={{ padding: "3px 6px", fontSize: 11, border: "1px solid var(--border)", borderRadius: 4, background: "var(--white)" }}>
                                    <option value="all">Any</option>
                                    <option value="<3">&lt; 3★</option>
                                    <option value="3-3.9">3.0 – 3.9★</option>
                                    <option value="4-4.4">4.0 – 4.4★</option>
                                    <option value="4.5-4.7">4.5 – 4.7★</option>
                                    <option value="4.8+">4.8+★</option>
                                </select>
                            </label>
                            <label style={{ fontSize: 11, color: "var(--text-light)" }}>
                                <span style={{ fontWeight: 600, marginRight: 4 }}>Profile completeness:</span>
                                <select value={profileCompletenessBucket} onChange={e => setProfileCompletenessBucket(e.target.value)}
                                    style={{ padding: "3px 6px", fontSize: 11, border: "1px solid var(--border)", borderRadius: 4, background: "var(--white)" }}>
                                    <option value="all">Any</option>
                                    <option value="low">Low (&lt; 40)</option>
                                    <option value="medium">Medium (40–70)</option>
                                    <option value="high">High (70+)</option>
                                </select>
                            </label>
                            <label style={{ fontSize: 11, color: "var(--text-light)" }}>
                                <span style={{ fontWeight: 600, marginRight: 4 }}>Responds to negatives:</span>
                                <select value={respondsToNegatives} onChange={e => setRespondsToNegatives(e.target.value)}
                                    style={{ padding: "3px 6px", fontSize: 11, border: "1px solid var(--border)", borderRadius: 4, background: "var(--white)" }}>
                                    <option value="all">Any</option>
                                    <option value="true">Yes (≥50%)</option>
                                    <option value="false">No</option>
                                </select>
                            </label>
                            <label style={{ fontSize: 11, color: "var(--text-light)" }}>
                                <span style={{ fontWeight: 600, marginRight: 4 }}>Recent GBP posts:</span>
                                <select value={hasRecentGbpPosts} onChange={e => setHasRecentGbpPosts(e.target.value)}
                                    style={{ padding: "3px 6px", fontSize: 11, border: "1px solid var(--border)", borderRadius: 4, background: "var(--white)" }}>
                                    <option value="all">Any</option>
                                    <option value="true">Posted in 90d</option>
                                    <option value="false">No posts</option>
                                </select>
                            </label>
                            <label style={{ fontSize: 11, color: "var(--text-light)" }}>
                                <span style={{ fontWeight: 600, marginRight: 4 }}>Description:</span>
                                <select value={hasBusinessDescription} onChange={e => setHasBusinessDescription(e.target.value)}
                                    style={{ padding: "3px 6px", fontSize: 11, border: "1px solid var(--border)", borderRadius: 4, background: "var(--white)" }}>
                                    <option value="all">Any</option>
                                    <option value="true">Has description</option>
                                    <option value="false">Missing</option>
                                </select>
                            </label>
                        </div>

                        {/* ── Booking Sophistication (multi-select tiers + component toggles) ── */}
                        <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingBottom: 8, borderBottom: "1px dashed var(--border-light)" }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Booking Sophistication (multi-select)</span>
                                {selectedBookingTiers.size > 0 && (
                                    <button onClick={() => setSelectedBookingTiers(new Set())} style={{ fontSize: 10, padding: "2px 8px", border: "1px solid var(--border)", borderRadius: 4, background: "var(--white)", color: "var(--text-light)", cursor: "pointer" }}>Clear {selectedBookingTiers.size}</button>
                                )}
                            </div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
                                {[
                                    { value: "none", label: "⛔ None" },
                                    { value: "cta_only", label: "🔘 CTA only" },
                                    { value: "basic_scheduler", label: "🗓️ Basic scheduler" },
                                    { value: "photo_collector", label: "📷 Photo collector" },
                                    { value: "quote_form", label: "📝 Quote form" },
                                    { value: "instant_quote", label: "💵 Instant quote" },
                                    { value: "full_booking", label: "🏆 Full booking" },
                                    { value: "other", label: "Other" },
                                ].map(t => {
                                    const active = selectedBookingTiers.has(t.value);
                                    return (
                                        <button key={t.value}
                                            onClick={() => setSelectedBookingTiers(prev => {
                                                const next = new Set(prev);
                                                if (next.has(t.value)) next.delete(t.value); else next.add(t.value);
                                                return next;
                                            })}
                                            style={{
                                                padding: "3px 10px", fontSize: 11, fontWeight: 600, borderRadius: 12, cursor: "pointer",
                                                border: `1px solid ${active ? "var(--info)" : "var(--border)"}`,
                                                background: active ? "rgba(37,99,235,0.08)" : "transparent",
                                                color: active ? "var(--info)" : "var(--text-light)",
                                            }}>
                                            {t.label}
                                        </button>
                                    );
                                })}
                            </div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                                <span style={{ fontSize: 10, fontWeight: 600, color: "var(--text-faint)", minWidth: 100 }}>Components:</span>
                                {[
                                    { label: "Instant quote", state: bookingHasInstantQuote, setter: setBookingHasInstantQuote },
                                    { label: "Job size input", state: bookingHasJobSizeInput, setter: setBookingHasJobSizeInput },
                                    { label: "Item selector", state: bookingHasItemSelector, setter: setBookingHasItemSelector },
                                    { label: "Collects payment", state: bookingCollectsPayment, setter: setBookingCollectsPayment },
                                    { label: "Quote-only (no instant)", state: bookingIsQuoteRequestOnly, setter: setBookingIsQuoteRequestOnly },
                                ].map(f => (
                                    <button key={f.label}
                                        onClick={() => f.setter(f.state === "true" ? "all" : "true")}
                                        style={{
                                            padding: "3px 8px", fontSize: 10, fontWeight: 600, borderRadius: 10, cursor: "pointer",
                                            border: `1px solid ${f.state === "true" ? "var(--info)" : "var(--border)"}`,
                                            background: f.state === "true" ? "rgba(37,99,235,0.08)" : "var(--white)",
                                            color: f.state === "true" ? "var(--info)" : "var(--text-light)",
                                        }}>
                                        {f.state === "true" ? "✓ " : ""}{f.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* ── Competitor Stack (multi-select, OR semantics) ── */}
                        <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingBottom: 8, borderBottom: "1px dashed var(--border-light)" }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Competitor Stack (multi-select, OR)</span>
                                {selectedCompetitorStack.size > 0 && (
                                    <button onClick={() => setSelectedCompetitorStack(new Set())} style={{ fontSize: 10, padding: "2px 8px", border: "1px solid var(--border)", borderRadius: 4, background: "var(--white)", color: "var(--text-light)", cursor: "pointer" }}>Clear {selectedCompetitorStack.size}</button>
                                )}
                            </div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
                                {[
                                    { value: "Jobber", label: "Jobber" },
                                    { value: "Workiz", label: "Workiz" },
                                    { value: "HousecallPro", label: "Housecall Pro" },
                                    { value: "ServiceTitan", label: "ServiceTitan" },
                                    { value: "Thryv", label: "Thryv" },
                                    { value: "GorillaDesk", label: "GorillaDesk" },
                                    { value: "FieldPulse", label: "FieldPulse" },
                                    { value: "QuoteIQ", label: "QuoteIQ" },
                                    { value: "Docket", label: "Docket" },
                                    { value: "DumpstersCom", label: "Dumpsters.com" },
                                ].map(p => {
                                    const active = selectedCompetitorStack.has(p.value);
                                    return (
                                        <button key={p.value}
                                            onClick={() => setSelectedCompetitorStack(prev => {
                                                const next = new Set(prev);
                                                if (next.has(p.value)) next.delete(p.value); else next.add(p.value);
                                                return next;
                                            })}
                                            style={{
                                                padding: "3px 10px", fontSize: 11, fontWeight: 600, borderRadius: 12, cursor: "pointer",
                                                border: `1px solid ${active ? "var(--warn-dark)" : "var(--border)"}`,
                                                background: active ? "rgba(245,158,11,0.08)" : "transparent",
                                                color: active ? "var(--warn-dark)" : "var(--text-light)",
                                            }}>
                                            {p.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* ── Payment Stack (multi-select + toggles) ── */}
                        <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingBottom: 8, borderBottom: "1px dashed var(--border-light)" }}>
                            <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Payment Stack</span>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
                                <span style={{ fontSize: 10, fontWeight: 600, color: "var(--text-faint)", minWidth: 100 }}>Uses:</span>
                                {[
                                    { value: "Stripe", label: "💳 Stripe" },
                                    { value: "Square", label: "⬛ Square" },
                                ].map(p => {
                                    const active = selectedPaymentStack.has(p.value);
                                    return (
                                        <button key={p.value}
                                            onClick={() => setSelectedPaymentStack(prev => {
                                                const next = new Set(prev);
                                                if (next.has(p.value)) next.delete(p.value); else next.add(p.value);
                                                return next;
                                            })}
                                            style={{
                                                padding: "3px 10px", fontSize: 11, fontWeight: 600, borderRadius: 12, cursor: "pointer",
                                                border: `1px solid ${active ? "var(--info)" : "var(--border)"}`,
                                                background: active ? "rgba(37,99,235,0.08)" : "transparent",
                                                color: active ? "var(--info)" : "var(--text-light)",
                                            }}>
                                            {p.label}
                                        </button>
                                    );
                                })}
                                <div style={{ width: 1, height: 14, background: "var(--border)", margin: "0 4px" }} />
                                {[
                                    { label: "Cash/check only", state: mentionsCashOnly, setter: setMentionsCashOnly },
                                    { label: "Has online payment", state: hasOnlinePayment, setter: setHasOnlinePayment },
                                ].map(f => (
                                    <button key={f.label}
                                        onClick={() => f.setter(f.state === "true" ? "all" : "true")}
                                        style={{
                                            padding: "3px 8px", fontSize: 10, fontWeight: 600, borderRadius: 10, cursor: "pointer",
                                            border: `1px solid ${f.state === "true" ? "var(--info)" : "var(--border)"}`,
                                            background: f.state === "true" ? "rgba(37,99,235,0.08)" : "var(--white)",
                                            color: f.state === "true" ? "var(--info)" : "var(--text-light)",
                                        }}>
                                        {f.state === "true" ? "✓ " : ""}{f.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* ── Tech Stack (CMS, website built-by, booking platform, site quality) ── */}
                        <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingBottom: 8, borderBottom: "1px dashed var(--border-light)" }}>
                            <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Tech Stack</span>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
                                <span style={{ fontSize: 10, fontWeight: 600, color: "var(--text-faint)", minWidth: 100 }}>CMS:</span>
                                {["WordPress", "Wix", "Squarespace", "GoDaddy", "Weebly", "Shopify", "Webflow", "Other"].map(cms => {
                                    const active = selectedCms.has(cms);
                                    return (
                                        <button key={cms}
                                            onClick={() => setSelectedCms(prev => {
                                                const next = new Set(prev);
                                                if (next.has(cms)) next.delete(cms); else next.add(cms);
                                                return next;
                                            })}
                                            style={{ padding: "3px 8px", fontSize: 10, fontWeight: 600, borderRadius: 10, cursor: "pointer", border: `1px solid ${active ? "var(--info)" : "var(--border)"}`, background: active ? "rgba(37,99,235,0.08)" : "transparent", color: active ? "var(--info)" : "var(--text-light)" }}>
                                            {cms}
                                        </button>
                                    );
                                })}
                            </div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
                                <span style={{ fontSize: 10, fontWeight: 600, color: "var(--text-faint)", minWidth: 100 }}>Built by:</span>
                                {[
                                    { value: "diy", label: "🛠 DIY (confirmed)" },
                                    { value: "likely_diy", label: "🛠 Likely DIY" },
                                    { value: "likely_agency", label: "🏢 Likely Agency" },
                                    { value: "unknown", label: "❓ Unknown" },
                                ].map(w => {
                                    const active = selectedWebsiteBuiltBy.has(w.value);
                                    return (
                                        <button key={w.value}
                                            onClick={() => setSelectedWebsiteBuiltBy(prev => {
                                                const next = new Set(prev);
                                                if (next.has(w.value)) next.delete(w.value); else next.add(w.value);
                                                return next;
                                            })}
                                            style={{ padding: "3px 8px", fontSize: 10, fontWeight: 600, borderRadius: 10, cursor: "pointer", border: `1px solid ${active ? "var(--info)" : "var(--border)"}`, background: active ? "rgba(37,99,235,0.08)" : "transparent", color: active ? "var(--info)" : "var(--text-light)" }}>
                                            {w.label}
                                        </button>
                                    );
                                })}
                            </div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
                                <span style={{ fontSize: 10, fontWeight: 600, color: "var(--text-faint)", minWidth: 100 }}>Booking platform:</span>
                                {["Calendly", "Jobber", "Housecall Pro", "ServiceTitan", "Workiz", "Thryv", "GorillaDesk", "FieldPulse", "Custom (native form)"].map(bp => {
                                    const active = selectedBookingPlatforms.has(bp);
                                    return (
                                        <button key={bp}
                                            onClick={() => setSelectedBookingPlatforms(prev => {
                                                const next = new Set(prev);
                                                if (next.has(bp)) next.delete(bp); else next.add(bp);
                                                return next;
                                            })}
                                            style={{ padding: "3px 8px", fontSize: 10, fontWeight: 600, borderRadius: 10, cursor: "pointer", border: `1px solid ${active ? "var(--info)" : "var(--border)"}`, background: active ? "rgba(37,99,235,0.08)" : "transparent", color: active ? "var(--info)" : "var(--text-light)" }}>
                                            {bp}
                                        </button>
                                    );
                                })}
                            </div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                                <label style={{ fontSize: 11, color: "var(--text-light)" }}>
                                    <span style={{ fontWeight: 600, marginRight: 4 }}>Load time:</span>
                                    <select value={loadTimeBucket} onChange={e => setLoadTimeBucket(e.target.value)}
                                        style={{ padding: "3px 6px", fontSize: 11, border: "1px solid var(--border)", borderRadius: 4, background: "var(--white)" }}>
                                        <option value="all">Any</option>
                                        <option value="fast">Fast (&lt; 2s)</option>
                                        <option value="medium">Medium (2–5s)</option>
                                        <option value="slow">Slow (5s+)</option>
                                    </select>
                                </label>
                                {[
                                    { label: "Mobile-friendly", state: mobileFriendly, setter: setMobileFriendly },
                                    { label: "SSL valid", state: sslValid, setter: setSslValid },
                                    { label: "⚠️ Fake booking (CTA dials phone)", state: bookingCtaTargetsPhone, setter: setBookingCtaTargetsPhone },
                                ].map(f => (
                                    <button key={f.label}
                                        onClick={() => f.setter(f.state === "true" ? "all" : "true")}
                                        style={{
                                            padding: "3px 8px", fontSize: 10, fontWeight: 600, borderRadius: 10, cursor: "pointer",
                                            border: `1px solid ${f.state === "true" ? "var(--info)" : "var(--border)"}`,
                                            background: f.state === "true" ? "rgba(37,99,235,0.08)" : "var(--white)",
                                            color: f.state === "true" ? "var(--info)" : "var(--text-light)",
                                        }}>
                                        {f.state === "true" ? "✓ " : ""}{f.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* ── Marketing Signals ── */}
                        <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingBottom: 8, borderBottom: "1px dashed var(--border-light)" }}>
                            <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Marketing Signals</span>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                                <label style={{ fontSize: 11, color: "var(--text-light)" }}>
                                    <span style={{ fontWeight: 600, marginRight: 4 }}>Maturity score:</span>
                                    <select value={marketingMaturityBucket} onChange={e => setMarketingMaturityBucket(e.target.value)}
                                        style={{ padding: "3px 6px", fontSize: 11, border: "1px solid var(--border)", borderRadius: 4, background: "var(--white)" }}>
                                        <option value="all">Any</option>
                                        <option value="low">Low (&lt; 20)</option>
                                        <option value="medium">Medium (20–49)</option>
                                        <option value="high">High (50+)</option>
                                    </select>
                                </label>
                                {[
                                    { label: "Google Ads", state: hasGoogleAds, setter: setHasGoogleAds },
                                    { label: "Call tracking", state: hasCallTracking, setter: setHasCallTracking },
                                    { label: "Chat widget", state: hasChatWidget, setter: setHasChatWidget },
                                    { label: "GTM", state: hasGTM, setter: setHasGTM },
                                    { label: "FB Pixel", state: hasFacebookPixel, setter: setHasFacebookPixel },
                                    { label: "Google Analytics", state: hasGoogleAnalytics, setter: setHasGoogleAnalytics },
                                ].map(f => (
                                    <button key={f.label}
                                        onClick={() => f.setter(f.state === "true" ? "all" : "true")}
                                        style={{
                                            padding: "3px 8px", fontSize: 10, fontWeight: 600, borderRadius: 10, cursor: "pointer",
                                            border: `1px solid ${f.state === "true" ? "var(--info)" : "var(--border)"}`,
                                            background: f.state === "true" ? "rgba(37,99,235,0.08)" : "var(--white)",
                                            color: f.state === "true" ? "var(--info)" : "var(--text-light)",
                                        }}>
                                        {f.state === "true" ? "✓ " : ""}{f.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* ── Team Size & Business Profile ── */}
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", paddingBottom: 8, borderBottom: "1px dashed var(--border-light)" }}>
                            <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.04em", marginRight: 4 }}>Team &amp; Profile:</span>
                            <label style={{ fontSize: 11, color: "var(--text-light)" }}>
                                <span style={{ fontWeight: 600, marginRight: 4 }}>Employees:</span>
                                <select value={employeeBucket} onChange={e => setEmployeeBucket(e.target.value)}
                                    style={{ padding: "3px 6px", fontSize: 11, border: "1px solid var(--border)", borderRadius: 4, background: "var(--white)" }}>
                                    <option value="all">Any</option>
                                    <option value="1">Solo (1)</option>
                                    <option value="2-3">Small (2–3)</option>
                                    <option value="4-10">Growing (4–10)</option>
                                    <option value="11+">Established (11+)</option>
                                    <option value="unknown">Unknown</option>
                                </select>
                            </label>
                            <label style={{ fontSize: 11, color: "var(--text-light)" }}>
                                <span style={{ fontWeight: 600, marginRight: 4 }}>Fleet:</span>
                                <select value={fleetBucket} onChange={e => setFleetBucket(e.target.value)}
                                    style={{ padding: "3px 6px", fontSize: 11, border: "1px solid var(--border)", borderRadius: 4, background: "var(--white)" }}>
                                    <option value="all">Any</option>
                                    <option value="1">1 truck</option>
                                    <option value="2-5">2–5</option>
                                    <option value="6+">6+</option>
                                    <option value="unknown">Unknown</option>
                                </select>
                            </label>
                            {[
                                { label: "Veteran-owned", state: isVeteranOwned, setter: setIsVeteranOwned },
                                { label: "Family business", state: isFamilyBusiness, setter: setIsFamilyBusiness },
                                { label: "Has Facebook", state: hasFacebook, setter: setHasFacebook },
                                { label: "Has YouTube", state: hasYouTube, setter: setHasYouTube },
                            ].map(f => (
                                <button key={f.label}
                                    onClick={() => f.setter(f.state === "true" ? "all" : "true")}
                                    style={{
                                        padding: "3px 8px", fontSize: 10, fontWeight: 600, borderRadius: 10, cursor: "pointer",
                                        border: `1px solid ${f.state === "true" ? "var(--info)" : "var(--border)"}`,
                                        background: f.state === "true" ? "rgba(37,99,235,0.08)" : "var(--white)",
                                        color: f.state === "true" ? "var(--info)" : "var(--text-light)",
                                    }}>
                                    {f.state === "true" ? "✓ " : ""}{f.label}
                                </button>
                            ))}
                        </div>

                        {/* ── Market Context ── */}
                        <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingBottom: 8, borderBottom: "1px dashed var(--border-light)" }}>
                            <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Market Context</span>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
                                <span style={{ fontSize: 10, fontWeight: 600, color: "var(--text-faint)", minWidth: 100 }}>Competition:</span>
                                {[
                                    { value: "low", label: "🟢 Low" },
                                    { value: "medium", label: "🟡 Medium" },
                                    { value: "high", label: "🔴 High" },
                                ].map(c => {
                                    const active = selectedMarketCompetitionLevel.has(c.value);
                                    return (
                                        <button key={c.value}
                                            onClick={() => setSelectedMarketCompetitionLevel(prev => {
                                                const next = new Set(prev);
                                                if (next.has(c.value)) next.delete(c.value); else next.add(c.value);
                                                return next;
                                            })}
                                            style={{ padding: "3px 8px", fontSize: 10, fontWeight: 600, borderRadius: 10, cursor: "pointer", border: `1px solid ${active ? "var(--info)" : "var(--border)"}`, background: active ? "rgba(37,99,235,0.08)" : "transparent", color: active ? "var(--info)" : "var(--text-light)" }}>
                                            {c.label}
                                        </button>
                                    );
                                })}
                            </div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                                <label style={{ fontSize: 11, color: "var(--text-light)" }}>
                                    <span style={{ fontWeight: 600, marginRight: 4 }}>Market rank:</span>
                                    <select value={marketRankPercentileMin} onChange={e => setMarketRankPercentileMin(e.target.value)}
                                        style={{ padding: "3px 6px", fontSize: 11, border: "1px solid var(--border)", borderRadius: 4, background: "var(--white)" }}>
                                        <option value="all">Any</option>
                                        <option value="0.9">Top 10%</option>
                                        <option value="0.75">Top 25%</option>
                                        <option value="0.5">Top 50%</option>
                                    </select>
                                </label>
                                <label style={{ fontSize: 11, color: "var(--text-light)" }}>
                                    <span style={{ fontWeight: 600, marginRight: 4 }}>Review velocity (90d):</span>
                                    <select value={reviewVelocityBucket} onChange={e => setReviewVelocityBucket(e.target.value)}
                                        style={{ padding: "3px 6px", fontSize: 11, border: "1px solid var(--border)", borderRadius: 4, background: "var(--white)" }}>
                                        <option value="all">Any</option>
                                        <option value="dormant">💤 Dormant (0)</option>
                                        <option value="low">🐢 Low (1–5)</option>
                                        <option value="moderate">⚡ Moderate (6–20)</option>
                                        <option value="high">🚀 High (21+)</option>
                                    </select>
                                </label>
                            </div>
                        </div>

                        {/* ── Contact Quality (Phase 5) ── */}
                        <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingBottom: 8, borderBottom: "1px dashed var(--border-light)" }}>
                            <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Contact Quality</span>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
                                <span style={{ fontSize: 10, fontWeight: 600, color: "var(--text-faint)", minWidth: 100 }}>Email domain:</span>
                                {[
                                    { value: "personal", label: "📧 Personal (gmail, yahoo, …)" },
                                    { value: "business_custom", label: "🏢 Custom domain" },
                                    { value: "unknown", label: "❓ Unknown" },
                                ].map(d => {
                                    const active = selectedEmailDomainType.has(d.value);
                                    return (
                                        <button key={d.value}
                                            onClick={() => setSelectedEmailDomainType(prev => {
                                                const next = new Set(prev);
                                                if (next.has(d.value)) next.delete(d.value); else next.add(d.value);
                                                return next;
                                            })}
                                            style={{ padding: "3px 8px", fontSize: 10, fontWeight: 600, borderRadius: 10, cursor: "pointer", border: `1px solid ${active ? "var(--info)" : "var(--border)"}`, background: active ? "rgba(37,99,235,0.08)" : "transparent", color: active ? "var(--info)" : "var(--text-light)" }}>
                                            {d.label}
                                        </button>
                                    );
                                })}
                            </div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
                                <span style={{ fontSize: 10, fontWeight: 600, color: "var(--text-faint)", minWidth: 100 }}>Phone line type:</span>
                                {[
                                    { value: "mobile", label: "📱 Mobile" },
                                    { value: "landline", label: "☎️ Landline" },
                                    { value: "voip", label: "🖥 VOIP" },
                                    { value: "unknown", label: "❓ Unknown" },
                                ].map(d => {
                                    const active = selectedPhoneLineType.has(d.value);
                                    return (
                                        <button key={d.value}
                                            onClick={() => setSelectedPhoneLineType(prev => {
                                                const next = new Set(prev);
                                                if (next.has(d.value)) next.delete(d.value); else next.add(d.value);
                                                return next;
                                            })}
                                            style={{ padding: "3px 8px", fontSize: 10, fontWeight: 600, borderRadius: 10, cursor: "pointer", border: `1px solid ${active ? "var(--info)" : "var(--border)"}`, background: active ? "rgba(37,99,235,0.08)" : "transparent", color: active ? "var(--info)" : "var(--text-light)" }}>
                                            {d.label}
                                        </button>
                                    );
                                })}
                            </div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                                {[
                                    { label: "Email matches website", state: emailDomainMatchesWebsite, setter: setEmailDomainMatchesWebsite },
                                    { label: "Email deliverable", state: emailDeliverable, setter: setEmailDeliverable },
                                    { label: "Phone deliverable", state: phoneDeliverable, setter: setPhoneDeliverable },
                                    { label: "Has first + last name", state: hasOwnerFullName, setter: setHasOwnerFullName },
                                    { label: "Has LinkedIn URL", state: hasOwnerLinkedIn, setter: setHasOwnerLinkedIn },
                                    { label: "🎯 Direct contact", state: isDirectContact, setter: setIsDirectContact },
                                ].map(f => (
                                    <button key={f.label}
                                        onClick={() => f.setter(f.state === "true" ? "all" : "true")}
                                        style={{
                                            padding: "3px 8px", fontSize: 10, fontWeight: 600, borderRadius: 10, cursor: "pointer",
                                            border: `1px solid ${f.state === "true" ? "var(--info)" : "var(--border)"}`,
                                            background: f.state === "true" ? "rgba(37,99,235,0.08)" : "var(--white)",
                                            color: f.state === "true" ? "var(--info)" : "var(--text-light)",
                                        }}>
                                        {f.state === "true" ? "✓ " : ""}{f.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* ── Website Depth (Phase 6) ── */}
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", paddingBottom: 8, borderBottom: "1px dashed var(--border-light)" }}>
                            <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.04em", marginRight: 4 }}>Website Depth:</span>
                            <label style={{ fontSize: 11, color: "var(--text-light)" }}>
                                <span style={{ fontWeight: 600, marginRight: 4 }}>Last updated:</span>
                                <select value={lastUpdatedYearBucket} onChange={e => setLastUpdatedYearBucket(e.target.value)}
                                    style={{ padding: "3px 6px", fontSize: 11, border: "1px solid var(--border)", borderRadius: 4, background: "var(--white)" }}>
                                    <option value="all">Any</option>
                                    <option value="stale">💀 Stale (≤2020)</option>
                                    <option value="aging">🕰 Aging (2021–2022)</option>
                                    <option value="fresh">✨ Fresh (2023+)</option>
                                    <option value="unknown">Unknown</option>
                                </select>
                            </label>
                            <label style={{ fontSize: 11, color: "var(--text-light)" }}>
                                <span style={{ fontWeight: 600, marginRight: 4 }}>Page count:</span>
                                <select value={totalPageCountBucket} onChange={e => setTotalPageCountBucket(e.target.value)}
                                    style={{ padding: "3px 6px", fontSize: 11, border: "1px solid var(--border)", borderRadius: 4, background: "var(--white)" }}>
                                    <option value="all">Any</option>
                                    <option value="tiny">Tiny (1–5)</option>
                                    <option value="small">Small (6–20)</option>
                                    <option value="medium">Medium (21–100)</option>
                                    <option value="large">Large (100+)</option>
                                </select>
                            </label>
                            {[
                                { label: "Has pricing page", state: hasPricingPage, setter: setHasPricingPage },
                                { label: "Has blog", state: hasBlog, setter: setHasBlog },
                                { label: "Service area on site", state: hasServiceAreaPublishedOnSite, setter: setHasServiceAreaPublishedOnSite },
                            ].map(f => (
                                <button key={f.label}
                                    onClick={() => f.setter(f.state === "true" ? "all" : "true")}
                                    style={{
                                        padding: "3px 8px", fontSize: 10, fontWeight: 600, borderRadius: 10, cursor: "pointer",
                                        border: `1px solid ${f.state === "true" ? "var(--info)" : "var(--border)"}`,
                                        background: f.state === "true" ? "rgba(37,99,235,0.08)" : "var(--white)",
                                        color: f.state === "true" ? "var(--info)" : "var(--text-light)",
                                    }}>
                                    {f.state === "true" ? "✓ " : ""}{f.label}
                                </button>
                            ))}
                        </div>

                        {/* Review pains — toggle chips */}
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                            <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.04em", marginRight: 4 }}>Review Pain:</span>
                            {[
                                { value: "dormant_reviews", label: "📉 Dormant (no reviews 90d)" },
                                { value: "low_response_rate", label: "💬 Low Response Rate (<30%)" },
                                { value: "negative_reviews", label: "⚠️ Has Negative Reviews" },
                                { value: "has_complaints", label: "😠 Has Recurring Complaints" },
                                { value: "stale_owner_response", label: "🕒 Stale Owner Response (60d+)" },
                                { value: "stale_last_review", label: "📅 Stale Last Review (60d+)" },
                            ].map(p => (
                                <button key={p.value}
                                    onClick={() => setReviewPainFilter(reviewPainFilter === p.value ? "all" : p.value)}
                                    style={{
                                        padding: "4px 10px", fontSize: 11, fontWeight: 600, borderRadius: 14, cursor: "pointer",
                                        border: `1px solid ${reviewPainFilter === p.value ? "var(--orange)" : "var(--border)"}`,
                                        background: reviewPainFilter === p.value ? "rgba(255,107,0,0.08)" : "transparent",
                                        color: reviewPainFilter === p.value ? "var(--orange)" : "var(--text-light)",
                                    }}>
                                    {p.label}
                                </button>
                            ))}
                        </div>

                        {/* Dropdowns row — review count, response rate, last review, years in business, booking, flow type */}
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                            <label style={{ fontSize: 11, color: "var(--text-light)" }}>
                                <span style={{ fontWeight: 600, marginRight: 4 }}>Review count:</span>
                                <select value={reviewCountRangeFilter} onChange={e => setReviewCountRangeFilter(e.target.value)}
                                    style={{ padding: "3px 6px", fontSize: 11, border: "1px solid var(--border)", borderRadius: 4, background: "var(--white)" }}>
                                    <option value="all">Any</option>
                                    <option value="0-10">0–10</option>
                                    <option value="11-50">11–50</option>
                                    <option value="51-200">51–200</option>
                                    <option value="201-500">201–500</option>
                                    <option value="500+">500+</option>
                                </select>
                            </label>

                            <label style={{ fontSize: 11, color: "var(--text-light)" }}>
                                <span style={{ fontWeight: 600, marginRight: 4 }}>Response rate:</span>
                                <select value={ownerResponseRateFilter} onChange={e => setOwnerResponseRateFilter(e.target.value)}
                                    style={{ padding: "3px 6px", fontSize: 11, border: "1px solid var(--border)", borderRadius: 4, background: "var(--white)" }}>
                                    <option value="all">Any</option>
                                    <option value="low">Low (&lt;30%)</option>
                                    <option value="medium">Medium (30–60%)</option>
                                    <option value="high">High (60%+)</option>
                                </select>
                            </label>

                            <label style={{ fontSize: 11, color: "var(--text-light)" }}>
                                <span style={{ fontWeight: 600, marginRight: 4 }}>Last review within:</span>
                                <select value={lastReviewWithinDays} onChange={e => setLastReviewWithinDays(e.target.value)}
                                    style={{ padding: "3px 6px", fontSize: 11, border: "1px solid var(--border)", borderRadius: 4, background: "var(--white)" }}>
                                    <option value="all">Any</option>
                                    <option value="15">15 days</option>
                                    <option value="30">30 days</option>
                                    <option value="45">45 days</option>
                                    <option value="60">60 days</option>
                                    <option value="90">90 days</option>
                                </select>
                            </label>

                            <label style={{ fontSize: 11, color: "var(--text-light)" }}>
                                <span style={{ fontWeight: 600, marginRight: 4 }}>Years in business:</span>
                                <select value={yearsInBusinessRangeFilter} onChange={e => setYearsInBusinessRangeFilter(e.target.value)}
                                    style={{ padding: "3px 6px", fontSize: 11, border: "1px solid var(--border)", borderRadius: 4, background: "var(--white)" }}>
                                    <option value="all">Any</option>
                                    <option value="<1">Less than 1 year</option>
                                    <option value="1-5">1–5 years</option>
                                    <option value="5-10">5–10 years</option>
                                    <option value="10+">10+ years</option>
                                    <option value="unknown">Unknown</option>
                                </select>
                            </label>

                            <label style={{ fontSize: 11, color: "var(--text-light)" }}>
                                <span style={{ fontWeight: 600, marginRight: 4 }}>Has booking:</span>
                                <select value={hasTrueBookingFilter} onChange={e => setHasTrueBookingFilter(e.target.value)}
                                    style={{ padding: "3px 6px", fontSize: 11, border: "1px solid var(--border)", borderRadius: 4, background: "var(--white)" }}>
                                    <option value="all">Any</option>
                                    <option value="true">Yes (true booking)</option>
                                    <option value="false">No</option>
                                </select>
                            </label>

                            <label style={{ fontSize: 11, color: "var(--text-light)" }}>
                                <span style={{ fontWeight: 600, marginRight: 4 }}>Booking flow:</span>
                                <select value={bookingFlowTypeFilter} onChange={e => setBookingFlowTypeFilter(e.target.value)}
                                    style={{ padding: "3px 6px", fontSize: 11, border: "1px solid var(--border)", borderRadius: 4, background: "var(--white)" }}>
                                    <option value="all">Any</option>
                                    <option value="photo_upload">📷 Photo upload only</option>
                                    <option value="timeslot_selection">🗓️ Timeslot only</option>
                                    <option value="photo_and_timeslot">📷🗓️ Photo + Timeslot</option>
                                    <option value="other">Other / Basic form</option>
                                    <option value="none">No booking at all</option>
                                </select>
                            </label>

                            <button
                                onClick={() => {
                                    setReviewPainFilter("all");
                                    setReviewCountRangeFilter("all");
                                    setOwnerResponseRateFilter("all");
                                    setLastReviewWithinDays("all");
                                    setYearsInBusinessRangeFilter("all");
                                    setHasTrueBookingFilter("all");
                                    setBookingFlowTypeFilter("all");
                                    setSelectedPainTags(new Set());
                                    setSelectedPraiseTags(new Set());
                                    setPainTagCountMin("all");
                                    setNegativeReviewPercentMin("all");
                                    setMostRecentNegativeWithinDays("all");
                                    setStarRatingBucket("all");
                                    setProfileCompletenessBucket("all");
                                    setRespondsToNegatives("all");
                                    setHasRecentGbpPosts("all");
                                    setHasBusinessDescription("all");
                                    setSelectedBookingTiers(new Set());
                                    setBookingHasInstantQuote("all");
                                    setBookingHasJobSizeInput("all");
                                    setBookingHasItemSelector("all");
                                    setBookingCollectsPayment("all");
                                    setBookingIsQuoteRequestOnly("all");
                                    setSelectedCompetitorStack(new Set());
                                    setSelectedPaymentStack(new Set());
                                    setMentionsCashOnly("all");
                                    setHasOnlinePayment("all");
                                    setSelectedCms(new Set());
                                    setSelectedBookingPlatforms(new Set());
                                    setBookingCtaTargetsPhone("all");
                                    setMarketingMaturityBucket("all");
                                    setLoadTimeBucket("all");
                                    setMobileFriendly("all");
                                    setSslValid("all");
                                    setHasGoogleAds("all");
                                    setHasCallTracking("all");
                                    setHasChatWidget("all");
                                    setHasGTM("all");
                                    setHasFacebookPixel("all");
                                    setHasGoogleAnalytics("all");
                                    setEmployeeBucket("all");
                                    setFleetBucket("all");
                                    setSelectedWebsiteBuiltBy(new Set());
                                    setSelectedMarketCompetitionLevel(new Set());
                                    setMarketRankPercentileMin("all");
                                    setHasFacebook("all");
                                    setHasYouTube("all");
                                    setIsVeteranOwned("all");
                                    setIsFamilyBusiness("all");
                                    setReviewVelocityBucket("all");
                                    setSelectedEmailDomainType(new Set());
                                    setEmailDomainMatchesWebsite("all");
                                    setEmailDeliverable("all");
                                    setSelectedPhoneLineType(new Set());
                                    setPhoneDeliverable("all");
                                    setHasOwnerFullName("all");
                                    setHasOwnerLinkedIn("all");
                                    setIsDirectContact("all");
                                    setLastUpdatedYearBucket("all");
                                    setHasPricingPage("all");
                                    setHasBlog("all");
                                    setHasServiceAreaPublishedOnSite("all");
                                    setTotalPageCountBucket("all");
                                    setSelectedPrimaryBottleneck(new Set());
                                    setWebsiteAgeYearsMin("all");
                                    setSelectedReviewTrend(new Set());
                                    setPainSeverityMin("all");
                                }}
                                style={{ padding: "3px 10px", fontSize: 10, fontWeight: 600, border: "1px solid var(--border)", borderRadius: 4, background: "var(--white)", color: "var(--text-light)", cursor: "pointer" }}>
                                Clear segment filters
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Bulk Actions Bar */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, minHeight: 44 }}>
                {selectedIds.size > 0 ? (
                    <>
                        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{selectedIds.size} selected</span>
                        <div style={{ width: 1, height: 16, background: "var(--border)" }} />
                        <button onClick={enrichSelected} disabled={enriching} style={{ padding: "4px 10px", fontSize: 11, fontWeight: 600, border: "1px solid var(--accent-border)", borderRadius: 4, background: "var(--accent-soft)", color: "var(--accent-strong)", cursor: "pointer" }}>{enriching ? "Enriching..." : "Enrich Selected"}</button>
                        <button onClick={cleanSelectedEmails} disabled={cleaningEmails} title="Verify selected lead emails with Emailable; archive hard failures and keep uncertain emails for review" style={{ padding: "4px 10px", fontSize: 11, fontWeight: 600, border: "1px solid var(--success-border)", borderRadius: 4, background: "var(--success-bg)", color: "var(--success-dark)", cursor: cleaningEmails ? "wait" : "pointer" }}>{cleaningEmails ? "Cleaning..." : "Clean List"}</button>
                        <button onClick={sendToOutreach} disabled={sendingOutreach} style={{ padding: "4px 10px", fontSize: 11, fontWeight: 600, border: "1px solid var(--border)", borderRadius: 4, background: "var(--white)", cursor: "pointer" }}>{sendingOutreach ? "Sending..." : "Trigger Campaign"}</button>
                        <button onClick={copyEmails} title="Copy emails of selected leads to clipboard (newline-separated)" style={{ padding: "4px 10px", fontSize: 11, fontWeight: 600, border: "1px solid var(--info-border)", borderRadius: 4, background: "var(--info-bg)", color: "var(--info)", cursor: "pointer" }}>Copy Emails</button>
                        <button onClick={copyPhones} title="Copy phone numbers of selected leads to clipboard (newline-separated)" style={{ padding: "4px 10px", fontSize: 11, fontWeight: 600, border: "1px solid var(--success-border)", borderRadius: 4, background: "var(--success-bg)", color: "var(--success-dark)", cursor: "pointer" }}>Copy Phones</button>
                        <div style={{ position: "relative" }}>
                            <button onClick={() => setShowGroupSelect(!showGroupSelect)} disabled={addingToGroup}
                                style={{ padding: "4px 10px", fontSize: 11, fontWeight: 600, border: "1px solid var(--border)", borderRadius: 4, background: showGroupSelect ? "rgba(255,107,0,0.08)" : "var(--white)", color: showGroupSelect ? "var(--orange)" : "var(--text)", cursor: "pointer" }}>
                                {addingToGroup ? "Adding..." : "Add to Group"}
                            </button>
                            {showGroupSelect && (
                                <div style={{ position: "absolute", top: "100%", left: 0, marginTop: 4, background: "var(--white)", border: "1px solid var(--border)", borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", minWidth: 220, zIndex: 50, overflow: "hidden" }}>
                                    {groups.length > 0 && groups.map(g => (
                                        <button key={g.id} onClick={() => addToGroup(g.id)}
                                            style={{ display: "block", width: "100%", padding: "8px 14px", fontSize: 12, border: "none", background: "none", cursor: "pointer", textAlign: "left", borderBottom: "1px solid var(--border-light, var(--border))" }}
                                            onMouseEnter={e => (e.currentTarget.style.background = "var(--surface)")}
                                            onMouseLeave={e => (e.currentTarget.style.background = "none")}>
                                            <div style={{ fontWeight: 600, color: "var(--text)" }}>{g.name}</div>
                                            <div style={{ fontSize: 10, color: "var(--text-faint)" }}>{g.memberCount} members</div>
                                        </button>
                                    ))}
                                    <div style={{ padding: "8px 14px", borderTop: groups.length > 0 ? "1px solid var(--border)" : "none" }}>
                                        <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text-faint)", marginBottom: 4 }}>New Group</div>
                                        <div style={{ display: "flex", gap: 4 }}>
                                            <input value={newGroupName} onChange={e => setNewGroupName(e.target.value)} placeholder="Group name..."
                                                style={{ flex: 1, padding: "4px 8px", fontSize: 11, border: "1px solid var(--border)", borderRadius: 4, outline: "none" }}
                                                onKeyDown={e => e.key === "Enter" && createGroupAndAdd()} />
                                            <button className="btn btn-xs btn-primary" onClick={createGroupAndAdd} disabled={!newGroupName.trim()} style={{ fontSize: 10, padding: "3px 8px" }}>Create</button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                        <button onClick={deleteSelected} disabled={deleting} style={{ padding: "4px 10px", fontSize: 11, fontWeight: 600, border: "1px solid var(--danger-border)", borderRadius: 4, background: "var(--danger-bg)", color: "var(--danger)", cursor: "pointer" }}>{deleting ? "Deleting..." : "Discard"}</button>
                    </>
                ) : (
                    <span style={{ fontSize: 12, color: "var(--text-light)" }}>Select rows to trigger outreach or discard.</span>
                )}
                
                <div style={{ flex: 1 }} />
                
                {/* Embedded Filters */}
                <div style={{ display: "flex", gap: 4, background: "var(--border-light)", padding: 4, borderRadius: 8 }}>
                    {["all", "A", "B", "C"].map(g => <FilterChip key={g} label={g === "all" ? "Grades" : g} active={gradeFilter === g} onClick={() => setGradeFilter(g)} />)}
                </div>
                <div style={{ display: "flex", gap: 4, background: "var(--border-light)", padding: 4, borderRadius: 8 }}>
                    {["all", "new", "emailed", "replied"].map(s => <FilterChip key={s} label={s === "all" ? "Outreach" : s} active={outreachFilter === s} onClick={() => setOutreachFilter(s)} />)}
                </div>
                <select value={enrichedFilter} onChange={e => setEnrichedFilter(e.target.value)} style={{ padding: "4px 8px", fontSize: 11, border: "1px solid var(--border)", borderRadius: 6, background: "var(--white)" }}>
                    <option value="all">Enrichment</option>
                    <option value="true">Enriched</option>
                    <option value="false">Not Enriched</option>
                </select>
                <select value={emailVerificationState} onChange={e => setEmailVerificationState(e.target.value)} style={{ padding: "4px 8px", fontSize: 11, border: "1px solid var(--border)", borderRadius: 6, background: "var(--white)" }}>
                    <option value="all">Email Clean</option>
                    <option value="deliverable">Deliverable</option>
                    <option value="unverified">Unverified</option>
                    <option value="risky">Risky</option>
                    <option value="unknown">Unknown</option>
                    <option value="undeliverable">Undeliverable</option>
                    <option value="missing">Missing</option>
                    <option value="invalid">Invalid</option>
                    <option value="duplicate">Duplicate</option>
                </select>
                <select value={archivedFilter} onChange={e => setArchivedFilter(e.target.value)} style={{ padding: "4px 8px", fontSize: 11, border: "1px solid var(--border)", borderRadius: 6, background: "var(--white)" }}>
                    <option value="active">Active</option>
                    <option value="all">All Leads</option>
                    <option value="true">Archived</option>
                </select>
                <select value={competitorFilter} onChange={e => setCompetitorFilter(e.target.value)} style={{ padding: "4px 8px", fontSize: 11, border: "1px solid var(--border)", borderRadius: 6, background: "var(--white)" }}>
                    <option value="all">Competitor</option>
                    <option value="true">Using Competitor</option>
                    <option value="false">No Competitor</option>
                </select>
                <select value={phoneTypeFilter} onChange={e => setPhoneTypeFilter(e.target.value)} style={{ padding: "4px 8px", fontSize: 11, border: "1px solid var(--border)", borderRadius: 6, background: "var(--white)" }}>
                    <option value="all">Phone Type</option>
                    <option value="local">Local</option>
                    <option value="toll_free">Toll-Free</option>
                    <option value="none">No Phone</option>
                </select>
                <input placeholder="Search company..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                    style={{ padding: "6px 12px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 6, background: "var(--white)", width: 160, outline: "none" }} />
            </div>

            {/* Select-all-matching banner — appears when current page is fully selected and more pages match */}
            {canSelectAllMatching && (
                <div style={{
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                    padding: "8px 14px", background: "rgba(37,99,235,0.06)", border: "1px solid rgba(37,99,235,0.2)",
                    borderRadius: 8, fontSize: 12, color: "var(--text)",
                }}>
                    <span>
                        All <b>{leads.length}</b> leads on this page are selected.
                    </span>
                    <button onClick={selectAllMatchingLeads} disabled={loadingSelectAll}
                        style={{
                            padding: "4px 12px", fontSize: 11, fontWeight: 600, cursor: loadingSelectAll ? "wait" : "pointer",
                            border: "1px solid var(--info)", borderRadius: 6, background: "var(--info)", color: "#fff",
                        }}>
                        {loadingSelectAll ? "Selecting…" : `Select all ${total.toLocaleString()} matching filters`}
                    </button>
                </div>
            )}
            {selectAllMatching && selectedIds.size > 0 && (
                <div style={{
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                    padding: "8px 14px", background: "rgba(0,216,74,0.06)", border: "1px solid rgba(0,216,74,0.2)",
                    borderRadius: 8, fontSize: 12, color: "var(--text)",
                }}>
                    <span>
                        <b>{selectedIds.size.toLocaleString()}</b> leads selected across all pages.
                    </span>
                    <button onClick={() => { setSelectedIds(new Set()); setSelectAllMatching(false); }}
                        style={{
                            padding: "4px 12px", fontSize: 11, fontWeight: 600, cursor: "pointer",
                            border: "1px solid var(--border)", borderRadius: 6, background: "var(--white)", color: "var(--text-light)",
                        }}>
                        Clear selection
                    </button>
                </div>
            )}

            {/* Data Table */}
            <div className="op-table-wrapper">
                {loading ? <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)", fontSize: 12 }}>Loading leads...</div> : 
                <table className="op-table">
                    <thead>
                        <tr>
                            <th style={{ width: 36, textAlign: "center" }}>
                                <input type="checkbox" checked={allOnPageSelected} onChange={toggleSelectAll} style={{ cursor: "pointer" }} />
                            </th>
                            <SortHeader label="Company" field="name" />
                            <th style={{ width: 90 }}>Owner</th>
                            <SortHeader label="Market" field="market" w={90} />
                            <SortHeader label="Grade" field="grade" w={50} />
                            <SortHeader label="Score" field="leadScore" w={50} />
                            <th style={{ width: 70 }}>Services</th>
                            <th>Website</th>
                            <th style={{ width: 55 }}>Phone</th>
                            <th style={{ width: 40 }}>Mkt</th>
                            <th style={{ width: 65 }}>CMS</th>
                            <th style={{ width: 70 }}>Competitor</th>
                            <SortHeader label="Status" field="outreachStatus" w={80} />
                            <th style={{ width: 45 }}>Source</th>
                            <th style={{ width: 40 }}>Enr</th>
                        </tr>
                    </thead>
                    <tbody>
                        {leads.map(l => (
                            <><tr key={l.id} style={{ background: selectedIds.has(l.id) ? "var(--surface)" : undefined }}>
                                <td style={{ textAlign: "center" }}>
                                    <input type="checkbox" checked={selectedIds.has(l.id)}
                                        onChange={() => {}}
                                        onClick={() => { if (!isDragging) toggleSelect(l.id); }}
                                        onMouseDown={(e) => { e.preventDefault(); handleDragStart(l.id); }}
                                        onMouseEnter={() => handleDragEnter(l.id)}
                                        onMouseUp={handleDragEnd}
                                        style={{ cursor: "pointer" }} />
                                </td>
                                <td style={{ fontWeight: 600, cursor: "pointer" }} onClick={() => setExpandedLeadId(expandedLeadId === l.id ? null : l.id)}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                        <span style={{ fontSize: 10, color: "var(--text-faint)", transition: "transform 0.15s", transform: expandedLeadId === l.id ? "rotate(90deg)" : "rotate(0deg)" }}>▶</span>
                                        {l.name}
                                    </div>
                                    {l.isExistingClient && <span style={{ fontSize: 9, fontWeight: 700, color: "#8B5CF6", background: "rgba(139,92,246,0.1)", padding: "1px 6px", borderRadius: 4 }}>EXISTING CLIENT</span>}
                                    {l.archivedAt && <span style={{ fontSize: 9, fontWeight: 700, color: "var(--danger)", background: "var(--danger-bg)", padding: "1px 6px", borderRadius: 4, marginLeft: 4 }}>ARCHIVED</span>}
                                </td>
                                <td style={{ fontSize: 11, color: (l as any).ownerName ? "var(--text)" : "var(--text-faint)" }}>{(l as any).ownerName || "—"}</td>
                                <td style={{ fontSize: 11 }}>{(l as any).city || l.market}</td>
                                <td>
                                    <span style={{
                                        fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 8,
                                        background: l.grade === "A" ? "rgba(0,216,74,0.12)" : l.grade === "B" ? "rgba(37,99,235,0.12)" : "rgba(245,158,11,0.12)",
                                        color: l.grade === "A" ? "#00A83A" : l.grade === "B" ? "#2563EB" : "#D97706",
                                    }}>{l.grade}</span>
                                </td>
                                <td style={{ fontWeight: 600, color: "var(--text-light)" }}>{l.leadScore}</td>
                                <td style={{ fontSize: 11 }}>
                                    {l.serviceTypes?.length ? l.serviceTypes.map(t => t.replace("_", " ")).join(", ") : "—"}
                                </td>
                                <td>{l.website ? <a href={l.website.startsWith("http") ? l.website : `https://${l.website}`} target="_blank" rel="noopener noreferrer" style={{ color: l.hasActiveWebsite ? "var(--info)" : "var(--text-faint)", textDecoration: "none", fontSize: 11 }}>{l.website.replace(/^https?:\/\//, "").slice(0, 20)}{l.hasActiveWebsite === false && l.enrichedAt ? " ✗" : ""}</a> : "—"}</td>
                                <td style={{ fontFamily: "monospace", color: "var(--text-light)", fontSize: 11 }}>
                                    {l.phone || "—"}
                                    {l.phoneType && l.phoneType !== "none" && <span style={{ fontSize: 9, marginLeft: 4, color: l.phoneType === "toll_free" ? "var(--info)" : "var(--text-faint)" }}>{l.phoneType === "toll_free" ? "TF" : "L"}</span>}
                                    <span
                                        title={l.email ? `Email: ${l.email}${l.emailVerificationState ? ` (${l.emailVerificationState})` : ""}` : "No email on file"}
                                        style={{ fontSize: 11, marginLeft: 6, color: l.emailDeliverable === true ? "#00A83A" : l.emailDeliverable === false ? "var(--danger)" : l.email ? "var(--orange)" : "var(--text-faint)", opacity: l.email ? 1 : 0.4 }}
                                    >
                                        ✉
                                    </span>
                                </td>
                                <td style={{ fontSize: 11, fontWeight: 600, color: (l as any).marketingMaturityScore != null ? ((l as any).marketingMaturityScore >= 50 ? "var(--success)" : (l as any).marketingMaturityScore >= 20 ? "var(--warn-dark)" : "var(--text-faint)") : "var(--text-faint)" }}>{(l as any).marketingMaturityScore ?? "—"}</td>
                                <td style={{ fontSize: 10, color: "var(--text-light)" }}>
                                    {(l as any).cmsDetected ? <span>{(l as any).cmsDetected}{(l as any).isDiyBuilder ? <span style={{ color: "var(--orange)", marginLeft: 2 }}>DIY</span> : ""}</span> : "—"}
                                </td>
                                <td style={{ fontSize: 11 }}>
                                    {l.usingCompetitor ? <span style={{ color: "var(--danger)", fontWeight: 600 }}>{l.competitorPlatform || "Yes"}</span> : <span style={{ color: "var(--text-faint)" }}>—</span>}
                                </td>
                                <td><Badge status={l.outreachStatus} /></td>
                                <td style={{ fontSize: 10, fontWeight: 600, color: (l as any).discoveredVia === "facebook_group" ? "#1877F2" : (l as any).discoveredVia === "manual" ? "var(--text-faint)" : "var(--success)" }}>
                                    {(l as any).discoveredVia === "facebook_group" ? "FB" : (l as any).discoveredVia === "manual" ? "Manual" : "GMaps"}
                                </td>
                                <td style={{ fontSize: 11, color: l.enrichedAt ? "var(--success)" : "var(--text-faint)" }}>{l.enrichedAt ? "✓" : "—"}</td>
                            </tr>
                            {/* Expanded detail row */}
                            {expandedLeadId === l.id && (
                                <tr><td colSpan={17} style={{ padding: 0, background: "var(--surface)" }}>
                                    <div style={{ padding: "16px 20px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
                                        {/* Pain Points */}
                                        <div style={{ gridColumn: "span 3", background: "rgba(239,68,68,0.04)", border: "1px solid rgba(239,68,68,0.1)", borderRadius: 10, padding: "12px 16px" }}>
                                            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--danger)", marginBottom: 8 }}>Pain Points</div>
                                            {(l as any).painPoints?.length > 0 ? (
                                                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                                    {((l as any).painPoints as string[]).map((p: string, i: number) => (
                                                        <div key={i} style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", gap: 6, alignItems: "flex-start" }}>
                                                            <span style={{ color: "var(--danger)", flexShrink: 0 }}>•</span> {p}
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <div style={{ fontSize: 12, color: "var(--text-faint)" }}>No pain points detected — run enrichment to analyze</div>
                                            )}
                                        </div>

                                        {/* Company Info */}
                                        <div>
                                            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>Company</div>
                                            {[
                                                ["Phone", l.phone],
                                                ["  ↳ Line Type", (l as any).phoneLineType ? ({ mobile: "📱 Mobile", landline: "☎️ Landline", voip: "🖥 VOIP", unknown: "Unknown" } as Record<string, string>)[(l as any).phoneLineType] || (l as any).phoneLineType : null],
                                                ["  ↳ Carrier", (l as any).phoneCarrier],
                                                ["  ↳ Deliverable", (l as any).phoneDeliverable === true ? "✓ Yes" : (l as any).phoneDeliverable === false ? "✗ No" : null],
                                                ["Email", l.email],
                                                ["  ↳ Domain Type", (l as any).emailDomainType ? ({ personal: "Personal", business_custom: "Business (custom domain)", unknown: "Unknown" } as Record<string, string>)[(l as any).emailDomainType] || (l as any).emailDomainType : null],
                                                ["  ↳ Matches Website", (l as any).emailDomainMatchesWebsite ? "✓ Yes" : null],
                                                ["  ↳ Verification", l.emailVerificationState ? `${l.emailVerificationState}${l.emailVerificationReason ? ` (${l.emailVerificationReason})` : ""}` : null],
                                                ["  ↳ Deliverable", l.emailDeliverable === true ? "✓ Yes" : l.emailDeliverable === false ? "✗ No" : null],
                                                ["  ↳ Risk Score", l.emailRiskScore != null ? `${l.emailRiskScore}/100` : null],
                                                ["  ↳ Emailable Score", l.emailVerificationScore != null ? `${l.emailVerificationScore}/100` : null],
                                                ["  ↳ Verified", l.emailVerifiedAt ? new Date(l.emailVerifiedAt).toLocaleString() : null],
                                                ["  ↳ Archived", l.archivedAt ? `${new Date(l.archivedAt).toLocaleString()}${l.archiveReason ? ` (${l.archiveReason})` : ""}` : null],
                                                ["Website", l.website],
                                                ["Owner", (l as any).ownerName || (l as any).ownerNameFromReviews],
                                                ["  ↳ First Name", (l as any).ownerFirstName],
                                                ["  ↳ Last Name", (l as any).ownerLastName],
                                                ["  ↳ LinkedIn", (l as any).ownerLinkedInUrl],
                                                ["  ↳ Direct Contact", (l as any).isDirectContact ? "🎯 Yes" : null],
                                                ["Owner Source", (l as any).ownerNameSource ? ({ website: "Website", reviews: "Google Reviews", web_search: "Web Search", facebook: "Facebook" } as Record<string, string>)[(l as any).ownerNameSource] || (l as any).ownerNameSource : null],
                                                ["Owner Source URL", (l as any).ownerNameSourceUrl],
                                                ["Owner Bio", (l as any).ownerBio],
                                                ["Founded", (l as any).foundedYear],
                                                ["Years in Business", (l as any).yearsInBusiness ? `${(l as any).yearsInBusiness} years` : null],
                                                ["  ↳ Bucket", (l as any).yearsInBusinessBucket],
                                                ["Veteran Owned", (l as any).isVeteranOwned ? "Yes" : null],
                                                ["Family Business", (l as any).isFamilyBusiness ? "Yes" : null],
                                                ["Employees", (l as any).estimatedEmployees],
                                                ["  ↳ Bucket", (l as any).employeeSizeBucket],
                                                ["Fleet Size", (l as any).estimatedFleetSize],
                                                ["  ↳ Bucket", (l as any).fleetSizeBucket],
                                                ["Service Types", (l as any).serviceTypes?.join(", ")],
                                                ["Service Area", (l as any).serviceAreaDescription || (l as any).serviceAreaCities?.join(", ")],
                                                ["Phone Type", (l as any).phoneType],
                                                ["Market", l.market],
                                                ["Address", (l as any).address],
                                            ].filter(([, v]) => v).map(([label, value]) => (
                                                <div key={label as string} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0", borderBottom: "1px solid var(--border-light)" }}>
                                                    <span style={{ color: "var(--text-light)" }}>{label}</span>
                                                    <span style={{ color: "var(--text)", fontWeight: 500, textAlign: "right", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>{String(value)}</span>
                                                </div>
                                            ))}
                                        </div>

                                        {/* Website & Tech */}
                                        <div>
                                            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>Website & Tech</div>
                                            {[
                                                ["CMS", (l as any).cmsDetected],
                                                ["Page Builder", (l as any).pageBuilder],
                                                ["Built By", (l as any).websiteBuiltBy],
                                                ["True Online Booking", (l as any).hasTrueOnlineBooking ? "Yes" : ((l as any).hasOnlineBooking !== undefined ? "No" : null)],
                                                ["Booking Platform", (l as any).bookingPlatform],
                                                ["Booking Type", (l as any).bookingType && (l as any).bookingType !== "none" ? ({ embed: "Embedded widget", external_link: "External link", native_form: "Native date/time form", cta_only: "CTA text only (no real booking)" } as Record<string, string>)[(l as any).bookingType] || (l as any).bookingType : null],
                                                ["Booking Flow", (l as any).bookingFlowType ? ({ photo_upload: "📷 Photo upload only", timeslot_selection: "🗓️ Timeslot only", photo_and_timeslot: "📷🗓️ Photo + Timeslot", other: "Other" } as Record<string, string>)[(l as any).bookingFlowType] || (l as any).bookingFlowType : null],
                                                ["Booking Tier", (l as any).bookingSophistication ? ({ none: "None", cta_only: "🔘 CTA only", basic_scheduler: "🗓️ Basic scheduler", photo_collector: "📷 Photo collector", quote_form: "📝 Quote form", instant_quote: "💵 Instant quote", full_booking: "🏆 Full booking", other: "Other" } as Record<string, string>)[(l as any).bookingSophistication] || (l as any).bookingSophistication : null],
                                                ["  ↳ Photo Upload", (l as any).bookingHasPhotoUpload ? "Yes" : null],
                                                ["  ↳ Timeslot Picker", (l as any).bookingHasTimeslotSelection ? "Yes" : null],
                                                ["  ↳ Address Input", (l as any).bookingHasAddressInput ? "Yes" : null],
                                                ["  ↳ Job Size Input", (l as any).bookingHasJobSizeInput ? "Yes" : null],
                                                ["  ↳ Item Selector", (l as any).bookingHasItemSelector ? "Yes" : null],
                                                ["  ↳ Instant Quote", (l as any).bookingHasInstantQuote ? "Yes" : null],
                                                ["  ↳ Price Estimate", (l as any).bookingHasPriceEstimate ? "Yes" : null],
                                                ["  ↳ Collects Payment", (l as any).bookingCollectsPayment ? "Yes" : null],
                                                ["  ↳ Quote Request Only", (l as any).bookingIsQuoteRequestOnly ? "Yes" : null],
                                                ["'Book Now' CTA", (l as any).hasBookingCta ? "Yes" : null],
                                                ["Misleading CTA (dials phone)", (l as any).bookingCtaTargetsPhone ? "⚠️ Yes — 'Book Now' dials phone" : null],
                                                ["Quote Form", (l as any).hasQuoteForm ? "Yes" : "No"],
                                                ["CTA", (l as any).hasCta ? "Yes" : "No"],
                                                ["Mobile Friendly", (l as any).mobileFriendly ? "Yes" : "No"],
                                                ["SSL", (l as any).sslValid ? "Yes" : "No"],
                                                ["Load Time", (l as any).loadTimeSeconds ? `${(l as any).loadTimeSeconds.toFixed(1)}s` : null],
                                                ["Last Updated (Copyright)", (l as any).lastUpdatedYear],
                                                ["  ↳ Website Age", (l as any).websiteAgeYears != null ? `${(l as any).websiteAgeYears} yrs` : null],
                                                ["Total Pages (Sitemap)", (l as any).totalPageCount],
                                                ["Has Pricing Page", (l as any).hasPricingPage ? "Yes" : null],
                                                ["Has Blog", (l as any).hasBlog ? "Yes" : null],
                                                ["Service Area on Site", (l as any).hasServiceAreaPublishedOnSite ? `Yes (${(l as any).serviceAreaPagesCount || 0} pages)` : null],
                                                ["Competitor Platform", (l as any).competitorPlatform],
                                                ["  ↳ Jobber", (l as any).usesJobber ? "Yes" : null],
                                                ["  ↳ Workiz", (l as any).usesWorkiz ? "Yes" : null],
                                                ["  ↳ Housecall Pro", (l as any).usesHousecallPro ? "Yes" : null],
                                                ["  ↳ ServiceTitan", (l as any).usesServiceTitan ? "Yes" : null],
                                                ["  ↳ Thryv", (l as any).usesThryv ? "Yes" : null],
                                                ["  ↳ GorillaDesk", (l as any).usesGorillaDesk ? "Yes" : null],
                                                ["  ↳ FieldPulse", (l as any).usesFieldPulse ? "Yes" : null],
                                                ["  ↳ QuoteIQ", (l as any).usesQuoteIQ ? "Yes" : null],
                                                ["  ↳ Docket", (l as any).usesDocket ? "Yes" : null],
                                                ["  ↳ Dumpsters.com", (l as any).usesDumpstersCom ? "Yes" : null],
                                                ["Payment Platform", (l as any).paymentPlatform],
                                                ["  ↳ Stripe", (l as any).usesStripe ? "Yes" : null],
                                                ["  ↳ Square", (l as any).usesSquare ? "Yes" : null],
                                                ["  ↳ Online Payment", (l as any).hasOnlinePayment ? "Yes" : null],
                                                ["  ↳ Cash/Check Only", (l as any).mentionsCashOnly ? "⚠️ Yes" : null],
                                            ].filter(([, v]) => v != null).map(([label, value]) => (
                                                <div key={label as string} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0", borderBottom: "1px solid var(--border-light)" }}>
                                                    <span style={{ color: "var(--text-light)" }}>{label}</span>
                                                    <span style={{ color: "var(--text)", fontWeight: 500 }}>{String(value)}</span>
                                                </div>
                                            ))}
                                        </div>

                                        {/* Marketing & Reviews */}
                                        <div>
                                            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>Marketing & Reviews</div>
                                            {[
                                                ["Marketing Score", (l as any).marketingMaturityScore != null ? `${(l as any).marketingMaturityScore}/100` : null],
                                                ["Google Ads", (l as any).hasGoogleAds ? "Yes" : null],
                                                ["Facebook Pixel", (l as any).hasFacebookPixel ? "Yes" : null],
                                                ["Call Tracking", (l as any).callTrackingProvider || ((l as any).hasCallTracking ? "Yes" : null)],
                                                ["GTM", (l as any).hasGTM ? "Yes" : null],
                                                ["Chat Widget", (l as any).chatWidgetName || ((l as any).hasChatWidget ? "Yes" : null)],
                                                ["Facebook Page", (l as any).hasFacebook ? "Linked" : null],
                                                ["YouTube", (l as any).hasYouTube ? "Linked" : null],
                                                ["Total Reviews on Google", (l as any).reviewCount != null ? String((l as any).reviewCount) : null],
                                                ["Google Rating", (l as any).rating != null ? `${(l as any).rating}★` : null],
                                                ["Reviews Analyzed", (l as any).reviewsAnalyzedCount != null ? `${(l as any).reviewsAnalyzedCount} most recent` : null],
                                                ["  ↳ Positive (4-5★)", (l as any).positiveReviewCount != null ? String((l as any).positiveReviewCount) : null],
                                                ["  ↳ Negative (1-3★)", (l as any).negativeReviewCount != null ? String((l as any).negativeReviewCount) : null],
                                                ["Reviews (last 90d)", (l as any).reviewVelocity90d != null ? String((l as any).reviewVelocity90d) : null],
                                                ["Last Review Date", (l as any).lastReviewDate ? new Date((l as any).lastReviewDate).toLocaleDateString() : null],
                                                ["  ↳ Days Since", (l as any).daysSinceLastReview != null ? `${(l as any).daysSinceLastReview}d ago` : null],
                                                ["Owner Response Rate", (l as any).ownerResponseRate != null ? `${Math.round((l as any).ownerResponseRate * 100)}% of ${(l as any).reviewsAnalyzedCount || "analyzed"}` : null],
                                                ["  ↳ On Negatives", (l as any).negativeResponseRate != null ? `${Math.round((l as any).negativeResponseRate * 100)}%` : null],
                                                ["  ↳ On Positives", (l as any).positiveResponseRate != null ? `${Math.round((l as any).positiveResponseRate * 100)}%` : null],
                                                ["Last Owner Response", (l as any).lastOwnerResponseDate ? new Date((l as any).lastOwnerResponseDate).toLocaleDateString() : null],
                                                ["  ↳ Days Since", (l as any).daysSinceLastOwnerResponse != null ? `${(l as any).daysSinceLastOwnerResponse}d ago` : null],
                                                ["Profile Completeness", (l as any).profileCompletenessScore != null ? `${(l as any).profileCompletenessScore}/100` : null],
                                                ["  ↳ Description", (l as any).hasBusinessDescription ? "Yes" : null],
                                                ["  ↳ Business Hours", (l as any).hasBusinessHours ? "Yes" : null],
                                                ["  ↳ Open 24/7", (l as any).isOpen24_7 ? "Yes" : null],
                                                ["  ↳ Photo Count", (l as any).photoCount != null ? String((l as any).photoCount) : null],
                                                ["  ↳ Q&A Activity", (l as any).hasQandAActivity ? "Yes" : null],
                                                ["  ↳ GBP Posts (90d)", (l as any).gbpPostsLast90d != null ? String((l as any).gbpPostsLast90d) : null],
                                                ["Most Recent Negative", (l as any).mostRecentNegativeReviewDate ? new Date((l as any).mostRecentNegativeReviewDate).toLocaleDateString() : null],
                                                ["  ↳ Days Since", (l as any).daysSinceMostRecentNegative != null ? `${(l as any).daysSinceMostRecentNegative}d ago` : null],
                                                ["% Negative Reviews", (l as any).negativeReviewPercent != null ? `${Math.round((l as any).negativeReviewPercent * 100)}%` : null],
                                                ["Competitors Nearby", (l as any).marketCompetitorCount != null ? `${(l as any).marketCompetitorCount} (${(l as any).marketCompetitionLevel})` : null],
                                                ["Market Rank", (l as any).marketRankByReviews != null ? `#${(l as any).marketRankByReviews}` : null],
                                            ].filter(([, v]) => v != null).map(([label, value]) => (
                                                <div key={label as string} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0", borderBottom: "1px solid var(--border-light)" }}>
                                                    <span style={{ color: "var(--text-light)" }}>{label}</span>
                                                    <span style={{ color: "var(--text)", fontWeight: 500 }}>{String(value)}</span>
                                                </div>
                                            ))}
                                            {(l as any).primaryBottleneck && (l as any).primaryBottleneck !== "none" && (
                                                <div style={{ marginTop: 8, padding: "8px 10px", background: "rgba(255,107,0,0.06)", border: "1px solid rgba(255,107,0,0.2)", borderRadius: 6 }}>
                                                    <div style={{ fontSize: 10, fontWeight: 700, color: "var(--orange)", marginBottom: 2, textTransform: "uppercase", letterSpacing: "0.04em" }}>🎯 Primary Bottleneck</div>
                                                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
                                                        {({
                                                            missed_calls: "📞 Missed calls",
                                                            no_online_booking: "🚫 No online booking",
                                                            poor_response_rate: "💬 Poor response rate",
                                                            outdated_website: "🌐 Outdated website",
                                                            no_reviews: "🕳 No reviews",
                                                            stale_reviews: "💤 Stale reviews",
                                                            negative_review_trend: "📉 Negative review trend",
                                                        } as Record<string, string>)[(l as any).primaryBottleneck] || (l as any).primaryBottleneck}
                                                    </div>
                                                    {(l as any).painSeverityScore != null && (
                                                        <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>
                                                            Pain severity: <b style={{ color: (l as any).painSeverityScore >= 80 ? "var(--danger)" : (l as any).painSeverityScore >= 60 ? "var(--orange)" : (l as any).painSeverityScore >= 40 ? "var(--warn-dark)" : "var(--text-light)" }}>{(l as any).painSeverityScore}/100</b>
                                                        </div>
                                                    )}
                                                    {(l as any).recentReviewTrend && (
                                                        <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
                                                            Trend: {({
                                                                improving: "📈 Improving",
                                                                stable: "➖ Stable",
                                                                declining: "📉 Declining",
                                                                dormant: "💤 Dormant",
                                                                insufficient_data: "❓ Insufficient data",
                                                            } as Record<string, string>)[(l as any).recentReviewTrend] || (l as any).recentReviewTrend}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                            {(l as any).businessSpecialty && (
                                                <div style={{ marginTop: 8, padding: "8px 10px", background: "rgba(37,99,235,0.04)", border: "1px solid rgba(37,99,235,0.15)", borderRadius: 6 }}>
                                                    <div style={{ fontSize: 10, fontWeight: 700, color: "var(--info)", marginBottom: 2, textTransform: "uppercase", letterSpacing: "0.04em" }}>🎯 Business Specialty (Claude-extracted)</div>
                                                    <div style={{ fontSize: 11, color: "var(--text)", fontStyle: "italic" }}>&ldquo;{(l as any).businessSpecialty}&rdquo;</div>
                                                </div>
                                            )}
                                            {(l as any).painTags?.length > 0 && (
                                                <div style={{ marginTop: 8 }}>
                                                    <div style={{ fontSize: 10, fontWeight: 600, color: "var(--danger)", marginBottom: 4 }}>Pain Tags ({(l as any).painTagCount ?? (l as any).painTags.length})</div>
                                                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                                                        {((l as any).painTags as string[]).map((tag: string) => {
                                                            const count = ((l as any).painTagCounts as Record<string, number> | null)?.[tag];
                                                            return <span key={tag} style={{ fontSize: 10, fontWeight: 600, padding: "2px 6px", background: "rgba(239,68,68,0.08)", color: "var(--danger)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 8 }}>{tag}{count ? ` × ${count}` : ""}</span>;
                                                        })}
                                                    </div>
                                                </div>
                                            )}
                                            {(l as any).topNegativeReviewExcerpt && (
                                                <div style={{ marginTop: 8 }}>
                                                    <div style={{ fontSize: 10, fontWeight: 600, color: "var(--danger)", marginBottom: 4 }}>Top Negative Review (verbatim — for outreach quoting)</div>
                                                    <div style={{ fontSize: 11, color: "var(--text-muted)", fontStyle: "italic", padding: "6px 10px", background: "rgba(239,68,68,0.04)", borderLeft: "2px solid var(--danger)", borderRadius: 4 }}>&ldquo;{(l as any).topNegativeReviewExcerpt}&rdquo;</div>
                                                </div>
                                            )}
                                            {(l as any).topPraiseReviewExcerpt && (
                                                <div style={{ marginTop: 8 }}>
                                                    <div style={{ fontSize: 10, fontWeight: 600, color: "var(--success)", marginBottom: 4 }}>Top Praise Review (verbatim)</div>
                                                    <div style={{ fontSize: 11, color: "var(--text-muted)", fontStyle: "italic", padding: "6px 10px", background: "rgba(0,216,74,0.04)", borderLeft: "2px solid #00A83A", borderRadius: 4 }}>&ldquo;{(l as any).topPraiseReviewExcerpt}&rdquo;</div>
                                                </div>
                                            )}
                                            {(l as any).praiseTags?.length > 0 && (
                                                <div style={{ marginTop: 8 }}>
                                                    <div style={{ fontSize: 10, fontWeight: 600, color: "var(--success)", marginBottom: 4 }}>Praise Tags</div>
                                                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                                                        {((l as any).praiseTags as string[]).map((tag: string) => {
                                                            const count = ((l as any).praiseTagCounts as Record<string, number> | null)?.[tag];
                                                            return <span key={tag} style={{ fontSize: 10, fontWeight: 600, padding: "2px 6px", background: "rgba(0,216,74,0.08)", color: "#00A83A", border: "1px solid rgba(0,216,74,0.2)", borderRadius: 8 }}>{tag}{count ? ` × ${count}` : ""}</span>;
                                                        })}
                                                    </div>
                                                </div>
                                            )}
                                            {(l as any).businessDescription && (
                                                <div style={{ marginTop: 8 }}>
                                                    <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text-faint)", marginBottom: 4 }}>GBP Description</div>
                                                    <div style={{ fontSize: 11, color: "var(--text-muted)", fontStyle: "italic" }}>&ldquo;{(l as any).businessDescription}&rdquo;</div>
                                                </div>
                                            )}
                                            {(l as any).reviewComplaints?.length > 0 && !(l as any).painTags?.length && (
                                                <div style={{ marginTop: 8 }}>
                                                    <div style={{ fontSize: 10, fontWeight: 600, color: "var(--danger)", marginBottom: 4 }}>Review Complaints (legacy)</div>
                                                    {((l as any).reviewComplaints as string[]).map((c: string, i: number) => (
                                                        <div key={i} style={{ fontSize: 11, color: "var(--text-muted)" }}>• {c}</div>
                                                    ))}
                                                </div>
                                            )}
                                            {(l as any).reviewPraise?.length > 0 && !(l as any).praiseTags?.length && (
                                                <div style={{ marginTop: 8 }}>
                                                    <div style={{ fontSize: 10, fontWeight: 600, color: "var(--success)", marginBottom: 4 }}>Review Praise (legacy)</div>
                                                    {((l as any).reviewPraise as string[]).map((p: string, i: number) => (
                                                        <div key={i} style={{ fontSize: 11, color: "var(--text-muted)" }}>• {p}</div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </td></tr>
                            )}
                        </>))}
                        {leads.length === 0 && <tr><td colSpan={17} style={{ textAlign: "center", padding: 40, color: "var(--text-faint)" }}>No leads match the criteria.</td></tr>}
                    </tbody>
                </table>}
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0" }}>
                    <span style={{ fontSize: 12, color: "var(--text-light)" }}>Showing {((page - 1) * LEADS_PER_PAGE) + 1}–{Math.min(page * LEADS_PER_PAGE, total)} of {total}</span>
                    <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} style={{ padding: "4px 10px", fontSize: 11, fontWeight: 600, border: "1px solid var(--border)", borderRadius: 4, background: "var(--white)", cursor: page <= 1 ? "default" : "pointer", opacity: page <= 1 ? 0.5 : 1 }}>Previous</button>
                        <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} style={{ padding: "4px 10px", fontSize: 11, fontWeight: 600, border: "1px solid var(--border)", borderRadius: 4, background: "var(--white)", cursor: page >= totalPages ? "default" : "pointer", opacity: page >= totalPages ? 0.5 : 1 }}>Next</button>
                    </div>
                </div>
            )}
            
            {toast && <div style={{ position: "fixed", bottom: 20, right: 20, background: toast.type === "error" ? "var(--danger)" : "var(--success)", color: "#fff", padding: "10px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600, boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}>{toast.msg}</div>}
        </div>
    );
}
