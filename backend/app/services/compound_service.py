"""
Compound Service — Orchestrates multi-intent requests (Image + Structured Text).

Execution order:
1. Generate image from the extracted subject
2. Generate structured text (recipe, tutorial, etc.) via LLM
3. Return combined response

The voice layer gets a short TTS summary; the UI gets the full structured content.
"""

import re
import logging
from typing import List, Optional
from app.services.image_service import generate_image
from app.services.oxlo_client import oxlo, groq
from app.config import MODELS, MAX_TOKENS_COMPOUND, TEMPERATURE_COMPOUND

logger = logging.getLogger("Oxlo VoxVision.ai.compound")

# ── Domain detection keywords ─────────────────────────────────────────────────
_DOMAIN_KEYWORDS = {
    "food": [
        "cake", "pizza", "pasta", "salad", "soup", "bread", "cookie", "pie",
        "burger", "sandwich", "sushi", "curry", "steak", "smoothie", "juice",
        "chocolate", "dessert", "meal", "dish", "recipe", "cook", "bake",
        "food", "drink", "beverage", "cocktail", "coffee", "tea", "ice cream",
        "biryani", "dosa", "noodle", "rice", "taco", "pancake", "waffle",
        "muffin", "brownie", "fries", "chicken", "fish", "vegan",
    ],
    "diy": [
        "build", "construct", "assemble", "craft", "woodwork", "sew",
        "knit", "crochet", "paint", "sculpt", "pottery", "origami",
        "robot", "electronics", "circuit", "arduino", "3d print",
        "furniture", "shelf", "table", "chair", "lamp", "decor",
        "garden", "planter", "terrarium", "candle", "soap",
    ],
    "character": [
        "character", "hero", "villain", "warrior", "wizard", "knight",
        "princess", "dragon", "elf", "dwarf", "alien", "cyborg",
        "superhero", "anime", "manga", "fantasy", "sci-fi", "steampunk",
        "samurai", "ninja", "pirate", "monster", "creature",
    ],
    "design": [
        "logo", "poster", "flyer", "banner", "website", "app", "ui",
        "ux", "layout", "mockup", "wireframe", "typography", "branding",
        "icon", "illustration", "infographic", "card", "invitation",
    ],
}

# ── Domain-specific LLM prompt templates ──────────────────────────────────────
_STRUCTURED_PROMPTS = {
    "food": """You are a professional chef and recipe writer. The user asked about: "{subject}"

Write a complete, well-structured recipe. Use EXACTLY this format with these emoji section headers:

📌 **{subject}**

🧂 **Ingredients**
List every ingredient with exact measurements (grams, cups, ml, tablespoons, etc.). Use bullet points with a dash and em-dash format:
- Ingredient name — exact quantity

👨‍🍳 **Step-by-Step Instructions**
Numbered steps, clear and beginner-friendly. Include timing, temperature, and technique details.
1. Step description
2. Step description
...

💡 **Tips & Variations**
3-5 practical tips, serving suggestions, or creative variations. Use bullet points.

Be specific with measurements. Do NOT skip any section. Do NOT use markdown headers (#). Use the emoji + bold format shown above.""",

    "diy": """You are an expert maker and DIY instructor. The user asked about: "{subject}"

Write a complete, well-structured build guide. Use EXACTLY this format with these emoji section headers:

📌 **{subject}**

🔧 **Materials & Tools**
List every material and tool needed with exact quantities/sizes. Use bullet points:
- Item name — quantity/specification

👨‍🔧 **Step-by-Step Instructions**
Numbered steps, clear and beginner-friendly. Include measurements, timing, and safety notes.
1. Step description
2. Step description
...

💡 **Tips & Variations**
3-5 practical tips, common mistakes to avoid, or creative modifications. Use bullet points.

Be specific with measurements and materials. Do NOT skip any section. Do NOT use markdown headers (#). Use the emoji + bold format shown above.""",

    "character": """You are a creative writer and character designer. The user asked about: "{subject}"

Write a complete character profile. Use EXACTLY this format with these emoji section headers:

📌 **{subject}**

🎭 **Character Profile**
- Full name, age, species/race
- Physical appearance (height, build, distinguishing features)
- Personality traits (3-5 key traits)
- Special abilities or skills

📖 **Backstory**
A compelling 2-3 paragraph origin story. Include motivations and key events that shaped the character.

💡 **Design Notes & Variations**
3-5 creative suggestions for alternate versions, costume variations, or story arcs. Use bullet points.

Be creative and detailed. Do NOT skip any section. Do NOT use markdown headers (#). Use the emoji + bold format shown above.""",

    "general": """You are a knowledgeable, friendly expert. The user asked about: "{subject}"

Write a complete, well-structured explanation. Use EXACTLY this format with these emoji section headers:

📌 **{subject}**

📋 **Overview**
A clear, concise 2-3 sentence description of what this is and why it matters.

📝 **Key Details**
List the main components, features, or important points. Use bullet points:
- Detail — explanation

🔄 **Step-by-Step Guide** (if applicable)
Numbered steps for how to create, use, or understand this:
1. Step description
2. Step description
...

💡 **Tips & Insights**
3-5 practical tips, fun facts, or additional context. Use bullet points.

Be informative and specific. Do NOT skip any section. Do NOT use markdown headers (#). Use the emoji + bold format shown above.""",
}


