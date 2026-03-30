import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
} from "chart.js";
import { Line } from "react-chartjs-2";
import {
  fetchModels,
  fetchPrediction,
  toUserMessage,
} from "../../js/api";
import { useRuntimeConfig } from "../../state/runtimeConfigStore";

import "../../styles/pages/prediction-dashboard.css";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend
);

const STATUS_MESSAGES = [
  "Connecting to prediction service",
  "Loading model",
  "Generating forecast",
  "Preparing chart",
];

const LOADER_MIN = 1200;
const LOADER_MAX_EXTRA = 600;
const MAX_MODEL_RETRIES = 3;
const MAX_FORECAST_DAYS = 730;

const todayISO = () => new Date().toISOString().slice(0, 10);
const addDaysISO = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
};

const retryDelay = (attempt) =>
  new Promise((resolve) => setTimeout(resolve, 600 * attempt));

const normalizeQueryValue = (value) =>
  (value || "")
    .toLowerCase()
    .replace(/[()]/g, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

const parseModelKey = (modelKey) => {
  if (typeof modelKey !== "string") return null;

  const parts = modelKey.split("_").filter(Boolean);
  if (parts.length < 2) return null;

  const market = parts.pop();
  const veg = parts.join("_");

  if (!veg || !market) return null;
  return { veg, market, key: modelKey };
};

const normalizeNumber = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Number(numeric.toFixed(2)));
};

const normalizePrediction = (point) => {
  const rawDate = point?.ds;
  const parsedDate = rawDate ? new Date(rawDate) : null;
  if (!parsedDate || Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  const yhat = normalizeNumber(point?.yhat);
  const yhatLowerRaw = normalizeNumber(point?.yhat_lower);
  const yhatUpperRaw = normalizeNumber(point?.yhat_upper);

  if (yhat === null || yhatLowerRaw === null || yhatUpperRaw === null) {
    return null;
  }

  const yhatLower = Math.min(yhat, yhatLowerRaw, yhatUpperRaw);
  const yhatUpper = Math.max(yhat, yhatLowerRaw, yhatUpperRaw);

  return {
    ds: parsedDate.toISOString().slice(0, 10),
    label: parsedDate.toLocaleDateString(),
    timestamp: parsedDate.getTime(),
    yhat,
    yhat_lower: yhatLower,
    yhat_upper: yhatUpper,
  };
};

const validateForecastInput = ({ veg, market, startDate, endDate }) => {
  if (!veg || !market) {
    return "Select a vegetable and market first.";
  }

  if (!startDate || !endDate) {
    return "Select both start and end dates.";
  }

  const start = new Date(startDate);
  const end = new Date(endDate);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return "Enter valid dates in YYYY-MM-DD format.";
  }

  if (end <= start) {
    return "End date must be after start date.";
  }

  const days = Math.round((end.getTime() - start.getTime()) / 86400000);
  if (days > MAX_FORECAST_DAYS) {
    return `Forecast range must be ${MAX_FORECAST_DAYS} days or less.`;
  }

  return "";
};

