import { useEffect, useState, useMemo } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { db } from "../../js/firebase";
import { useAuth } from "../../state/authStore";
import { useRuntimeConfig } from "../../state/runtimeConfigStore";
import {
  createOrderRequest,
  toFirebaseCallableMessage,
} from "../../js/orderThreadApi";
import { canRevealPhone, maskPhone, toOrderStatusLabel } from "../../js/orders";

/* chart */
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
} from "chart.js";
import { Line } from "react-chartjs-2";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip
);

/* styles */
import "../../styles/buyer-dashboard.css";

/* images */
import tomatoImg from "../../assets/pics/tomatoes.jpg";
import onionImg from "../../assets/pics/Onion.jpg";
import carrotImg from "../../assets/pics/carrot.jpg";
import chilliImg from "../../assets/pics/chilli.jpg";
import limeImg from "../../assets/pics/lime.jpg";
import snakeGourdImg from "../../assets/pics/snake-gourd.jpg";
import potatoLocalImg from "../../assets/pics/local potatoes.jpg";
import potatoImportedImg from "../../assets/pics/imported_potatoes.jpg";
import defaultImg from "../../assets/hero.png";

/* constants */
const VEGETABLES = [
  "Tomato",
  "Carrot",
  "Green Chilli",
  "Lime",
  "Snake Gourd",
  "Potato (Local)",
  "Potato (Imported)",
  "Big Onion (Local)",
  "Big Onion (Imported)",
  "Red Onion (Imported)",
];

const MARKETS = ["All", "Pettah", "Narahenpita"];

const VEG_IMAGE_MAP = {
  Tomato: tomatoImg,
  Carrot: carrotImg,
  "Green Chilli": chilliImg,
  Lime: limeImg,
  "Snake Gourd": snakeGourdImg,
  "Potato (Local)": potatoLocalImg,
  "Potato (Imported)": potatoImportedImg,
  "Big Onion (Local)": onionImg,
  "Big Onion (Imported)": onionImg,
  "Red Onion (Imported)": onionImg,
};

const getVegImage = (veg) =>
  VEG_IMAGE_MAP[veg] || defaultImg;

const getStockImage = (stock) =>
  stock?.photoUrl ||
  (Array.isArray(stock?.photoUrls) ? stock.photoUrls[0] : null) ||
  getVegImage(stock?.vegetable);

const toValidNonNegativeNumber = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, numeric);
};

const formatPrice = (value) => {
  const numeric = toValidNonNegativeNumber(value);
  if (numeric === null) return "N/A";
  return numeric.toLocaleString();
};

