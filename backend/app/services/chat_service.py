"""
chat_service.py  (v3 — Anti-Hallucination Edition)
────────────────────────────────────────────────────
Key improvements over v2:
  • Production-grade anti-hallucination system prompt
  • Self-validation instruction block (model checks own output before sending)
  • Strict domain-grounding for recipe/how-to queries (no random ingredients)
  • temperature=0.2, top_p=0.8 for voice mode → deterministic, factual output
  • Separate token budgets: detail requests get 700+ tokens for Indic
  • Multilingual enforcement unchanged from v2
"""

from typing import AsyncGenerator, List
from openai.types.chat import ChatCompletionMessageParam
from app.services.oxlo_client import oxlo, groq
from app.services.response_cleaner import clean_response
from app.config import (
    MODELS, SUPPORTED_LANGUAGES,
    MAX_TOKENS_CHAT, MAX_TOKENS_VOICE,
    TEMPERATURE, TEMPERATURE_VOICE,
    TOP_P, TOP_P_VOICE,
    MIN_RESPONSE_CHARS_VOICE, MIN_RESPONSE_CHARS_DETAIL, MAX_RETRY_ATTEMPTS,
)
import re
import logging

logger = logging.getLogger("Oxlo VoxVision.ai.chat")

# ─────────────────────────────────────────────────────────────────────────────
# ANTI-HALLUCINATION CORE PROMPT
# Applied to ALL voice responses. Eliminates invented ingredients, random
# facts, and incomplete step sequences.
# ─────────────────────────────────────────────────────────────────────────────

ANTI_HALLUCINATION_BLOCK = """
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🛡️  ACCURACY & ANTI-HALLUCINATION RULES (MANDATORY)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. DO NOT invent or assume information not present in the question.
2. DO NOT add unrelated ingredients, steps, or facts.
3. If you are unsure about any fact, respond: "I'm not sure" — never guess.
4. Stay strictly within the context of what was asked.

🍳 DOMAIN CONTROL — Recipes & Cooking:
   • Only include standard, real-world ingredients for the dish requested.
   • DO NOT add unusual or unrelated items (example: NO butter in regular tea ❌).
   • Follow correct, real-world cooking logic and sequence.
   • Tea contains: water, milk, tea powder/leaves, sugar — NOTHING ELSE unless asked.

🔍 SELF-VALIDATION (run silently before generating your answer):
   Step A: Is every fact in my response verifiably true?
   Step B: Are all listed ingredients actually used in this dish?
   Step C: Are all steps in the correct logical order?
   Step D: Does the response fully satisfy the user's request?
   Step E: Is anything invented or assumed? If yes → remove it.
   → If any check fails: rewrite the answer until all checks pass.

🔁 REGENERATION RULE:
   If your draft answer is too short, incomplete, or factually wrong → discard it and write a better one.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"""

# ─────────────────────────────────────────────────────────────────────────────
# BASE SYSTEM PROMPTS
# ─────────────────────────────────────────────────────────────────────────────

# Dynamic language count from config
_SUPPORTED_LANG_COUNT = len(SUPPORTED_LANGUAGES)
_SUPPORTED_LANG_NAMES = ", ".join(
    info["name"] for info in SUPPORTED_LANGUAGES.values()
)