export default function PredictionDashboard() {
  const { features } = useRuntimeConfig();
  const [searchParams] = useSearchParams();

  const requestAbortRef = useRef(null);
  const statusTimerRef = useRef(null);
  const finishTimerRef = useRef(null);

  const [models, setModels] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState("");

  const [veg, setVeg] = useState(normalizeQueryValue(searchParams.get("veg")));
  const [market, setMarket] = useState(
    normalizeQueryValue(searchParams.get("market"))
  );
  const [forecast, setForecast] = useState(null);

  const [startDate, setStartDate] = useState(todayISO());
  const [endDate, setEndDate] = useState(addDaysISO(30));

  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const parsedModels = useMemo(
    () => models.map(parseModelKey).filter(Boolean),
    [models]
  );

  const vegetables = useMemo(
    () => [...new Set(parsedModels.map((entry) => entry.veg))],
    [parsedModels]
  );

  const markets = useMemo(() => {
    const source = veg
      ? parsedModels.filter((entry) => entry.veg === veg)
      : parsedModels;

    return [...new Set(source.map((entry) => entry.market))];
  }, [parsedModels, veg]);

  useEffect(() => {
    if (market && markets.length > 0 && !markets.includes(market)) {
      setMarket("");
    }
  }, [market, markets]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    if (!features.predictionsEnabled) {
      setModels([]);
      setModelsLoading(false);
      setModelsError("");
      return () => {
        cancelled = true;
        controller.abort();
      };
    }

    const loadModelList = async () => {
      setModelsLoading(true);
      setModelsError("");

      for (let attempt = 1; attempt <= MAX_MODEL_RETRIES; attempt += 1) {
        try {
          const data = await fetchModels({
            signal: controller.signal,
            timeoutMs: 10000,
          });

          if (cancelled) return;

          const modelList = Array.isArray(data.models) ? data.models : [];
          setModels(modelList);

          if (modelList.length === 0) {
            setModelsError("Prediction API is online, but no models were found.");
          } else {
            setModelsError("");
          }

          return;
        } catch (requestError) {
          if (cancelled || controller.signal.aborted) {
            return;
          }

          if (attempt === MAX_MODEL_RETRIES) {
            setModelsError(
              toUserMessage(
                requestError,
                "Price prediction service is currently unavailable."
              )
            );
          } else {
            await retryDelay(attempt);
          }
        }
      }
    };

    loadModelList().finally(() => {
      if (!cancelled) {
        setModelsLoading(false);
      }
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [features.predictionsEnabled]);

  useEffect(
    () => () => {
      requestAbortRef.current?.abort();
      clearInterval(statusTimerRef.current);
      clearTimeout(finishTimerRef.current);
    },
    []
  );

  if (!features.predictionsEnabled) {
    return (
      <div className="dashboard-container prediction-dashboard">
        <p>Predictions are currently disabled by the admin.</p>
      </div>
    );
  }

  const runPrediction = async () => {
    if (loading || modelsLoading) return;

    const formError = validateForecastInput({ veg, market, startDate, endDate });
    if (formError) {
      setError(formError);
      return;
    }

    requestAbortRef.current?.abort();
    clearInterval(statusTimerRef.current);
    clearTimeout(finishTimerRef.current);

    const controller = new AbortController();
    requestAbortRef.current = controller;

    setForecast(null);
    setError("");
    setLoading(true);
    setProgress(8);
    setStatus(STATUS_MESSAGES[0]);

    const startedAt = Date.now();
    const totalDuration = LOADER_MIN + Math.random() * LOADER_MAX_EXTRA;

    let step = 0;
    statusTimerRef.current = setInterval(() => {
      step = Math.min(step + 1, STATUS_MESSAGES.length - 1);
      setStatus(STATUS_MESSAGES[step]);
      setProgress((value) => Math.min(value + 18, 92));
    }, 500);

    try {
      const response = await fetchPrediction(
        {
          veg,
          market,
          start: startDate,
          end: endDate,
        },
        {
          signal: controller.signal,
          timeoutMs: 18000,
        }
      );

      setForecast(response);
    } catch (requestError) {
      if (!controller.signal.aborted) {
        setError(
          toUserMessage(
            requestError,
            "Unable to generate forecast right now. Please try again."
          )
        );
      }
    } finally {
      clearInterval(statusTimerRef.current);

      const elapsed = Date.now() - startedAt;
      const remaining = Math.max(0, totalDuration - elapsed);

      finishTimerRef.current = setTimeout(() => {
        setProgress(100);
        setLoading(false);
        setStatus("");
      }, remaining);
    }
  };

  const cleanPredictions = useMemo(() => {
    const rows = Array.isArray(forecast?.predictions) ? forecast.predictions : [];

    return rows
      .map(normalizePrediction)
      .filter(Boolean)
      .sort((left, right) => left.timestamp - right.timestamp);
  }, [forecast]);

  const chartData = useMemo(() => {
    if (!cleanPredictions.length) return null;

    return {
      labels: cleanPredictions.map((point) => point.label),
      datasets: [
        {
          label: "Predicted Price per Kg",
          data: cleanPredictions.map((point) => point.yhat),
          borderColor: "#22c55e",
          borderWidth: 4,
          tension: 0.35,
          pointRadius: 4,
        },
        {
          label: "Upper Bound",
          data: cleanPredictions.map((point) => point.yhat_upper),
          borderWidth: 0,
          pointRadius: 0,
          fill: "-1",
          backgroundColor: "rgba(34, 197, 94, 0.18)",
        },
        {
          label: "Lower Bound",
          data: cleanPredictions.map((point) => point.yhat_lower),
          borderWidth: 0,
          pointRadius: 0,
          fill: true,
          backgroundColor: "rgba(34, 197, 94, 0.18)",
        },
      ],
    };
  }, [cleanPredictions]);

  const latest = cleanPredictions[cleanPredictions.length - 1] || null;
  const hasValidForecast = cleanPredictions.length > 0;

  return (
    <div className="dashboard-container prediction-dashboard">
      <h1 className="dashboard-title">Market Predictions</h1>
      <p className="dashboard-subtitle">AI-powered price forecasts</p>

      <div className="controls-card liquid-glass">
        <select
          value={veg}
          onChange={(event) => setVeg(event.target.value)}
          disabled={modelsLoading || loading || models.length === 0}
        >
          <option value="">Select vegetable</option>
          {vegetables.map((item) => (
            <option key={item} value={item}>
              {item.replace(/_/g, " ")}
            </option>
          ))}
        </select>

        <select
          value={market}
          onChange={(event) => setMarket(event.target.value)}
          disabled={modelsLoading || loading || !veg || markets.length === 0}
        >
          <option value="">Select market</option>
          {markets.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>

        <input
          type="date"
          value={startDate}
          onChange={(event) => setStartDate(event.target.value)}
          disabled={loading}
        />
        <input
          type="date"
          value={endDate}
          onChange={(event) => setEndDate(event.target.value)}
          disabled={loading}
        />

        <button
          className="predict-btn"
          onClick={runPrediction}
          disabled={
            loading ||
            modelsLoading ||
            !veg ||
            !market ||
            models.length === 0
          }
        >
          {loading ? "Running..." : "Run forecast"}
        </button>
      </div>

      {modelsLoading && (
        <div className="chart-placeholder">Loading available prediction models...</div>
      )}

      {!modelsLoading && modelsError && (
        <div className="error-box">{modelsError}</div>
      )}

      <div className="chart-card liquid-glass">
        {latest && !loading && !error && (
          <div className="price-kpi">
            <div className="price-label">Predicted Price per Kg</div>
            <div className="price-value">Rs. {Math.round(latest.yhat).toLocaleString()}</div>
            <div className="price-range">
              Range: {Math.round(latest.yhat_lower)} - {Math.round(latest.yhat_upper)}
            </div>
          </div>
        )}

        {!forecast && !loading && !error && (
          <div className="chart-placeholder">Select inputs and run forecast</div>
        )}

        {loading && (
          <div className="loading-box">
            <div className="spinner" />
            <div className="loading-status">{status}</div>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        {error && <div className="error-box">{error}</div>}

        {forecast && !loading && !error && !hasValidForecast && (
          <div className="chart-placeholder">
            Forecast completed, but no valid chart points were returned for this range.
          </div>
        )}

        {chartData && !loading && !error && hasValidForecast && (
          <Line
            data={chartData}
            options={{
              responsive: true,
              plugins: {
                legend: {
                  labels: {
                    font: {
                      size: 14,
                      weight: "600",
                    },
                  },
                },
              },
              scales: {
                x: {
                  ticks: {
                    font: {
                      size: 14,
                    },
                  },
                  title: {
                    display: true,
                    text: "Date",
                    font: {
                      size: 16,
                      weight: "600",
                    },
                  },
                },
                y: {
                  ticks: {
                    font: {
                      size: 14,
                    },
                  },
                  title: {
                    display: true,
                    text: "Price",
                    font: {
                      size: 16,
                      weight: "600",
                    },
                  },
                },
              },
            }}
          />
        )}
      </div>
    </div>
  );
}
