import { useNavigate } from "react-router-dom";

import "../../styles/home.css";

import farmerImg from "../../assets/farmer.png";
import buyerImg from "../../assets/buyer.png";
import transporterImg from "../../assets/transporter.png";

export default function Landing() {
  const navigate = useNavigate();

  return (
    <section className="hero-wrapper">
      {/* Hero */}
      <section className="landing-hero">
        <img
          src="https://images.pexels.com/photos/4094697/pexels-photo-4094697.jpeg"
          alt="Agriculture background"
          className="hero-bg-img"
        />

        <div className="hero-overlay" />

        <div className="landing-hero-content">
          <h1 className="landing-hero-title">
            Empowering Farmers and Buyers.<br />
            Transforming Agriculture.
          </h1>

          <p className="landing-hero-subtitle">
            Bridging the gap between farmers and markets with real-time data
            and predictive insights.
          </p>
        </div>
      </section>

      {/* Roles OVER hero */}
      <section className="roles roles-overlay">
        <div className="container">
          <h2 className="roles-title">For the Full AgroDeve Access Stage:</h2>

          <div className="roles-grid">
            <div className="role-card" onClick={() => navigate("/dashboard")}>
              <img src={farmerImg} alt="Farmer" />
              <h3>Farmer</h3>
              <p>Manage and sell your crops.</p>
            </div>

            <div className="role-card" onClick={() => navigate("/dashboard")}>
              <img src={buyerImg} alt="Buyer" />
              <h3>Buyer</h3>
              <p>Search and purchase fresh produce.</p>
            </div>

            <div className="role-card" onClick={() => navigate("/dashboard")}>
              <img src={transporterImg} alt="Transporter" />
              <h3>Transporter</h3>
              <p>Coordinate and deliver farm goods.</p>
            </div>
          </div>
        </div>
      </section>
    </section>
  );
}