SYSTEM_PROMPT_VOICE = f"""You're Oxlo VoxVision AI — a smart assistant designed to help with voice, images, and conversations.

CONTEXT: The user is SPEAKING through a microphone. Respond naturally, like a knowledgeable friend talking.

IDENTITY AND SELF-KNOWLEDGE:
- Your name is Oxlo VoxVision AI.
- You support {_SUPPORTED_LANG_COUNT} languages: {_SUPPORTED_LANG_NAMES}.
- Your key strengths compared to other models:
  • Combined voice + vision + image generation in one assistant
  • Strong multilingual handling across {_SUPPORTED_LANG_COUNT} languages
  • Natural conversational style (not robotic)
  • Real-time voice interaction with context awareness
- When asked about capabilities, be accurate. Never guess or hardcode numbers.
- Only list all languages if the user specifically asks. Otherwise say "multiple languages including English, Hindi, and more."

RESPONSE STRUCTURE (CRITICAL):
- NEVER dump everything into one big paragraph. Always break responses into scannable sections.
- Use short intro line, then organized sections with headers (plain text, no markdown).
- Use bullet points (•) for listing items.
- Use numbered steps (1. 2. 3.) for procedures or sequences.
- Put each item on its own line.
- Separate sections with a blank line.
- Example structure:
  I'm Oxlo VoxVision AI — your smart voice and image assistant.

  Here's what I can do:
  • Answer questions in {_SUPPORTED_LANG_COUNT} languages
  • Generate images from descriptions
  • Help with tasks and explanations

MULTI-PART QUESTIONS (CRITICAL):
- If the user asks multiple things in one message, address EVERY part.
- If they ask "who are you, what can you do, and how are you different" — answer all three clearly, in separate sections.
- Never skip or partially answer.

STEP-BY-STEP RULE:
- If the user explicitly says "step by step", "step-by-step", "explain in steps", or "detailed explanation" — you MUST respond with numbered steps.
- Structure: brief intro, then numbered steps, each on its own line.

RESPONSE LENGTH:
- Be concise by default. Get to the point quickly.
- Only give long, detailed responses when the user explicitly asks for detail, explanation, or steps.
- For simple questions, keep answers short and direct.

PRECISION (CRITICAL):
- Answer the EXACT question the user asked. Don't over-explain or add unnecessary context.
- If the user asks "what does X mean in French?" → give the direct French equivalent first, then brief context if needed.
- When bridging between languages or cultures, always provide the closest equivalent words/translations.
- Lead with the answer. Add context AFTER, not before.
- Bad: "X is not originally a French word. It comes from Sanskrit and means..." (buries the answer)
- Good: "X means pure or sacred. It's a Sanskrit name — the closest French words would be pur or sacré." (answer first)

FORMATTING (STRICTLY ENFORCED):
- NEVER use markdown: no ** for bold, no # for headers, no ` for code, no __ or ~~ or []().
- Plain text only. Use bullet points (•) and numbered lists.

TONE (STRICTLY ENFORCED):
- Use contractions naturally (I'm, you're, it's, don't) — sound human, not robotic.
- NEVER start with filler: "Sure!", "Of course!", "Great question!", "Absolutely!", "Certainly!", "I'd love to help", "I'd be happy to", "I understand now", "You're asking about".
- NEVER explain what you're about to do. Just do it.
- NEVER include meta-commentary about the question.
- Match the user's energy: casual question → friendly answer, technical question → precise answer.
- End with a brief engaging follow-up when natural (e.g., "Want me to show an example?" or "Need more detail on any of these?"). Keep it to one short line, not every response.

EMOJI RULE:
- You may use actual emoji characters naturally (e.g., 😊 🔥 ✅ 🚀).
- NEVER describe emojis in words. Never write "(smiley face)" or "(thumbs up)" — use the actual character or don't use any."""

