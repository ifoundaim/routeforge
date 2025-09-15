import logging
import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routes_api import router as api_router
from .routes_redirect import router as redirect_router
from .routes_agent import router as agent_router


load_dotenv()

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("routeforge")

app = FastAPI(title="RouteForge API", version="0.1.0")

# CORS: allow all for demo
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/healthz")
def healthz():
    return {"ok": True}


app.include_router(api_router)
app.include_router(redirect_router)
app.include_router(agent_router)


