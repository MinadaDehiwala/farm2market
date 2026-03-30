import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { db } from "../../../js/firebase";
import { useAuth } from "../../../state/authStore";
import { useRuntimeConfig } from "../../../state/runtimeConfigStore";
import {
  respondToOrder,
  sendThreadMessage,
  toFirebaseCallableMessage,
  updateDeliveryStatus,
} from "../../../js/orderThreadApi";
import {
  canRevealPhone,
  formatTimestamp,
  maskPhone,
  toOrderStatusLabel,
} from "../../../js/orders";

import "../../../styles/order-detail-dashboard.css";

function Timeline({ entries }) {
  if (!entries || entries.length === 0) {
    return <p className="order-empty">No timeline events yet.</p>;
  }

  return (
    <ol className="timeline-list">
      {entries.map((entry, index) => (
        <li key={`${entry.status}-${entry.at?.seconds || index}`}>
          <p className="timeline-title">{toOrderStatusLabel(entry.status)}</p>
          <p className="timeline-time">{formatTimestamp(entry.at)}</p>
        </li>
      ))}
    </ol>
  );
}

export default function OrderDetailDashboard() {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const { user, role } = useAuth();
  const { features } = useRuntimeConfig();

  const [order, setOrder] = useState(null);
  const [stock, setStock] = useState(null);
  const [transportRequest, setTransportRequest] = useState(null);
  const [messages, setMessages] = useState([]);
  const [profiles, setProfiles] = useState({});

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [messageInput, setMessageInput] = useState("");
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!features.orderThreadsEnabled || !orderId) {
      setLoading(false);
      return;
    }

    const orderRef = doc(db, "orders", orderId);
    const unsub = onSnapshot(
      orderRef,
      async (snap) => {
        if (!snap.exists()) {
          setOrder(null);
          setError("Order not found.");
          setLoading(false);
          return;
        }

        const data = { id: snap.id, ...snap.data() };
        if (data.archivedAt) {
          setOrder(null);
          setError("This order has been archived by an admin.");
          setLoading(false);
          return;
        }
        setOrder(data);
        setError("");
        setLoading(false);
      },
      () => {
        setError("Unable to load order.");
        setLoading(false);
      }
    );

    return () => unsub();
  }, [features.orderThreadsEnabled, orderId]);

  useEffect(() => {
    if (!order?.stockId) return;

    const unsub = onSnapshot(doc(db, "stocks", order.stockId), (snap) => {
      if (!snap.exists()) {
        setStock(null);
        return;
      }

      const nextStock = { id: snap.id, ...snap.data() };
      setStock(nextStock.archivedAt ? null : nextStock);
    });

    return () => unsub();
  }, [order?.stockId]);

  useEffect(() => {
    if (!orderId) return;

    const q = query(
      collection(db, "transport_requests"),
      where("orderId", "==", orderId)
    );

    const unsub = onSnapshot(q, (snap) => {
      const first = snap.docs[0];
      const nextTransport = first ? { id: first.id, ...first.data() } : null;
      setTransportRequest(nextTransport?.archivedAt ? null : nextTransport);
    });

    return () => unsub();
  }, [orderId]);

  useEffect(() => {
    if (!order?.threadId) {
      setMessages([]);
      return;
    }

    const q = query(
      collection(db, "threads", order.threadId, "messages"),
      orderBy("createdAt", "asc")
    );

    const unsub = onSnapshot(q, (snap) => {
      setMessages(snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
    });

    return () => unsub();
  }, [order?.threadId]);

  useEffect(() => {
    const ids = [order?.buyerId, order?.farmerId, order?.transporterId].filter(Boolean);
    if (ids.length === 0) return;

    let active = true;

    (async () => {
      const results = {};
      await Promise.all(
        ids.map(async (id) => {
          const snap = await getDoc(doc(db, "users", id));
          if (snap.exists()) {
            results[id] = snap.data();
          }
        })
      );

      if (active) setProfiles(results);
    })().catch(() => null);

    return () => {
      active = false;
    };
  }, [order?.buyerId, order?.farmerId, order?.transporterId]);

  const timeline = useMemo(() => {
    const raw = Array.isArray(order?.statusTimeline) ? order.statusTimeline : [];
    return [...raw].sort((a, b) => {
      const aMs = a?.at?.toMillis ? a.at.toMillis() : 0;
      const bMs = b?.at?.toMillis ? b.at.toMillis() : 0;
      return aMs - bMs;
    });
  }, [order?.statusTimeline]);

  const revealPhone = canRevealPhone(order?.status);

  const handleRespond = async (action) => {
    if (!order) return;

    try {
      setBusy(true);
      await respondToOrder({ orderId: order.id, action });
      toast.success(action === "accept" ? "Order accepted" : "Order rejected");
    } catch (err) {
      toast.error(toFirebaseCallableMessage(err, "Unable to update order"));
    } finally {
      setBusy(false);
    }
  };

  const handleTransportUpdate = async (status) => {
    if (!transportRequest?.id) return;

    try {
      setBusy(true);
      await updateDeliveryStatus({
        transportRequestId: transportRequest.id,
        status,
      });
      toast.success(`Delivery status updated: ${status}`);
    } catch (err) {
      toast.error(toFirebaseCallableMessage(err, "Unable to update delivery status"));
    } finally {
      setBusy(false);
    }
  };

  const handleSend = async (event) => {
    event.preventDefault();
    if (!order?.threadId || !messageInput.trim()) return;

    try {
      setSending(true);
      await sendThreadMessage({
        threadId: order.threadId,
        text: messageInput.trim(),
      });
      setMessageInput("");
    } catch (err) {
      toast.error(toFirebaseCallableMessage(err, "Unable to send message"));
    } finally {
      setSending(false);
    }
  };

  const renderContact = (label, uid, fallbackPhone) => {
    if (!uid) {
      return (
        <div className="contact-row">
          <span>{label}</span>
          <span>-</span>
        </div>
      );
    }

    const profile = profiles[uid] || {};
    const fullName = `${profile.firstName || ""} ${profile.lastName || ""}`.trim() || "Unknown";
    const rawPhone = profile.phone || fallbackPhone || "";
    const phone = revealPhone ? rawPhone || "Not available" : maskPhone(rawPhone);

    return (
      <div className="contact-row">
        <span>{label}</span>
        <span>
          {fullName} · {phone}
        </span>
      </div>
    );
  };

  if (!features.orderThreadsEnabled) {
    return (
      <div className="dashboard-container order-detail-dashboard">
        <p>Order threads are currently disabled by the admin.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="dashboard-container order-detail-dashboard">
        <p>Loading order...</p>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="dashboard-container order-detail-dashboard">
        <p>{error || "Order unavailable."}</p>
      </div>
    );
  }

  return (
    <div className="dashboard-container order-detail-dashboard">
      <header className="order-head">
        <div>
          <h1 className="dashboard-title">Order #{order.id.slice(0, 8).toUpperCase()}</h1>
          <p className="dashboard-subtitle">{toOrderStatusLabel(order.status)}</p>
        </div>

        <button className="btn secondary" onClick={() => navigate("/dashboard/orders")}>Back to Orders</button>
      </header>

      <div className="order-detail-grid">
        <section className="order-card liquid-glass">
          <h3>Summary</h3>
          <p><strong>Vegetable:</strong> {stock?.vegetable || "-"}</p>
          <p><strong>Requested:</strong> {order.requestedQtyKg || "-"} kg</p>
          <p><strong>Price:</strong> LKR {order.pricePerKg || "-"}/kg</p>
          <p><strong>Market:</strong> {order.market || "-"}</p>
          <p><strong>Created:</strong> {formatTimestamp(order.createdAt)}</p>
          <p><strong>Reservation Expires:</strong> {formatTimestamp(order.reservationExpiresAt)}</p>

          <div className="order-actions-inline">
            {role === "farmer" && order.status === "requested" && (
              <>
                <button className="btn green" disabled={busy} onClick={() => handleRespond("accept")}>Accept</button>
                <button className="btn red" disabled={busy} onClick={() => handleRespond("reject")}>Reject</button>
              </>
            )}

            {role === "transporter" && order.transporterId === user?.uid && order.status === "in_delivery" && (
              <>
                {transportRequest?.status === "paused" ? (
                  <button className="btn blue" disabled={busy} onClick={() => handleTransportUpdate("resumed")}>Resume</button>
                ) : (
                  <button className="btn blue" disabled={busy} onClick={() => handleTransportUpdate("paused")}>Pause</button>
                )}
                <button className="btn" disabled={busy} onClick={() => handleTransportUpdate("picked_up")}>Picked Up</button>
                <button className="btn green" disabled={busy} onClick={() => handleTransportUpdate("completed")}>Complete</button>
                <button className="btn red" disabled={busy} onClick={() => handleTransportUpdate("cancelled")}>Cancel</button>
              </>
            )}
          </div>
        </section>

        <section className="order-card liquid-glass">
          <h3>Timeline</h3>
          <Timeline entries={timeline} />
        </section>

        <section className="order-card liquid-glass">
          <h3>Contacts</h3>
          {renderContact("Buyer", order.buyerId)}
          {renderContact("Farmer", order.farmerId, stock?.phone)}
          {renderContact("Transporter", order.transporterId)}

          {!revealPhone && (
            <p className="order-note">
              Phone numbers are masked until the order reaches in-delivery stage.
            </p>
          )}
        </section>

        <section className="order-card liquid-glass order-chat-card">
          <h3>Order Thread</h3>
          <div className="chat-list">
            {messages.length === 0 && <p className="order-empty">No messages yet.</p>}
            {messages.map((message) => (
              <div
                key={message.id}
                className={`chat-item ${message.senderId === user?.uid ? "mine" : ""}`}
              >
                <p className="chat-text">{message.text}</p>
                <span className="chat-meta">
                  {message.senderRole || "user"} · {formatTimestamp(message.createdAt)}
                </span>
              </div>
            ))}
          </div>

          <form className="chat-form" onSubmit={handleSend}>
            <input
              value={messageInput}
              onChange={(e) => setMessageInput(e.target.value)}
              placeholder="Type a message"
            />
            <button className="btn" type="submit" disabled={sending || !messageInput.trim()}>
              {sending ? "Sending..." : "Send"}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