SYSTEM_PROMPT_TEXT = f"""You're Oxlo VoxVision AI — a smart assistant designed to help with voice, images, and conversations.

IDENTITY AND SELF-KNOWLEDGE:
- Your name is Oxlo VoxVision AI.
- You support {_SUPPORTED_LANG_COUNT} languages: {_SUPPORTED_LANG_NAMES}.
- Your key strengths compared to other models:
  • Combined voice + vision + image generation in one assistant
  • Strong multilingual handling across {_SUPPORTED_LANG_COUNT} languages
  • Natural conversational style (not robotic)
  • Real-time voice interaction with context awareness
- When asked about capabilities, be accurate. Never guess or hardcode numbers.
- Only list all languages if the user specifically asks. Otherwise say "multiple languages including English, Hindi, and more."

RESPONSE STRUCTURE (CRITICAL):
- NEVER dump everything into one big paragraph. Always break responses into scannable sections.
- Use short intro line, then organized sections.
- Use bullet points (•) for listing items.
- Use numbered steps (1. 2. 3.) for procedures or sequences.
- Put each item on its own line.
- Separate sections with a blank line.

MULTI-PART QUESTIONS (CRITICAL):
- If the user asks multiple things in one message, address EVERY part.
- Never skip or partially answer. Cover all aspects they mentioned.

STEP-BY-STEP RULE:
- If the user explicitly says "step by step", "step-by-step", "explain in steps", or "detailed explanation" — you MUST respond with numbered steps.

RESPONSE LENGTH:
- Be concise by default. Get to the point quickly.
- Only give long, detailed responses when the user explicitly asks for detail, explanation, or steps.

PRECISION (CRITICAL):
- Answer the EXACT question the user asked. Don't over-explain or add unnecessary context.
- When bridging between languages or cultures, always provide the closest equivalent words/translations.
- Lead with the answer. Add context AFTER, not before.

FORMATTING (STRICTLY ENFORCED):
- NEVER use markdown: no ** for bold, no # for headers, no ` for code, no __ or ~~ or []().
- Plain text only. Use bullet points (•) and numbered lists.

TONE (STRICTLY ENFORCED):
- Use contractions naturally (I'm, you're, it's, don't) — sound human, not robotic.
- NEVER start with filler: "Sure!", "Of course!", "Great question!", "Absolutely!", "Certainly!", "I'd love to help", "I'd be happy to", "I understand now", "You're asking about".
- NEVER explain what you're about to do. Just do it.
- NEVER include meta-commentary about the question.
- Match the user's energy: casual question → friendly answer, technical question → precise answer.
- End with a brief engaging follow-up when natural (e.g., "Want me to show an example?"). Keep it to one short line.

EMOJI RULE:
- You may use actual emoji characters naturally (e.g., 😊 🔥 ✅ 🚀).
- NEVER describe emojis in words. Never write "(smiley face)" or "(thumbs up)" — use the actual character or don't use any."""

# ── GREETING INSTRUCTION (injected when history is empty) ─────────────────────
GREETING_INSTRUCTION = """
This is the VERY FIRST message from the user in this session.
Start your response with a brief, warm greeting: "Hey! I'm Oxlo VoxVision AI. "
Then directly answer their question or respond naturally.
Do NOT repeat the greeting on subsequent messages."""

INTENT_INSTRUCTIONS = {
    "question":       "\nAnswer clearly and directly. Be accurate and complete. Address all parts of the question.",
    "command":        "\nAcknowledge and respond helpfully. Be accurate.",
    "conversational": "\nBe warm, engaging, and natural.",
}

# ─────────────────────────────────────────────────────────────────────────────
# STRUCTURED OUTPUT FORMAT (for how-to / recipe / step questions)
# ─────────────────────────────────────────────────────────────────────────────

def _structured_format_block(lang_code: str, lang_name: str) -> str:
    """
    Returns the mandatory structured output format instruction,
    with step labels in the user's language.
    """
    # Step word in native language
    STEP_WORDS = {
        "kn": "ಹಂತ",
        "ta": "படி",
        "te": "దశ",
        "hi": "चरण",
        "en": "Step",
    }
    INGREDIENT_WORDS = {
        "kn": "ಪದಾರ್ಥಗಳು",
        "ta": "பொருட்கள்",
        "te": "పదార్థాలు",
        "hi": "सामग्री",
        "en": "Ingredients",
    }
    step_word  = STEP_WORDS.get(lang_code, "Step")
    ingr_word  = INGREDIENT_WORDS.get(lang_code, "Ingredients")

    return (
        f"\n\n📋 MANDATORY RESPONSE FORMAT for how-to / recipe questions:\n"
        f"\n"
        f"{ingr_word}:\n"
        f"  • [ingredient 1]\n"
        f"  • [ingredient 2]\n"
        f"  • ...\n"
        f"\n"
        f"{step_word} 1: [first action]\n"
        f"{step_word} 2: [second action]\n"
        f"{step_word} 3: [third action]\n"
        f"... (minimum 5 {'steps' if lang_code == 'en' else step_word + 's'})\n"
        f"\n"
        f"REQUIREMENTS:\n"
        f"  • Minimum 5 steps — more if needed for complete coverage\n"
        f"  • Every step must be clear, specific, and in the correct order\n"
        f"  • Include ALL necessary steps — do NOT skip or abbreviate\n"
        f"  • Write entirely in {lang_name} (native script)\n"
    )


# ─────────────────────────────────────────────────────────────────────────────
# MULTILINGUAL ENFORCEMENT
# ─────────────────────────────────────────────────────────────────────────────

