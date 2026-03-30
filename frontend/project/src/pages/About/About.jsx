import "../../styles/about.css";

export default function About() {
  return (
    <div className="about-page">
      {/* HERO */}
      <section className="about-hero">
        <div className="about-hero-content">
          <span className="about-hero-eyebrow">About Farm2Market</span>
          <h2>
            Empowering Farmers.<br />
            Transforming Agriculture.
          </h2>
          <p>
            We connect farmers directly with buyers using real-time data,
            predictive insights, and transparent market access.
          </p>
        </div>
      </section>

      {/* CARDS */}
      <section className="about-content">
        <div className="about-card-grid">
          <div className="about-info-card">
            <h4>The Problem</h4>
            <p>
              Farmers often sell blindly, relying on middlemen and outdated
              price information. This creates unfair pricing and waste.
            </p>
          </div>

          <div className="about-info-card">
            <h4>Our Solution</h4>
            <p>
              Farm2Market provides real-time pricing, predictive analytics,
              and direct access to buyers — removing uncertainty.
            </p>
          </div>

          <div className="about-info-card">
            <h4>The Impact</h4>
            <ul>
              <li>Fairer farmer income</li>
              <li>Reduced food waste</li>
              <li>Faster logistics</li>
              <li>Transparent pricing</li>
            </ul>
          </div>
        </div>
      </section>

      {/* STATS */}
      <section className="about-stats">
        <div className="about-stat">
          <strong>100%</strong>
          <span>100% Transparent Pricing</span>
        </div>
        <div className="about-stat">
          <strong>0%</strong>
          <span>No Hidden Commissions</span>
        </div>
        <div className="about-stat">
          <strong>24/7</strong>
          <span> 24/7 Market Visibility</span>
        </div>
      </section>

      {/* VISION */}
      <section className="about-vision">
        <h3>Looking Ahead</h3>
        <p>
          Our vision is a future where agriculture is data-driven, fair,
          and sustainable — empowering farmers at every step.
        </p>
      </section>
    </div>
  );
}
