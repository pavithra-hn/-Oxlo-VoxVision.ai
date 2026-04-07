"""
response_cleaner.py
────────────────────
Post-processing middleware for LLM output.

Cleans the raw model response before it reaches the client:
  • Strips markdown formatting artifacts (**, __, ~~, #, `, etc.)
  • Removes meta/filler phrases ("I understand now…", "Sure!", etc.)
  • Normalizes emoji descriptions to actual Unicode emojis
  • Collapses excessive whitespace while preserving structure
"""

import re
import logging

logger = logging.getLogger("Oxlo VoxVision.ai.cleaner")

# ── Markdown stripping ────────────────────────────────────────────────────────

# Bold/italic: **text**, __text__, *text*, _text_
_BOLD_DOUBLE = re.compile(r'\*\*(.+?)\*\*')
_BOLD_UNDER  = re.compile(r'__(.+?)__')
_ITALIC_STAR = re.compile(r'(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)')
_ITALIC_UNDER = re.compile(r'(?<!_)_(?!_)(.+?)(?<!_)_(?!_)')

# Strikethrough: ~~text~~
_STRIKETHROUGH = re.compile(r'~~(.+?)~~')

# Inline code: `text`
_INLINE_CODE = re.compile(r'`([^`]+?)`')

# Code blocks: ```...```
_CODE_BLOCK = re.compile(r'```[\s\S]*?```', re.MULTILINE)

# Headers: # Title, ## Subtitle, ### etc.
_HEADERS = re.compile(r'^#{1,6}\s+', re.MULTILINE)

# Horizontal rules: --- or *** or ___
_HR = re.compile(r'^[\s]*[-*_]{3,}\s*$', re.MULTILINE)

# Link syntax: [text](url) → text
_LINKS = re.compile(r'\[([^\]]+)\]\([^\)]+\)')

# Image syntax: ![alt](url) → alt
_IMAGES = re.compile(r'!\[([^\]]*)\]\([^\)]+\)')

# Blockquotes: > text → text
_BLOCKQUOTE = re.compile(r'^\s*>\s?', re.MULTILINE)

# Leftover asterisks (orphan markdown)
_ORPHAN_ASTERISKS = re.compile(r'(?<!\w)\*{1,2}(?!\w)')


def strip_markdown(text: str) -> str:
    """Remove all markdown formatting from text, preserving the content."""
    if not text:
        return text

    # Order matters: process complex patterns first
    text = _CODE_BLOCK.sub(lambda m: m.group(0).strip('`').strip(), text)
    text = _IMAGES.sub(r'\1', text)
    text = _LINKS.sub(r'\1', text)

    # Multiple passes for nested bold (e.g., **__text__**)
    for _ in range(2):
        text = _BOLD_DOUBLE.sub(r'\1', text)
        text = _BOLD_UNDER.sub(r'\1', text)

    text = _STRIKETHROUGH.sub(r'\1', text)
    text = _INLINE_CODE.sub(r'\1', text)
    text = _ITALIC_STAR.sub(r'\1', text)
    text = _ITALIC_UNDER.sub(r'\1', text)
    text = _HEADERS.sub('', text)
    text = _HR.sub('', text)
    text = _BLOCKQUOTE.sub('', text)
    text = _ORPHAN_ASTERISKS.sub('', text)

    # Normalize markdown bullet characters (- and *) to clean •
    text = re.sub(r'^\s*[-*]\s+', '• ', text, flags=re.MULTILINE)

    return text


# ── Meta-phrase removal ───────────────────────────────────────────────────────

# Phrases that add no value — the model should respond directly
_META_PHRASES = [
    # Opening fillers
    r"^Sure[,!.]?\s*",
    r"^Of course[,!.]?\s*",
    r"^Absolutely[,!.]?\s*",
    r"^Great question[,!.]?\s*",
    r"^Good question[,!.]?\s*",
    r"^That's a great question[,!.]?\s*",
    r"^That's a good question[,!.]?\s*",
    r"^Certainly[,!.]?\s*",
    r"^I'd be happy to help[,!.]?\s*",
    r"^I'd be glad to help[,!.]?\s*",
    r"^I'd love to help[,!.]?\s*",
    r"^I'd love to help,?\s+but\s*",
    r"^Let me help you with that[,!.]?\s*",
    # Meta-commentary
    r"^I understand (?:now|your|what|that)[^.!?]*[.!?]?\s*",
    r"^I see (?:what|that|you)[^.!?]*[.!?]?\s*",
    r"^You'?re asking (?:about|for|me|if|whether)[^.!?]*[.!?]?\s*",
    r"^You want (?:to know|me to)[^.!?]*[.!?]?\s*",
    r"^So,? (?:basically|essentially|you'?re asking)[^.!?]*[.!?]?\s*",
    r"^To answer your question[,:]?\s*",
    r"^Here's (?:the answer|my answer|what I think)[,:]?\s*",
    r"^(?:Okay|Ok),?\s+(?:so|let me)[,\s]*",
    # AI identity phrases
    r"As an AI(?:\s+(?:language\s+)?model)?[,.]?\s*",
    r"As a language model[,.]?\s*",
    r"As your AI assistant[,.]?\s*",
]

_META_PATTERNS = [re.compile(p, re.IGNORECASE) for p in _META_PHRASES]


