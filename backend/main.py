import datetime as dt
import json
import logging
import os
import threading
import time
import uuid
from typing import Any, Dict, List, Optional, Tuple

import joblib
import pandas as pd
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator, model_validator

# Paths and settings

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.getenv("MODEL_DIR", os.path.join(BASE_DIR, "models"))
MAX_FORECAST_DAYS = int(os.getenv("MAX_FORECAST_DAYS", "730"))
MODEL_CACHE_TTL_SECONDS = int(os.getenv("MODEL_CACHE_TTL_SECONDS", "0"))
WARMUP_MODEL_KEYS = [
    key.strip().lower()
    for key in os.getenv("MODEL_WARMUP_KEYS", "").split(",")
    if key.strip()
]

DEFAULT_CORS_ORIGINS = [
    "https://farm2market.org",
    "https://www.farm2market.org",
    "https://farm2market.web.app",
]
CORS_ALLOW_ORIGINS = [
    origin.strip()
    for origin in os.getenv("CORS_ALLOW_ORIGINS", "").split(",")
    if origin.strip()
] or DEFAULT_CORS_ORIGINS

# Logging

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger("farm2market.api")
APP_STARTED_AT = time.time()


def log_event(level: str, event: str, **fields: Any) -> None:
    payload = {"event": event, **fields}
    message = json.dumps(payload, default=str)

    if level == "error":
        logger.error(message)
    elif level == "warning":
        logger.warning(message)
    else:
        logger.info(message)


# App

app = FastAPI(title="Veg Price Prediction API", version="3.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOW_ORIGINS,
    allow_methods=["GET"],
    allow_headers=["*"],
)

# In-memory model cache

MODEL_CACHE: Dict[str, Tuple[float, Any]] = {}
MODEL_CACHE_LOCK = threading.Lock()


# Response helpers

def success_response(data: Any, message: Optional[str] = None) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "success": True,
        "data": data,
    }
    if message:
        payload["message"] = message
    return payload


def error_response(
    code: str,
    message: str,
    details: Optional[Any] = None,
) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "success": False,
        "error": {
            "code": code,
            "message": message,
        },
    }
    if details is not None:
        payload["error"]["details"] = details
    return payload


def http_status_to_code(status_code: int) -> str:
    mapping = {
        400: "bad_request",
        404: "not_found",
        422: "validation_error",
        500: "internal_error",
        503: "service_unavailable",
    }
    return mapping.get(status_code, "request_error")


# Input validation

class PredictQuery(BaseModel):
    veg: str = Field(
        ...,
        min_length=2,
        max_length=64,
        pattern=r"^[A-Za-z0-9_()\- ]+$",
    )
    market: str = Field(
        ...,
        min_length=2,
        max_length=64,
        pattern=r"^[A-Za-z0-9_()\- ]+$",
    )
    start: dt.date
    end: dt.date

    @field_validator("veg", "market")
    @classmethod
    def normalize_value(cls, value: str) -> str:
        normalized = value.strip().lower().replace(" ", "_")
        if not normalized:
            raise ValueError("must not be empty")
        return normalized

    @model_validator(mode="after")
    def validate_window(self) -> "PredictQuery":
        if self.end <= self.start:
            raise ValueError("end must be after start")

        horizon = (self.end - self.start).days
        if horizon > MAX_FORECAST_DAYS:
            raise ValueError(
                f"Maximum forecast horizon is {MAX_FORECAST_DAYS} days"
            )

        return self


# Utilities

def get_model_path(veg: str, market: str) -> str:
    filename = f"{veg}_{market}.pkl"
    return os.path.join(MODEL_DIR, filename)


def model_key_to_path(model_key: str) -> str:
    return os.path.join(MODEL_DIR, f"{model_key}.pkl")


def list_model_keys() -> List[str]:
    if not os.path.isdir(MODEL_DIR):
        return []

    return sorted(
        file_name.replace(".pkl", "")
        for file_name in os.listdir(MODEL_DIR)
        if file_name.endswith(".pkl")
    )


def get_last_train_day(model: Any) -> Optional[dt.date]:
    if not hasattr(model, "history") or model.history is None:
        return None

    history = model.history
    if getattr(history, "empty", True):
        return None

    last_train_date = pd.to_datetime(history["ds"], errors="coerce").max()
    if pd.isna(last_train_date):
        return None

    return last_train_date.date()


