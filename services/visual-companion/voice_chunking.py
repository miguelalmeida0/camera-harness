import re
from typing import List


URL_PATTERN = re.compile(r"https?://\S+", re.I)
ABBREVIATION_PATTERN = re.compile(
    r"\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc)\.|(?:\b[ei]\.g\.|\bi\.e\.|\b(?:[A-Z]\.){2,})",
    re.I,
)
SENTENCE_PATTERN = re.compile(r".+?(?:[.!?](?=\s|$)|$)", re.S)
CLAUSE_PATTERN = re.compile(r"(?<=[,;:])\s+|\s+(?=[—–-]\s)")


def chunk_spoken_text(
    text: str,
    first_max_words: int = 18,
    later_max_words: int = 28,
    hard_max_chars: int = 240,
    max_chunks: int = 24,
) -> List[str]:
    clean = re.sub(r"\s+", " ", str(text or "")).strip()
    if not clean:
        return []
    protected, values = _protect(clean)
    sentences = [_restore(item.strip(), values) for item in SENTENCE_PATTERN.findall(protected) if item.strip()]
    chunks: List[str] = []
    for sentence in sentences or [clean]:
        limit = first_max_words if not chunks else later_max_words
        chunks.extend(_split_piece(sentence, limit, hard_max_chars))
    chunks = _merge_tiny_chunks(chunks, later_max_words, hard_max_chars)
    if len(chunks) > max_chunks:
        head = chunks[: max_chunks - 1]
        tail = " ".join(chunks[max_chunks - 1 :]).strip()
        chunks = head + _split_piece(tail, later_max_words, hard_max_chars)
    return [chunk for chunk in chunks if chunk]


def _split_piece(piece: str, max_words: int, hard_max_chars: int) -> List[str]:
    if _word_count(piece) <= max_words and len(piece) <= hard_max_chars:
        return [piece.strip()]
    clauses = [part.strip() for part in CLAUSE_PATTERN.split(piece) if part.strip()]
    if len(clauses) == 1:
        return _split_words(piece, max_words, hard_max_chars)
    result: List[str] = []
    current = ""
    for clause in clauses:
        candidate = f"{current} {clause}".strip()
        if current and (_word_count(candidate) > max_words or len(candidate) > hard_max_chars):
            result.extend(_split_words(current, max_words, hard_max_chars))
            current = clause
        else:
            current = candidate
    if current:
        result.extend(_split_words(current, max_words, hard_max_chars))
    return result


def _split_words(piece: str, max_words: int, hard_max_chars: int) -> List[str]:
    words = piece.split()
    result: List[str] = []
    current: List[str] = []
    for word in words:
        candidate = " ".join(current + [word])
        if current and (len(current) >= max_words or len(candidate) > hard_max_chars):
            result.append(" ".join(current))
            current = [word]
        else:
            current.append(word)
    if current:
        result.append(" ".join(current))
    return result


def _merge_tiny_chunks(chunks: List[str], max_words: int, hard_max_chars: int) -> List[str]:
    result: List[str] = []
    index = 0
    while index < len(chunks):
        chunk = chunks[index]
        if _word_count(chunk) < 4 and index + 1 < len(chunks):
            candidate = f"{chunk} {chunks[index + 1]}".strip()
            if _word_count(candidate) <= max_words and len(candidate) <= hard_max_chars:
                chunk = candidate
                index += 1
        if result and _word_count(chunk) < 4:
            candidate = f"{result[-1]} {chunk}".strip()
            if _word_count(candidate) <= max_words and len(candidate) <= hard_max_chars:
                result[-1] = candidate
                index += 1
                continue
        result.append(chunk)
        index += 1
    return result


def _protect(text: str):
    values = []

    def save(match):
        values.append(match.group(0))
        return f"VOICEPROTECTED{len(values) - 1}TOKEN"

    protected = URL_PATTERN.sub(save, text)
    protected = ABBREVIATION_PATTERN.sub(save, protected)
    protected = re.sub(r"\b\d+\.\d+\b", save, protected)
    return protected, values


def _restore(text: str, values: List[str]) -> str:
    for index, value in enumerate(values):
        text = text.replace(f"VOICEPROTECTED{index}TOKEN", value)
    return text


def _word_count(text: str) -> int:
    return len(re.findall(r"\b[\w’'-]+\b", text))