export default function CommonDashboard() {
  const { user } = useAuth();
  const { features } = useRuntimeConfig();
  const navigate = useNavigate();

  const [stocks, setStocks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedStock, setSelectedStock] = useState(null);

  const [selectedVeg, setSelectedVeg] = useState(VEGETABLES[0]);
  const [selectedMarket, setSelectedMarket] = useState("All");

  const [farmerProfile, setFarmerProfile] = useState(null);
  const [existingOrder, setExistingOrder] = useState(null);
  const [requestQty, setRequestQty] = useState("");
  const [requestMessage, setRequestMessage] = useState("");
  const [requestLoading, setRequestLoading] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "stocks"),
      (snap) => {
        setStocks(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .filter((stock) => !stock.archivedAt)
        );
        setLoading(false);
      },
      () => {
        setError("Unable to load stock listings.");
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!features.orderThreadsEnabled || !selectedStock || !user) {
      setFarmerProfile(null);
      setExistingOrder(null);
      setRequestQty("");
      setRequestMessage("");
      return;
    }

    let cancelled = false;

    const loadContactContext = async () => {
      try {
        const farmerSnap = await getDoc(doc(db, "users", selectedStock.farmerId));

        const latestOrderQuery = query(
          collection(db, "orders"),
          where("buyerId", "==", user.uid),
          where("stockId", "==", selectedStock.id),
          orderBy("createdAt", "desc"),
          limit(1)
        );
        const latestOrderSnap = await getDocs(latestOrderQuery);

        if (cancelled) return;

        setFarmerProfile(farmerSnap.exists() ? farmerSnap.data() : null);
        setExistingOrder(
          latestOrderSnap.docs
            .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
            .find((order) => !order.archivedAt) || null
        );
      } catch {
        if (!cancelled) {
          setFarmerProfile(null);
          setExistingOrder(null);
        }
      }
    };

    const available = Number(selectedStock.availableQtyKg || selectedStock.quantity || 1);
    setRequestQty(String(Math.max(1, Math.floor(available))));
    setRequestMessage("");

    loadContactContext();

    return () => {
      cancelled = true;
    };
  }, [features.orderThreadsEnabled, selectedStock, user]);

  const chartData = useMemo(() => {
    const filtered = stocks.filter(
      (s) =>
        s.vegetable === selectedVeg &&
        (selectedMarket === "All" || s.market === selectedMarket)
    );

    const points = filtered
      .map((stock, index) => ({
        label: `#${index + 1}`,
        price: toValidNonNegativeNumber(stock.price),
      }))
      .filter((entry) => entry.price !== null);

    if (!points.length) return { labels: [], datasets: [] };

    return {
      labels: points.map((entry) => entry.label),
      datasets: [
        {
          label: "Price (Rs./kg)",
          data: points.map((entry) => entry.price),
          tension: 0.35,
          borderColor: "#38bdf8",
          borderWidth: 3,
          fill: true,
          backgroundColor: "rgba(56, 189, 248, 0.14)",
          pointBackgroundColor: "#e2f3ff",
          pointBorderColor: "#38bdf8",
          pointBorderWidth: 1.5,
          pointRadius: 2,
          pointHoverRadius: 5,
          pointHitRadius: 14,
        },
      ],
    };
  }, [stocks, selectedVeg, selectedMarket]);

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: "index",
      intersect: false,
    },
    elements: {
      line: {
        capBezierPoints: true,
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "rgba(9, 14, 20, 0.95)",
        borderColor: "rgba(148, 163, 184, 0.35)",
        borderWidth: 1,
        titleColor: "#f8fafc",
        bodyColor: "#e2e8f0",
        callbacks: {
          label: (context) => `Rs. ${context.parsed.y}/kg`,
        },
      },
    },
    scales: {
      x: {
        ticks: {
          color: "rgba(255, 255, 255, 0.82)",
          maxRotation: 0,
          autoSkip: true,
          maxTicksLimit: 12,
        },
        grid: {
          color: "rgba(255, 255, 255, 0.08)",
        },
        border: {
          color: "rgba(255, 255, 255, 0.15)",
        },
      },
      y: {
        ticks: {
          color: "rgba(255, 255, 255, 0.86)",
          callback: (value) => `Rs. ${value}`,
        },
        grid: {
          color: "rgba(255, 255, 255, 0.12)",
        },
        border: {
          color: "rgba(255, 255, 255, 0.15)",
        },
      },
    },
  };

  const handleCreateOrder = async (openAfterCreate = true) => {
    if (!selectedStock) return;

    const qty = Number(requestQty);
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error("Enter a valid quantity in kg.");
      return;
    }

    try {
      setRequestLoading(true);

      const result = await createOrderRequest({
        stockId: selectedStock.id,
        requestedQtyKg: qty,
        initialMessage: requestMessage.trim() || undefined,
      });

      toast.success("Order request created");
      setSelectedStock(null);

      if (openAfterCreate && result.orderId) {
        navigate(`/dashboard/orders/${result.orderId}`);
      }
    } catch (err) {
      toast.error(toFirebaseCallableMessage(err, "Unable to create order request"));
    } finally {
      setRequestLoading(false);
    }
  };

  const openExistingThread = () => {
    if (!existingOrder?.id) {
      handleCreateOrder(true);
      return;
    }

    setSelectedStock(null);
    navigate(`/dashboard/orders/${existingOrder.id}`);
  };

  const availableQty = Number(selectedStock?.availableQtyKg || selectedStock?.quantity || 0);
  const phoneVisible = canRevealPhone(existingOrder?.status);
  const activeStocks = stocks.filter((stock) => {
    const qty = Number(stock.availableQtyKg ?? stock.quantity ?? 0);
    return Number.isFinite(qty) && qty > 0;
  });

  return (
    <div className="dashboard-container buyer-dashboard">
      <header className="dashboard-header">
        <div>
          <h1 className="dashboard-title">Markets Overview</h1>
          <p className="dashboard-subtitle">
            Live stock availability and prices
          </p>
        </div>
        <button className="btn secondary" onClick={() => navigate("/")}>
          ← Home
        </button>
      </header>

      {/* KPI */}
      <div className="buyer-stats">
        <div className="buyer-stat-card liquid-glass">
          <h3>{activeStocks.length}</h3>
          <p>Active Listings</p>
        </div>
        <div className="buyer-stat-card liquid-glass">
          <h3>{new Set(stocks.map((s) => s.vegetable)).size}</h3>
          <p>Vegetables</p>
        </div>
        <div className="buyer-stat-card liquid-glass">
          <h3>{new Set(stocks.map((s) => s.market)).size}</h3>
          <p>Markets</p>
        </div>
      </div>

      {/* CHART */}
      <div className="price-chart liquid-glass">
        <div className="price-chart-header">
          <h3>Live Prices</h3>
          <div className="price-chart-controls">
            <select value={selectedVeg} onChange={(e) => setSelectedVeg(e.target.value)}>
              {VEGETABLES.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
            <select value={selectedMarket} onChange={(e) => setSelectedMarket(e.target.value)}>
              {MARKETS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="price-chart-canvas">
          {chartData.datasets.length ? (
            <Line data={chartData} options={chartOptions} />
          ) : (
            <p className="buyer-empty">No price data</p>
          )}
        </div>
      </div>

      {/* STOCK GRID */}
      <div className="stock-grid">
        {loading && <p>Loading…</p>}
        {!loading && error && <p className="buyer-empty">{error}</p>}

        {!loading &&
          !error &&
          activeStocks.map((s) => (
            <div key={s.id} className="stock-card liquid-glass">
              <div className="stock-image">
                <img src={getStockImage(s)} alt={s.vegetable} />
              </div>

              <div className="stock-card-body">
                <div className="stock-card-header">
                  <h3>{s.vegetable}</h3>
                  <span className="stock-price">Rs. {formatPrice(s.price)}/kg</span>
                </div>

                <div className="stock-meta">
                  <p>{s.market}</p>
                  <p>{s.availableQtyKg ?? s.quantity} kg available</p>
                </div>

                <div className="stock-actions">
                  <button
                    className="btn primary"
                    onClick={() => setSelectedStock(s)}
                  >
                    {features.orderThreadsEnabled ? "Request & Contact" : "Contact Farmer"}
                  </button>
                </div>
              </div>
            </div>
          ))}
      </div>

      {/* MODAL */}
      {selectedStock && (
        <div className="buyer-modal-overlay" onClick={() => setSelectedStock(null)}>
          <div className="buyer-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{selectedStock.vegetable}</h3>
            <p><strong>Market:</strong> {selectedStock.market}</p>
            <p><strong>Pickup:</strong> {selectedStock.pickupLocation || "-"}</p>

            {!features.orderThreadsEnabled && (
              <>
                <p><strong>Phone:</strong> {selectedStock.phone || "Not available"}</p>
                <button className="btn" onClick={() => setSelectedStock(null)}>
                  Close
                </button>
              </>
            )}

            {features.orderThreadsEnabled && (
              <>
                <div className="buyer-contact-divider" />
                <p>
                  <strong>Farmer:</strong>{" "}
                  {farmerProfile
                    ? `${farmerProfile.firstName || ""} ${farmerProfile.lastName || ""}`.trim() || "Unknown"
                    : "Loading..."}
                </p>
                <p><strong>Response Time:</strong> {farmerProfile?.avgResponseMin ? `${farmerProfile.avgResponseMin} min` : "~10 min"}</p>
                <p><strong>Completed Deliveries:</strong> {farmerProfile?.completedDeliveries ?? 0}</p>
                <p>
                  <strong>Phone:</strong>{" "}
                  {phoneVisible ? (selectedStock.phone || "Not available") : maskPhone(selectedStock.phone)}
                </p>

                {existingOrder && (
                  <p>
                    <strong>Current Thread:</strong> {toOrderStatusLabel(existingOrder.status)}
                  </p>
                )}

                <div className="contact-request-grid">
                  <label>Request Quantity (kg)</label>
                  <input
                    type="number"
                    min="1"
                    max={Math.max(1, availableQty || 1)}
                    value={requestQty}
                    onChange={(e) => setRequestQty(e.target.value)}
                  />

                  <label>Message</label>
                  <textarea
                    rows="3"
                    value={requestMessage}
                    onChange={(e) => setRequestMessage(e.target.value)}
                    placeholder="Add a message for the farmer"
                  />
                </div>

                {!phoneVisible && (
                  <p className="buyer-contact-note">
                    Full phone numbers are revealed only after transporter assignment and active delivery.
                  </p>
                )}

                <div className="stock-actions">
                  <button className="btn primary" disabled={requestLoading} onClick={() => handleCreateOrder(true)}>
                    {requestLoading ? "Requesting..." : "Request Transport"}
                  </button>
                  <button className="btn" disabled={requestLoading} onClick={openExistingThread}>
                    Message
                  </button>
                </div>

                <button className="btn secondary" onClick={() => setSelectedStock(null)}>
                  Close
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
