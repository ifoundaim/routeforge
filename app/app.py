import logging
import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .auth.magic import ensure_magic, is_auth_enabled
from .routes_api import router as api_router
from .routes_attest import router as attest_router
from .routes_redirect import router as redirect_router
from .routes_agent import router as agent_router
from .routes_analytics import router as analytics_router
from .routes_billing import router as billing_router
from .routes_export import router as export_router
from .routes_evidence import router as evidence_router
from .routes_releases import router as releases_router
from .routes_health import router as health_router
from .routes_ip import router as ip_router
from .routes_public import router as public_router
from .routes_uploads import router as uploads_router
from .routes_auth import router as auth_router
from .middleware import RequestContextMiddleware
from .middleware.rate_limit import RateLimitMiddleware
from .errors import install_exception_handlers


load_dotenv()

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("routeforge")

app = FastAPI(title="RouteForge API", version="1.0.0")

# CORS: configure allowed web origins via env (fallback to localhost ports)
raw_origins = os.getenv(
    "CORS_ALLOW_ORIGINS",
    os.getenv("WEB_ORIGIN", "http://localhost:8080,http://localhost:4173") or "",
)
origins = [o.strip() for o in raw_origins.split(",") if o.strip()] or ["*"]
allow_credentials = True if origins and origins != ["*"] else False

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Request context and timing
app.add_middleware(RequestContextMiddleware)
app.add_middleware(RateLimitMiddleware)

# Exception handlers for consistent error shapes
install_exception_handlers(app)

app.include_router(health_router)
app.include_router(api_router)
app.include_router(attest_router)
app.include_router(redirect_router)
app.include_router(agent_router)
app.include_router(analytics_router)
app.include_router(export_router)
app.include_router(evidence_router)
app.include_router(releases_router)
app.include_router(billing_router)
app.include_router(ip_router)
app.include_router(public_router)
app.include_router(uploads_router)

if is_auth_enabled():
    ensure_magic(app)
    app.include_router(auth_router)
