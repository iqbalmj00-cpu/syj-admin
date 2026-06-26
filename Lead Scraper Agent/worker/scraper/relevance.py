"""
Lead Scraper industry relevance gate.

The worker must not treat the search term as proof that a Google Maps row is a
junk-removal or dumpster-rental company. Classification is evidence-ranked:
strong target evidence can beat conditional off-target terms such as "moving",
while absolute unrelated businesses are still rejected.
"""

from __future__ import annotations

from dataclasses import dataclass
import re


NAME_KEYS = ("name",)
CATEGORY_KEYS = ("type", "category", "subtypes", "types", "categories")
DESCRIPTION_KEYS = ("description", "about", "business_description", "summary")

# These are true wrong-industry signals that should win even when a provider
# supplies a loose "junk removal service" category.
ALWAYS_EXCLUDE = re.compile(
    r"\b("
    r"junk\s*car|cash\s*for\s*(car|junk)|we\s*buy\s*(car|junk|vehicle)|"
    r"auto\s*(salvage|wreck|wrecker|parts?|supply|repair|service|sales)|"
    r"autozone|vehicle\s*removal|car\s*buyer|sell\s*your\s*car|buy\s*my\s*car|"
    r"scrap\s*metal|scrap\s*yard|paper\s*mill|"
    r"u-?haul|truck\s*rental\s*agency|"
    r"police|sheriff|law\s*enforcement|government\s*office|city\s*hall"
    r")\b",
    re.I,
)

# These are off-target when standalone, but common on real junk haulers that
# also do moving, demolition cleanouts, light landscaping cleanup, or janitorial
# turnover work. They lose to strong target evidence below.
CONDITIONAL_EXCLUDE = re.compile(
    r"\b("
    r"tow(ing)?\s*(company|service)?|"
    r"storage\s*unit|storage\s*facility|self\s*storage|mini\s*storage|"
    r"lawn\s*care|landscap(ing|er)\s*(only|service|company)?|"
    r"maid\s*service|janitorial|custodial|pest\s*control|"
    r"plumb(ing|er)|electrician|hvac|roofing|painting\s*(company|service|contractor)|"
    r"paving\s*contractor|dry\s*wall\s*contractor|gutter\s*(cleaning|service)|"
    r"moving\s*(company|service|and\s*storage)?|mover(s)?|relocation\s*(company|service)|"
    r"clean(ing)?\s*(company|service|maid|house|home|carpet|window|pressure\s*wash|power\s*wash)|"
    r"restoration|water\s*damage|fire\s*damage|mold\s*remediat|flood\s*damage|"
    r"storm\s*damage|disaster\s*recovery|"
    r"demolition|demo\s*contractor|wrecking|tear\s*down|"
    r"excavat(ing|ion)\s*(contractor|service)?|construction\s*company|"
    r"tree\s*(service|trimming|removal)|"
    r"(portable|shipping|storage)\s*container|container\s*(storage|sales)|"
    r"dumpster\s*(cleaning|washing|enclosure|pad)"
    r")\b",
    re.I,
)

DIRECT_JUNK = re.compile(
    r"\b("
    r"junk\s*(remov\w*|haul\w*|pickup|pick\s*up|disposal|clean|clearing)|"
    r"hauling\s*junk|haul\s*junk|"
    r"debris\s*(remov\w*|haul\w*|cleanup|clean\s*up|disposal)|"
    r"trash\s*(remov\w*|haul\w*|pickup|disposal)|rubbish\s*(remov\w*|haul\w*|pickup|disposal)|"
    r"furniture\s*remov\w*|appliance\s*remov\w*|"
    r"cleanout|clean\s*out|estate\s*clean|foreclosure\s*clean|hoarder|"
    r"yard\s*waste|construction\s*(clean|cleanup|debris)|property\s*cleanout"
    r")\b",
    re.I,
)

DIRECT_DUMPSTER = re.compile(
    r"\b(dumpster|roll[\s-]*off|rolloff|waste\s*container|dump\s*container)\b",
    re.I,
)

BRAND_JUNK_NAME = re.compile(r"\bjunk\b", re.I)
STRONG_CATEGORY = re.compile(
    r"\b(junk\s*removal\s*service|debris\s*removal\s*service|dumpster\s*rental\s*service|"
    r"waste\s*container\s*rental|roll[\s-]*off\s*(service|dumpster|container))\b",
    re.I,
)
CONTAINER_RENTAL = re.compile(r"\b(container\s*rental|bin\s*rental)\b", re.I)
CONTAINER_CONTEXT = re.compile(
    r"\b(waste|trash|debris|dumpster|roll[\s-]*off|rolloff|rubbish|garbage|disposal)\b",
    re.I,
)

GENERIC_HAULING = re.compile(r"\b(hauling|hauling\s*service|haulers?|haul\s*(away|off|it))\b", re.I)
WASTE_CONTEXT = re.compile(
    r"\b(garbage\s*collection|waste\s*(management|disposal|service)|trash|rubbish|junk|debris|"
    r"cleanout|clean\s*out|dumpster|roll[\s-]*off|rolloff|disposal)\b",
    re.I,
)