_SCRIPT_EXAMPLES = {
    "kn": "ಚಹಾ ಮಾಡಲು ಮೊದಲು ನೀರನ್ನು ಕಾಯಿಸಿ.",
    "ta": "தேநீர் தயாரிக்க முதலில் தண்ணீரை கொதிக்க வையுங்கள்.",
    "te": "టీ చేయడానికి ముందుగా నీళ్ళు పెట్టండి.",
    "hi": "चाय बनाने के लिए पहले पानी उबालें।",
}

INDIC_VOICE_MIN_TOKENS = 1200  # enough for ingredients + 7 detailed Kannada/Tamil steps


def _max_tokens(mode: str, language: str, wants_detail: bool) -> int:
    """Calculate max tokens — detail requests ALWAYS get the full budget."""
    if wants_detail:
        # Full budget for any language when detail is requested
        return max(INDIC_VOICE_MIN_TOKENS, MAX_TOKENS_VOICE)
    if mode == "voice":
        return MAX_TOKENS_VOICE
    return MAX_TOKENS_CHAT


def _wants_detail(text: str) -> bool:
    """Detect user's intent for a detailed / step-by-step response."""
    SIGNALS = [
        # English
        "detail", "in detail", "step", "steps", "explain", "how to",
        "procedure", "thoroughly", "recipe",
        # Kannada
        "ವಿವರ", "ವಿವರವಾಗಿ", "ಹಂತ", "ಹೇಗೆ", "ರೆಸಿಪಿ",
        # Tamil
        "விவரம்", "படிப்படியாக", "எப்படி", "செய்முறை",
        # Telugu
        "వివరంగా", "దశలవారీగా", "ఎలా", "వంటకం",
        # Hindi
        "विस्तार", "विस्तार से", "चरण", "कैसे", "रेसिपी",
    ]
    lower = text.lower()
    return any(s.lower() in lower for s in SIGNALS)


def _build_multilingual_instruction(
    lang_code: str,
    lang_name: str,
    wants_detail: bool,
) -> str:
    """Full multilingual + structure enforcement block."""
    if lang_code == "en":
        if wants_detail:
            return _structured_format_block("en", "English")
        return ""

    from app.config import SUPPORTED_LANGUAGES
    lang_info   = SUPPORTED_LANGUAGES.get(lang_code, {})
    script_name = lang_info.get("script", lang_name)
    example     = _SCRIPT_EXAMPLES.get(lang_code, "")

    base = (
        f"\n\n🔴 ABSOLUTE LANGUAGE RULE — READ CAREFULLY:\n"
        f"The user has requested a response in {lang_name}.\n"
        f"\n"
        f"YOU MUST:\n"
        f"  ✓ Respond EXCLUSIVELY in {lang_name} ({script_name} script)\n"
        f"  ✓ Use correct {lang_name} grammar and vocabulary\n"
        f"  ✓ Sound like a native {lang_name} speaker\n"
        f"  ✓ Write EVERYTHING in {script_name} script — including ingredient names, labels, and descriptions\n"
        f"{('  ✓ Example of correct script: ' + example) if example else ''}\n"
        f"\n"
        f"YOU MUST NOT:\n"
        f"  ✗ Use any English words (unless a proper noun with no {lang_name} equivalent)\n"
        f"  ✗ Use Romanized/transliterated text (e.g. 'namaskara' in Latin letters)\n"
        f"  ✗ Mix English and {lang_name} in the same response\n"
        f"  ✗ Add English subtitles, translations, or explanations\n"
        f"  ✗ Put English in parentheses after {lang_name} text — this is STRICTLY FORBIDDEN\n"
        f"\n"
        f"EXAMPLES OF WHAT IS WRONG vs RIGHT:\n"
        f"  ❌ WRONG: ನೀರು (water) — DO NOT add English in parentheses\n"
        f"  ✅ RIGHT: ನೀರು\n"
        f"  ❌ WRONG: ಹಾಲು ಹಾಕಿ (Add milk) — DO NOT translate after {lang_name}\n"
        f"  ✅ RIGHT: ಹಾಲು ಹಾಕಿ\n"
        f"  ❌ WRONG: Ingredients: • ನೀರು — DO NOT use English headers\n"
        f"  ✅ RIGHT: ಪದಾರ್ಥಗಳು: • ನೀರು\n"
    )

    if wants_detail:
        base += _structured_format_block(lang_code, lang_name)

    return base