def get_cache_stats() -> Dict[str, Any]:
    with MODEL_CACHE_LOCK:
        return {
            "entries": len(MODEL_CACHE),
            "ttl_seconds": MODEL_CACHE_TTL_SECONDS,
        }


def load_model(model_path: str):
    if not os.path.exists(model_path):
        raise HTTPException(
            status_code=404,
            detail=f"Model file not found: {os.path.basename(model_path)}",
        )

    now = time.time()

    with MODEL_CACHE_LOCK:
        cached = MODEL_CACHE.get(model_path)
        if cached:
            loaded_at, model = cached
            if MODEL_CACHE_TTL_SECONDS <= 0:
                return model

            if now - loaded_at <= MODEL_CACHE_TTL_SECONDS:
                return model

            MODEL_CACHE.pop(model_path, None)

        try:
            model = joblib.load(model_path)
        except FileNotFoundError:
            raise HTTPException(
                status_code=404,
                detail=(
                    "Model file disappeared while loading: "
                    f"{os.path.basename(model_path)}"
                ),
            )
        except Exception as exc:
            log_event(
                "error",
                "model_load_failed",
                model_path=model_path,
                error=str(exc),
            )
            raise HTTPException(
                status_code=500,
                detail=(
                    "Failed to load model. "
                    f"Check model integrity: {os.path.basename(model_path)}"
                ),
            )

        MODEL_CACHE[model_path] = (now, model)
        return model


def warmup_models() -> None:
    if not WARMUP_MODEL_KEYS:
        log_event("info", "warmup_skipped", reason="no MODEL_WARMUP_KEYS set")
        return

    loaded = 0
    for model_key in WARMUP_MODEL_KEYS:
        model_path = model_key_to_path(model_key)
        if not os.path.exists(model_path):
            log_event("warning", "warmup_model_missing", model_key=model_key)
            continue

        try:
            load_model(model_path)
            loaded += 1
        except HTTPException as exc:
            log_event(
                "warning",
                "warmup_model_failed",
                model_key=model_key,
                status_code=exc.status_code,
                detail=exc.detail,
            )

    log_event("info", "warmup_completed", loaded=loaded, requested=len(WARMUP_MODEL_KEYS))


# Lifecycle and middleware

@app.on_event("startup")
def on_startup() -> None:
    log_event(
        "info",
        "startup",
        model_dir=MODEL_DIR,
        cors_allow_origins=CORS_ALLOW_ORIGINS,
        max_forecast_days=MAX_FORECAST_DAYS,
        cache_ttl_seconds=MODEL_CACHE_TTL_SECONDS,
    )
    warmup_models()


@app.middleware("http")
async def request_logger(request: Request, call_next):
    request_id = uuid.uuid4().hex[:12]
    start_time = time.perf_counter()

    try:
        response = await call_next(request)
    except Exception:
        duration_ms = round((time.perf_counter() - start_time) * 1000, 2)
        logger.exception(
            json.dumps(
                {
                    "event": "request_unhandled_exception",
                    "request_id": request_id,
                    "method": request.method,
                    "path": request.url.path,
                    "duration_ms": duration_ms,
                }
            )
        )
        raise

    duration_ms = round((time.perf_counter() - start_time) * 1000, 2)
    log_event(
        "info",
        "request",
        request_id=request_id,
        method=request.method,
        path=request.url.path,
        status_code=response.status_code,
        duration_ms=duration_ms,
    )
    response.headers["X-Request-ID"] = request_id
    return response


