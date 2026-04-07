import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routes import voice, vision, image, compound, vision_voice

# ── Logging — see actual errors in terminal ───────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(name)s | %(levelname)s | %(message)s",
)

app = FastAPI(
    title="Oxlo VoxVision.ai API",
    description="Multimodal AI: Voice Assistant + Vision Mode powered by Oxlo.ai OSS Models",
    version="1.0.0",
)

# ── CORS — allow React dev server ─────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:5174", "http://127.0.0.1:5174"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(voice.router)
app.include_router(vision.router)
app.include_router(image.router)
app.include_router(compound.router)
app.include_router(vision_voice.router)

# ── Health check ──────────────────────────────────────────────────────────────
@app.get("/api/health", tags=["Health"])
async def health():
    return {"status": "ok", "service": "Oxlo VoxVision.ai API", "version": "1.0.0"}

# ── Root ──────────────────────────────────────────────────────────────────────
@app.get("/", tags=["Root"])
async def root():
    return {
        "message": "Oxlo VoxVision.ai API is running",
        "docs": "/docs",
        "models_used": ["kimi-k2.5", "whisper-large-v3", "kokoro-82m", "yolo-v11", "oxlo-image-pro", "flux.1-schnell"],
    }

# ── Run ───────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