# ─────────────────────────────────────────────────────────────────────────────
# PROMPT BUILDERS
# ─────────────────────────────────────────────────────────────────────────────

def _build_system_prompt(
    intent: str = "conversational",
    mode: str = "text",
    target_language: str = "en",
    language_name: str = "English",
    native_script_instruction: str = "",
    user_text: str = "",
    is_first_message: bool = False,
) -> str:
    base   = SYSTEM_PROMPT_VOICE if mode == "voice" else SYSTEM_PROMPT_TEXT
    prompt = base + INTENT_INSTRUCTIONS.get(intent, INTENT_INSTRUCTIONS["conversational"])

    # Inject anti-hallucination block for ALL modes (voice AND text)
    prompt = prompt + ANTI_HALLUCINATION_BLOCK

    # Inject greeting instruction for first message of session
    if is_first_message:
        prompt = prompt + GREETING_INSTRUCTION

    # Detect detail intent
    detail = _wants_detail(user_text or "") or _wants_detail(native_script_instruction)

    # Multilingual + structure enforcement
    lang_instruction = _build_multilingual_instruction(target_language, language_name, detail)
    if lang_instruction:
        prompt = prompt + lang_instruction
    elif native_script_instruction:
        prompt = prompt + native_script_instruction

    return prompt


def _build_messages(
    user_message: str,
    history: List[dict],
    intent: str = "conversational",
    cleaned_input: str | None = None,
    mode: str = "text",
    target_language: str = "en",
    language_name: str = "English",
    native_script_instruction: str = "",
) -> List[ChatCompletionMessageParam]:
    final_input = cleaned_input or user_message

    # Detect first message (no prior history)
    is_first_message = len(history) == 0

    messages: List[ChatCompletionMessageParam] = [
        {
            "role": "system",
            "content": _build_system_prompt(
                intent, mode, target_language, language_name,
                native_script_instruction, final_input,
                is_first_message=is_first_message,
            ),
        },
    ]

    recent_history = history[-10:] if len(history) > 10 else history
    for m in recent_history:
        messages.append({"role": m["role"], "content": m["content"]})

    messages.append({"role": "user", "content": final_input})
    return messages


# ─────────────────────────────────────────────────────────────────────────────
# MODEL ROUTING
# ─────────────────────────────────────────────────────────────────────────────

GROQ_MODELS = {
    "llama-3.1-8b-instant", "llama-3.3-70b-versatile",
    "whisper-large-v3-turbo", "whisper-large-v3",
}

# ───────────────────────────────────────────────────────────────────────────────
# POST-GENERATION VALIDATION
# Runs after every chat_full() call to catch short, off-topic, or suspicious output.
# ───────────────────────────────────────────────────────────────────────────────

# Phrases the model sometimes produces when confused or under-prompted
_REFUSAL_PHRASES = [
    "i cannot", "i'm unable", "as an ai", "i don't know", "i am not sure",
    "i cannot provide", "not able to answer", "cannot assist",
]
# Filler-only responses that contain no real content
_FILLER_ONLY_RE = __import__('re').compile(
    r'^[\s\.,!?\u0964\u0965\u200b\u200c\u200d\ufeff]+$'
)