def strip_meta_phrases(text: str) -> str:
    """Remove generic filler/meta phrases from the start of responses."""
    if not text:
        return text

    cleaned = text.strip()

    # Apply each pattern — only strip from the beginning of the response
    for pattern in _META_PATTERNS:
        cleaned = pattern.sub('', cleaned, count=1).strip()

    # Re-capitalize first character after stripping
    if cleaned and cleaned[0].islower():
        cleaned = cleaned[0].upper() + cleaned[1:]

    return cleaned


# ── Emoji normalization ───────────────────────────────────────────────────────

_EMOJI_DESCRIPTIONS = {
    r'\(smiley\s*face\)': '😊',
    r'\(happy\s*face\)': '😊',
    r'\(sad\s*face\)': '😢',
    r'\(thumbs?\s*up\)': '👍',
    r'\(thumbs?\s*down\)': '👎',
    r'\(heart\)': '❤️',
    r'\(fire\)': '🔥',
    r'\(star\)': '⭐',
    r'\(check\s*mark\)': '✅',
    r'\(cross\s*mark\)': '❌',
    r'\(wave\)': '👋',
    r'\(clap\)': '👏',
    r'\(thinking\s*face\)': '🤔',
    r'\(laughing\)': '😂',
    r'\(wink\)': '😉',
    r'\(crying\)': '😢',
    r'\(sparkles?\)': '✨',
    r'\(rocket\)': '🚀',
    r'\(light\s*bulb\)': '💡',
    r'\(warning\)': '⚠️',
    r'\(sun\)': '☀️',
    r'\(moon\)': '🌙',
    r'\(party\)': '🎉',
    r'\(eyes\)': '👀',
    r'\(muscle\)': '💪',
    r'\(pray(?:ing)?\s*(?:hands)?\)': '🙏',
    r'\(point(?:ing)?\s*(?:right|up|down)?\)': '👉',
    r'\(ok\s*hand\)': '👌',
}

_EMOJI_PATTERNS = [(re.compile(k, re.IGNORECASE), v) for k, v in _EMOJI_DESCRIPTIONS.items()]


def normalize_emojis(text: str) -> str:
    """Convert text descriptions of emojis to actual Unicode emojis."""
    if not text:
        return text

    for pattern, emoji in _EMOJI_PATTERNS:
        text = pattern.sub(emoji, text)

    return text


# ── Whitespace normalization ──────────────────────────────────────────────────

_MULTI_NEWLINES = re.compile(r'\n{3,}')
_TRAILING_SPACES = re.compile(r'[ \t]+$', re.MULTILINE)


def normalize_whitespace(text: str) -> str:
    """Collapse excessive blank lines and trailing spaces."""
    if not text:
        return text

    text = _TRAILING_SPACES.sub('', text)
    text = _MULTI_NEWLINES.sub('\n\n', text)
    return text.strip()


# ── Parenthetical English translation removal ────────────────────────────────
# Catches patterns like: ನೀರು (water) → ನೀರು
# Only strips when the preceding text contains Indic script characters

_INDIC_RANGE = (
    r'[\u0900-\u097F'   # Devanagari (Hindi, Marathi)
    r'\u0980-\u09FF'    # Bengali
    r'\u0A00-\u0A7F'    # Gurmukhi (Punjabi)
    r'\u0A80-\u0AFF'    # Gujarati
    r'\u0B80-\u0BFF'    # Tamil
    r'\u0C00-\u0C7F'    # Telugu
    r'\u0C80-\u0CFF'    # Kannada
    r'\u0D00-\u0D7F]'   # Malayalam
)

# Matches: <Indic text> (English text) — strips the (English text) part
_PAREN_TRANSLATION = re.compile(
    r'(' + _INDIC_RANGE + r'+[^\(]*)'   # Indic text before parens
    r'\s*\([A-Za-z][A-Za-z\s,.\'-]*\)',  # (English translation)
)

# Also catch English headers followed by Indic content
_ENGLISH_HEADER_BEFORE_INDIC = re.compile(
    r'^(Ingredients|Steps|Instructions|Materials|Overview|Method|Procedure|Note|Tip)[:\s]*$',
    re.MULTILINE | re.IGNORECASE,
)


def strip_parenthetical_translations(text: str) -> str:
    """Remove English translations in parentheses after Indic script text."""
    if not text:
        return text

    # Only apply if text contains Indic characters
    if not re.search(_INDIC_RANGE, text):
        return text

    # Strip (English) after Indic text
    text = _PAREN_TRANSLATION.sub(r'\1', text)

    # Strip standalone English headers
    text = _ENGLISH_HEADER_BEFORE_INDIC.sub('', text)

    return text


# ── Main pipeline ─────────────────────────────────────────────────────────────

def clean_response(text: str) -> str:
    """
    Full response cleaning pipeline.
    Apply this to LLM output before sending to the client.

    Pipeline order:
      1. Strip markdown formatting
      2. Remove meta/filler phrases
      3. Normalize emoji descriptions
      4. Strip parenthetical English translations from Indic text
      5. Clean whitespace
    """
    if not text or not text.strip():
        return text

    cleaned = text
    cleaned = strip_markdown(cleaned)
    cleaned = strip_meta_phrases(cleaned)
    cleaned = normalize_emojis(cleaned)
    cleaned = strip_parenthetical_translations(cleaned)
    cleaned = normalize_whitespace(cleaned)

    if cleaned != text:
        logger.debug(
            f"Response cleaned: {len(text)} → {len(cleaned)} chars "
            f"(removed {len(text) - len(cleaned)} chars)"
        )

    return cleaned