GENERIC_WASTE_NAME = re.compile(
    r"\b(disposal|sanitation|waste|refuse|rubbish|trash|carting)\b",
    re.I,
)
WASTE_CATEGORY = re.compile(
    r"\b(garbage\s*collection|waste\s*(management|disposal|service)|debris\s*removal|"
    r"junk\s*removal|dumpster\s*rental|trash|rubbish)\b",
    re.I,
)
STORAGE_CONTAINER = re.compile(r"\b((portable|shipping|storage)\s*container|container\s*(storage|sales))\b", re.I)
WASTE_CONTAINER_CONTEXT = re.compile(
    r"\b(waste|trash|debris|dumpster|roll[\s-]*off|rolloff|rubbish|garbage|disposal)\b",
    re.I,
)
DUMPSTER_CLEANING = re.compile(r"\bdumpster\s*(cleaning|washing|enclosure|pad)\b", re.I)
DUMPSTER_RENTAL_CONTEXT = re.compile(
    r"\b(rent(al|s)?|roll[\s-]*off|rolloff|waste\s*container|dumpster\s*rental)\b",
    re.I,
)

STRONG_JUNK_KEYWORDS = re.compile(
    r"\b(junk\s*(remov\w*|haul\w*|disposal|pickup|pick\s*up)|hauling\s*junk|"
    r"dumpster|roll[\s-]*off|rolloff|trash\s*remov\w*|debris\s*remov\w*|"
    r"cleanout|clean\s*out)\b",
    re.I,
)


@dataclass(frozen=True)
class RelevanceResult:
    relevant: bool
    reason: str
    company_type: str | None = None
    matched: tuple[str, ...] = ()


def _string_items(value, *, split_commas: bool) -> list[str]:
    if value in (None, ""):
        return []
    if isinstance(value, str):
        pieces = value.split(",") if split_commas else [value]
        return [p.strip() for p in pieces if p.strip()]
    if isinstance(value, dict):
        out: list[str] = []
        for item in value.values():
            out.extend(_string_items(item, split_commas=split_commas))
        return out
    if isinstance(value, (list, tuple, set)):
        out: list[str] = []
        for item in value:
            out.extend(_string_items(item, split_commas=split_commas))
        return out
    text = str(value).strip()
    return [text] if text else []


def _dedupe(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        key = value.lower()
        if key not in seen:
            seen.add(key)
            result.append(value)
    return result


def extract_categories(row: dict) -> list[str]:
    """Return real category/type strings from the row, never the query term."""
    values: list[str] = []
    for key in CATEGORY_KEYS:
        values.extend(_string_items(row.get(key), split_commas=True))
    return _dedupe(values)


def searchable_text(row: dict) -> str:
    """Build classifier text from real business evidence only."""
    parts: list[str] = []
    name = str(row.get("name") or "").strip()
    if name:
        parts.append(name)
    parts.extend(extract_categories(row))
    for key in DESCRIPTION_KEYS:
        parts.extend(_string_items(row.get(key), split_commas=False))
    return " ".join(parts).lower()


def _name_text(row: dict) -> str:
    return " ".join(str(row.get(k) or "") for k in NAME_KEYS).strip().lower()


def _category_text(row: dict) -> str:
    return " ".join(extract_categories(row)).lower()


def classify_row(row: dict) -> RelevanceResult:
    text = searchable_text(row)
    if not text:
        return RelevanceResult(False, "no_searchable_evidence")
    if ALWAYS_EXCLUDE.search(text):
        return RelevanceResult(False, "hard_exclude")
    if STORAGE_CONTAINER.search(text) and not WASTE_CONTAINER_CONTEXT.search(text):
        return RelevanceResult(False, "hard_exclude")
    if DUMPSTER_CLEANING.search(text) and not DUMPSTER_RENTAL_CONTEXT.search(text):
        return RelevanceResult(False, "hard_exclude")

    name = _name_text(row)
    categories = _category_text(row)
    direct_category = bool(STRONG_CATEGORY.search(categories))
    direct_junk = bool(DIRECT_JUNK.search(text) or direct_category)
    direct_dumpster = bool(DIRECT_DUMPSTER.search(text))
    contextual_container = bool(CONTAINER_RENTAL.search(text) and CONTAINER_CONTEXT.search(text))
    contextual_hauling = bool(GENERIC_HAULING.search(text) and WASTE_CONTEXT.search(text))
    brand_junk_with_waste = bool(BRAND_JUNK_NAME.search(name) and WASTE_CONTEXT.search(categories))
    generic_waste_company = bool(GENERIC_WASTE_NAME.search(name) and WASTE_CATEGORY.search(categories))

    matched: list[str] = []
    if direct_category:
        matched.append("strong_category")
    if direct_junk:
        matched.append("direct_junk")
    if direct_dumpster:
        matched.append("direct_dumpster")
    if contextual_container:
        matched.append("contextual_container")
    if contextual_hauling:
        matched.append("contextual_hauling")
    if brand_junk_with_waste:
        matched.append("brand_junk_with_waste_category")
    if generic_waste_company:
        matched.append("generic_waste_company_with_category")

    if not matched:
        if ALWAYS_EXCLUDE.search(text) or CONDITIONAL_EXCLUDE.search(text):
            return RelevanceResult(False, "hard_exclude")
        return RelevanceResult(False, "no_positive_match")

    strong_positive = bool(
        direct_category
        or direct_dumpster
        or contextual_container
        or brand_junk_with_waste
        or STRONG_JUNK_KEYWORDS.search(text)
    )
    if CONDITIONAL_EXCLUDE.search(text) and not strong_positive:
        return RelevanceResult(False, "conditional_exclude_without_strong_positive")

    company_type = None
    if direct_dumpster or contextual_container:
        company_type = "dumpster_rental"
    elif direct_junk or brand_junk_with_waste:
        company_type = "junk_removal"

    return RelevanceResult(True, "accepted", company_type, tuple(matched))


def rejection_sample(row: dict, reason: str) -> dict:
    """Compact log payload for rejected rows; no secrets or full raw row dump."""
    return {
        "name": row.get("name") or "",
        "categories": extract_categories(row)[:5],
        "reason": reason,
    }