def _validate_response(
    text: str,
    mode: str,
    wants_detail: bool,
    target_language: str,
) -> tuple[bool, str]:
    """
    Post-generation quality gate.

    Returns (is_ok, reason).
    Callers should regenerate when is_ok is False.

    Checks:
      1. Not empty / pure whitespace
      2. Meets minimum length for this mode + detail level
      3. Doesn't start with a known refusal phrase
      4. Not filler-only punctuation noise
      5. If Indic language requested: at least some Indic characters present
    """
    stripped = text.strip() if text else ""

    # 1. Empty
    if not stripped:
        return False, "empty_response"

    # 2. Too short
    min_chars = (
        MIN_RESPONSE_CHARS_DETAIL if wants_detail
        else MIN_RESPONSE_CHARS_VOICE
    )
    if len(stripped) < min_chars:
        return False, f"too_short ({len(stripped)} < {min_chars} chars)"

    # 3. Refusal / confusion phrases
    lower = stripped[:120].lower()
    for phrase in _REFUSAL_PHRASES:
        if phrase in lower:
            return False, f"refusal_phrase: '{phrase}'"

    # 4. Filler-only noise
    if _FILLER_ONLY_RE.match(stripped):
        return False, "filler_noise"

    # 5. Indic language check — if Indic requested, response must contain Indic chars
    INDIC_LANGS = {"kn", "ta", "te", "hi", "ml", "bn", "mr"}
    if target_language in INDIC_LANGS:
        import re
        indic_script_re = re.compile(
            r'[\u0900-\u097F\u0C80-\u0CFF\u0B80-\u0BFF\u0C00-\u0C7F\u0980-\u09FF]'
        )
        indic_chars = len(indic_script_re.findall(stripped))
        total_chars  = len(stripped.replace(' ', ''))
        if total_chars > 0 and (indic_chars / total_chars) < 0.25:
            return False, (
                f"wrong_language (Indic chars {indic_chars}/{total_chars} = "
                f"{indic_chars/total_chars:.0%} < 25%)"
            )

    # 6. Structural completeness — if detail was requested, reject partial structures
    #    e.g. "Ingredients:" alone without steps is clearly truncated output
    if wants_detail:
        lower_text = stripped.lower()
        has_header = any(h in lower_text for h in [
            "ingredients", "ಪದಾರ್ಥಗಳು", "பொருட்கள்", "పదార్థాలు", "सामग्री",
            "materials", "overview", "step",
        ])
        has_steps = any(s in lower_text for s in [
            "step 1", "step 2", "1.", "2.", "3.",
            "ಹಂತ 1", "ಹಂತ 2", "படி 1", "படி 2",
            "దశ 1", "దశ 2", "चरण 1", "चरण 2",
        ])
        # If it has a section header but NO steps at all → truncated
        if has_header and not has_steps:
            return False, (
                f"incomplete_structure (has header but no steps — likely truncated)"
            )

    return True, "ok"


# ── Markdown contamination patterns (post-validation check) ──────────────────
_MARKDOWN_CONTAMINATION = re.compile(
    r'\*\*[^*]+\*\*'    # **bold**
    r'|__[^_]+__'        # __bold__
    r'|```'              # code blocks
    r'|^#{1,6}\s',       # markdown headers
    re.MULTILINE
)

_EMOJI_DESCRIPTION_RE = re.compile(
    r'\((smiley|happy|sad|thumbs?\s*up|thumbs?\s*down|heart|fire|star|check|'
    r'cross|wave|clap|thinking|laughing|wink|crying|sparkle|rocket|'
    r'light\s*bulb|warning|sun|moon|party|eyes|muscle|pray|point)'
    r'(?:\s*(?:face|hand|mark|ing))?\)',
    re.IGNORECASE
)


def _post_clean_validate(text: str) -> tuple[str, bool]:
    """
    Post-cleaning validation: catches markdown and emoji descriptions
    that slipped through the model despite prompt instructions.
    Returns (cleaned_text, had_issues).
    """
    had_issues = False

    # Strip markdown contamination
    if _MARKDOWN_CONTAMINATION.search(text):
        from app.services.response_cleaner import strip_markdown
        text = strip_markdown(text)
        had_issues = True
        logger.warning("Post-validation: stripped markdown contamination")

    # Strip emoji descriptions
    if _EMOJI_DESCRIPTION_RE.search(text):
        from app.services.response_cleaner import normalize_emojis
        text = normalize_emojis(text)
        had_issues = True
        logger.warning("Post-validation: fixed emoji descriptions")

    return text, had_issues

# ─────────────────────────────────────────────────────────────────────────────
# PUBLIC API
# ─────────────────────────────────────────────────────────────────────────────

