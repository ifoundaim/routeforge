import logging
import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .auth.magic import ensure_magic, is_auth_enabled, router as auth_router
from .routes_api import router as api_router
from .routes_redirect import router as redirect_router
from .routes_agent import router as agent_router
from .routes_analytics import router as analytics_router
from .routes_billing import router as billing_router
from .routes_export import router as export_router
from .routes_health import router as health_router
from .middleware import RequestContextMiddleware
from .errors import install_exception_handlers


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

# Request context and timing
app.add_middleware(RequestContextMiddleware)

# Exception handlers for consistent error shapes
install_exception_handlers(app)

app.include_router(health_router)
app.include_router(api_router)
app.include_router(redirect_router)
app.include_router(agent_router)
app.include_router(analytics_router)
app.include_router(export_router)
app.include_router(billing_router)

if is_auth_enabled():
    ensure_magic(app)
    app.include_router(auth_router)
