from rapidfuzz import fuzz
from item_dictionary import EN_MS_MAP


def normalize(text: str) -> str:
    """Normalize text for better matching"""
    return (
        text.lower()
        .replace("-", " ")
        .replace("/", " ")
        .replace("(", "")
        .replace(")", "")
    )


def expand_query(query: str) -> set:
    """
    Expand English query into Malay keywords
    """
    query = normalize(query)
    expanded = {query}

    for eng, malays in EN_MS_MAP.items():
        if eng in query:
            expanded.update(malays)

    return expanded


def match_items(query: str, items: list, threshold: int = 60):
    """
    Match expanded query against item list using fuzzy matching
    """
    expanded_queries = expand_query(query)
    results = []

    for item in items:
        item_norm = normalize(item)

        score = max(
            fuzz.partial_ratio(q, item_norm)
            for q in expanded_queries
        )

        if score >= threshold:
            results.append((item, score))

    return sorted(results, key=lambda x: x[1], reverse=True)