# Exception handlers

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    request: Request, exc: RequestValidationError
):
    details = exc.errors()
    log_event(
        "warning",
        "validation_error",
        path=request.url.path,
        details=details,
    )
    return JSONResponse(
        status_code=422,
        content=error_response(
            code="validation_error",
            message="Invalid request parameters",
            details=details,
        ),
    )


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    message = exc.detail if isinstance(exc.detail, str) else "Request failed"
    log_event(
        "warning" if exc.status_code < 500 else "error",
        "http_exception",
        path=request.url.path,
        status_code=exc.status_code,
        detail=exc.detail,
    )
    return JSONResponse(
        status_code=exc.status_code,
        content=error_response(
            code=http_status_to_code(exc.status_code),
            message=message,
        ),
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception(
        json.dumps(
            {
                "event": "unhandled_exception",
                "path": request.url.path,
                "error": str(exc),
            }
        )
    )
    return JSONResponse(
        status_code=500,
        content=error_response(
            code="internal_error",
            message="Unexpected server error",
        ),
    )


# Routes

@app.get("/")
def root():
    return success_response({"status": "api_running", "version": app.version})


@app.get("/health")
def health():
    return success_response(
        {
            "status": "ok",
            "uptime_seconds": int(time.time() - APP_STARTED_AT),
            "cache": get_cache_stats(),
        }
    )


@app.get("/ready")
def ready():
    if not os.path.isdir(MODEL_DIR):
        raise HTTPException(status_code=503, detail="Model directory not found")

    models = list_model_keys()
    if not models:
        raise HTTPException(status_code=503, detail="No model files found")

    try:
        load_model(model_key_to_path(models[0]))
    except HTTPException as exc:
        raise HTTPException(status_code=503, detail=str(exc.detail))

    return success_response(
        {
            "status": "ready",
            "model_count": len(models),
            "cache": get_cache_stats(),
        }
    )


@app.get("/models")
def list_models():
    models = list_model_keys()
    metadata: Dict[str, Dict[str, str]] = {}

    for model_key in models:
        try:
            model = load_model(model_key_to_path(model_key))
            last_train_day = get_last_train_day(model)
        except HTTPException:
            last_train_day = None

        if last_train_day is not None:
            metadata[model_key] = {"last_train_date": last_train_day.isoformat()}

    return success_response(
        {"count": len(models), "models": models, "metadata": metadata}
    )


@app.get("/predict")
def predict(query: PredictQuery = Depends()):
    model_path = get_model_path(query.veg, query.market)
    model = load_model(model_path)

    if not hasattr(model, "history") or model.history.empty:
        raise HTTPException(status_code=500, detail="Model has no training history")

    last_train_day = get_last_train_day(model)
    if last_train_day is None:
        raise HTTPException(
            status_code=500,
            detail="Model training history is invalid",
        )

    if query.end <= last_train_day:
        raise HTTPException(
            status_code=400,
            detail=(
                "end date must be after last training date "
                f"({last_train_day.isoformat()})"
            ),
        )

    periods = (query.end - last_train_day).days
    if periods > MAX_FORECAST_DAYS:
        raise HTTPException(
            status_code=400,
            detail=f"Maximum forecast horizon is {MAX_FORECAST_DAYS} days",
        )

    try:
        future = model.make_future_dataframe(periods=periods + 1, freq="D")
        forecast = model.predict(future)
    except Exception as exc:
        log_event(
            "error",
            "prediction_failed",
            veg=query.veg,
            market=query.market,
            error=str(exc),
        )
        raise HTTPException(status_code=500, detail="Prediction failed")

    result = forecast[
        (forecast["ds"] >= pd.Timestamp(query.start))
        & (forecast["ds"] <= pd.Timestamp(query.end))
    ][["ds", "yhat", "yhat_lower", "yhat_upper"]].copy()

    if result.empty:
        raise HTTPException(
            status_code=404,
            detail="No predictions available for the requested date range",
        )

    for column in ["yhat", "yhat_lower", "yhat_upper"]:
        result[column] = pd.to_numeric(result[column], errors="coerce")

    result["ds"] = pd.to_datetime(result["ds"], errors="coerce")
    result = result.dropna(subset=["ds", "yhat", "yhat_lower", "yhat_upper"])
    result = result.sort_values("ds")

    if result.empty:
        raise HTTPException(
            status_code=500,
            detail="Prediction output contained no valid numeric values",
        )

    result["ds"] = result["ds"].dt.strftime("%Y-%m-%d")
    result[["yhat", "yhat_lower", "yhat_upper"]] = result[
        ["yhat", "yhat_lower", "yhat_upper"]
    ].round(2)

    payload = {
        "vegetable": query.veg,
        "market": query.market,
        "start": query.start.isoformat(),
        "end": query.end.isoformat(),
        "days": int(len(result)),
        "predictions": result.to_dict(orient="records"),
    }

    log_event(
        "info",
        "prediction_success",
        veg=query.veg,
        market=query.market,
        days=payload["days"],
    )

    return success_response(payload)
