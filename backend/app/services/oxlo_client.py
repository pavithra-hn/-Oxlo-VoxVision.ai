from openai import AsyncOpenAI
from app.config import OXLO_API_KEY, OXLO_BASE_URL, GROQ_API_KEY, GROQ_BASE_URL

# Standard shared client — reused across all requests
oxlo = AsyncOpenAI(
    api_key=OXLO_API_KEY,
    base_url=OXLO_BASE_URL,
)

# Zero-retry Oxlo client — used in vision where we want to fail fast
# The default SDK retries 2x on 429 internally, adding ~1s delay each time
# For vision pipeline we handle retries ourselves via asyncio.wait_for
oxlo_fast = AsyncOpenAI(
    api_key=OXLO_API_KEY,
    base_url=OXLO_BASE_URL,
    max_retries=0,      # no SDK-level retries — we manage this ourselves
)

# Groq client — ultra-fast inference for STT + voice LLM + vision narration fallback
groq = AsyncOpenAI(
    api_key=GROQ_API_KEY,
    base_url=GROQ_BASE_URL,
    max_retries=0,
)
