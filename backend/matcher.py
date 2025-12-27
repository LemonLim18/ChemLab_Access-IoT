from rapidfuzz import fuzz
from item_dictionary import EN_MS_MAP


import re

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
    Expand English query into Malay keywords with strict word boundaries
    """
    query_norm = normalize(query)
    expanded = {query_norm}
    translations = {}

    for eng, malays in EN_MS_MAP.items():
        # \b matches word boundaries to prevent 'apple' matching 'pineapple' or 'kepala'
        if re.search(rf"\b{re.escape(eng)}\b", query_norm):
            expanded.update(malays)
            translations[eng] = malays

    if translations:
        print(f"[Search Expansion] English '{query}' -> Malay Keywords: {translations}")

    return expanded


def match_items(query: str, items: list, threshold: int = 60):
    """
    Match expanded query against item list using fuzzy matching + word boundaries
    """
    expanded_queries = expand_query(query)
    results = []

    for item in items:
        item_norm = normalize(item)
        
        best_score = 0
        for q in expanded_queries:
            # First, check if the keyword exists as a whole word
            # This prevents 'epal' matching 'kepala'
            has_word_match = re.search(rf"\b{re.escape(q)}\b", item_norm)
            
            if has_word_match:
                # If it's a whole word match, we trust the fuzzy score more
                score = fuzz.partial_ratio(q, item_norm)
            else:
                # If it's just a substring but NOT a whole word, penalize heavily
                # or just set to 0 if the query is short
                if len(q) <= 5:
                    score = 0
                else:
                    score = fuzz.partial_ratio(q, item_norm) * 0.4
            
            if score > best_score:
                best_score = score

        if best_score >= threshold:
            results.append((item, best_score))

    return sorted(results, key=lambda x: x[1], reverse=True)