def _detect_domain(subject: str) -> str:
    """Detect the domain/category from the subject string."""
    subject_lower = subject.lower()
    scores = {}
    for domain, keywords in _DOMAIN_KEYWORDS.items():
        score = sum(1 for kw in keywords if kw in subject_lower)
        if score > 0:
            scores[domain] = score
    if scores:
        return max(scores, key=scores.get)
    return "general"


def _build_voice_summary(subject: str, domain: str) -> str:
    """Build a short TTS-friendly summary (1-2 sentences max)."""
    domain_phrases = {
        "food": f"Here's the image of {subject}. I've added a detailed recipe below with ingredients and step-by-step instructions.",
        "diy": f"Here's the image of {subject}. I've included a complete build guide below with materials and step-by-step instructions.",
        "character": f"Here's the image of {subject}. I've written a detailed character profile and backstory below.",
        "design": f"Here's the image of {subject}. I've added design details and specifications below.",
        "general": f"Here's the image of {subject}. I've included a detailed explanation with all the information below.",
    }
    return domain_phrases.get(domain, domain_phrases["general"])


# Models hosted on Groq (use groq client for these)
GROQ_MODELS = {"llama-3.1-8b-instant", "llama-3.3-70b-versatile", "whisper-large-v3-turbo", "whisper-large-v3"}


async def execute_compound_request(
    prompt: str,
    image_subject: str,
    history: List[dict] | None = None,
    image_model: str | None = None,
    image_size: str | None = None,
) -> dict:
    """
    Execute a compound request: Image generation + Structured text.

    Returns: {
        "image_b64": str,
        "image_model_used": str,
        "structured_text": str,
        "title": str,
        "domain": str,
        "voice_summary": str,
        "revised_prompt": str | None,
    }
    """
    logger.info(f"Compound request: subject='{image_subject}', prompt='{prompt[:80]}'")

    # ── Step 1: Detect domain ─────────────────────────────────────────────
    domain = _detect_domain(image_subject)
    logger.info(f"Detected domain: {domain}")

    # ── Step 2: Generate image ────────────────────────────────────────────
    logger.info("Step 1/2: Generating image...")
    image_result = await generate_image(
        prompt=image_subject,
        model=image_model,
        size=image_size,
    )
    logger.info(f"Image generated: model={image_result['model_used']}")

    # ── Step 3: Generate structured text via LLM ──────────────────────────
    logger.info("Step 2/2: Generating structured text...")
    structured_prompt = _STRUCTURED_PROMPTS.get(domain, _STRUCTURED_PROMPTS["general"])
    structured_prompt = structured_prompt.format(subject=image_subject)

    target_model = MODELS["chat"]
    client = groq if target_model in GROQ_MODELS else oxlo

    try:
        response = await client.chat.completions.create(
            model=target_model,
            messages=[
                {"role": "system", "content": structured_prompt},
                {"role": "user", "content": prompt},
            ],
            max_tokens=MAX_TOKENS_COMPOUND,
            temperature=TEMPERATURE_COMPOUND,
        )
        structured_text = (response.choices[0].message.content or "").strip()
    except Exception as e:
        logger.warning(f"Primary model failed for structured text: {e}")
        # Try fallback models
        structured_text = ""
        for fallback in MODELS.get("chat_fallback", []):
            try:
                fb_client = groq if fallback in GROQ_MODELS else oxlo
                response = await fb_client.chat.completions.create(
                    model=fallback,
                    messages=[
                        {"role": "system", "content": structured_prompt},
                        {"role": "user", "content": prompt},
                    ],
                    max_tokens=MAX_TOKENS_COMPOUND,
                    temperature=TEMPERATURE_COMPOUND,
                )
                structured_text = (response.choices[0].message.content or "").strip()
                if structured_text:
                    break
            except Exception:
                continue
        if not structured_text:
            structured_text = f"📌 **{image_subject}**\n\nI generated the image but couldn't produce the detailed explanation. Please try again."

    # ── Step 4: Build voice summary ───────────────────────────────────────
    voice_summary = _build_voice_summary(image_subject, domain)

    # ── Extract title from structured text ────────────────────────────────
    title = image_subject.title()
    title_match = re.search(r'📌\s*\*\*(.+?)\*\*', structured_text)
    if title_match:
        title = title_match.group(1).strip()

    return {
        "image_b64": image_result["image_b64"],
        "image_model_used": image_result["model_used"],
        "structured_text": structured_text,
        "title": title,
        "domain": domain,
        "voice_summary": voice_summary,
        "revised_prompt": image_result.get("revised_prompt"),
    }