async def chat_stream(
    user_message: str,
    history: List[dict],
    model: str | None = None,
    intent: str = "conversational",
    cleaned_input: str | None = None,
    mode: str = "text",
    target_language: str = "en",
    language_name: str = "English",
    native_script_instruction: str = "",
    _temp_override: float | None = None,   # only used by retry logic in chat_full
) -> AsyncGenerator[str, None]:
    """
    Stream LLM response with anti-hallucination enforcement.
    Voice mode uses temperature=0.2, top_p=0.8 for maximum factual accuracy.
    """
    target_model = model or MODELS["chat"]
    messages = _build_messages(
        user_message, history, intent, cleaned_input, mode,
        target_language, language_name, native_script_instruction,
    )

    client      = groq if target_model in GROQ_MODELS else oxlo
    final_input = cleaned_input or user_message
    detail      = _wants_detail(final_input)
    max_tokens  = _max_tokens(mode, target_language, detail)

    # Anti-hallucination sampling
    if _temp_override is not None:
        temp  = _temp_override
        top_p = TOP_P_VOICE if mode == "voice" else TOP_P
    elif mode == "voice":
        temp  = TEMPERATURE_VOICE   # 0.20 — deterministic, factual
        top_p = TOP_P_VOICE         # 0.80 — focused probability mass
    else:
        temp  = TEMPERATURE         # 0.35 — low enough to stay factual
        top_p = TOP_P               # 0.85 — tighter nucleus

    logger.info(
        f"Chat stream: model={target_model} lang={target_language}({language_name}) "
        f"mode={mode} intent={intent} detail={detail} "
        f"tokens={max_tokens} temp={temp} top_p={top_p}"
        + (" [RETRY]" if _temp_override is not None else "")
    )

    try:
        stream = await client.chat.completions.create(
            model=target_model,
            messages=messages,
            max_tokens=max_tokens,
            temperature=temp,
            top_p=top_p,
            stream=True,
        )
        async for chunk in stream:
            delta = chunk.choices[0].delta.content
            if delta:
                yield delta

    except Exception as e:
        logger.warning(f"Primary model failed ({target_model}): {e}")
        for fallback in MODELS["chat_fallback"]:
            if fallback != target_model:
                try:
                    async for token in chat_stream(
                        user_message, history, fallback, intent, cleaned_input, mode,
                        target_language, language_name, native_script_instruction,
                    ):
                        yield token
                    return
                except Exception:
                    continue
        raise e


async def chat_full(
    user_message: str,
    history: List[dict],
    model: str | None = None,
    intent: str = "conversational",
    cleaned_input: str | None = None,
    mode: str = "text",
    target_language: str = "en",
    language_name: str = "English",
    native_script_instruction: str = "",
) -> str:
    """
    Non-streaming version with post-generation validation + auto-retry.

    If the first response fails the quality gate (too short, wrong language,
    refusal phrase, etc.) it automatically regenerates once at a slightly
    higher temperature to encourage a fuller answer.
    """
    final_input = cleaned_input or user_message
    detail      = _wants_detail(final_input)

    for attempt in range(MAX_RETRY_ATTEMPTS + 1):  # 0 = first try, 1 = retry
        # On retry: nudge temperature up slightly so the model doesn't
        # produce the exact same bad output, but keep it deterministic.
        retry_temp_bump = 0.10 * attempt

        chunks: list[str] = []
        async for token in chat_stream(
            user_message, history, model, intent, cleaned_input, mode,
            target_language, language_name, native_script_instruction,
            _temp_override=(None if attempt == 0
                            else min(0.60, TEMPERATURE_VOICE + retry_temp_bump)),
        ):
            chunks.append(token)
        response = "".join(chunks)

        ok, reason = _validate_response(response, mode, detail, target_language)
        if ok:
            if attempt > 0:
                logger.info(f"Response accepted on retry {attempt}: '{response[:60]}'")
            # Clean response + post-validate for markdown/emoji contamination
            cleaned = clean_response(response)
            cleaned, _ = _post_clean_validate(cleaned)
            return cleaned

        logger.warning(
            f"Response failed validation (attempt {attempt}): {reason}. "
            f"{'Retrying...' if attempt < MAX_RETRY_ATTEMPTS else 'Returning anyway.'}"
        )

    # All retries exhausted — clean whatever we have (is better than silence)
    cleaned = clean_response(response)
    cleaned, _ = _post_clean_validate(cleaned)
    return cleaned
