# 🌱 Farm2Market

**A digital marketplace connecting farmers, buyers, and transporters with vegetable price forecasting tools**

Prepared for **Minuri**.

![Vite](https://img.shields.io/badge/Vite-React-blueviolet)
![Firebase](https://img.shields.io/badge/Firebase-Auth%20%7C%20Hosting-orange)
![Forecasting](https://img.shields.io/badge/Forecasting-Price%20Prediction-green)
![Status](https://img.shields.io/badge/Status-Production--Ready-success)

---

## 🚀 Overview

**Farm2Market** is a full-stack web platform designed to modernize agricultural trade.
It connects **farmers**, **buyers**, and **transporters** in one ecosystem while providing **vegetable price forecasting** to support smarter decisions.

Built with performance, scalability, and real-world usability in mind.

---

## ✨ Key Features

### 👥 Multi-Role System

* **Farmers**: Manage stock, view predictions, plan harvests
* **Buyers**: Browse prices, monitor trends
* **Transporters**: Access logistics dashboards
* **Guests**: Explore public data

### 📈 Price Prediction

* Time-series forecasting for vegetable prices
* Visual charts and trend analysis
* Prediction shown per **kg**

### 🔐 Secure Authentication

* Firebase Authentication
* Role-based access control
* Protected routes and dashboards

### 📊 Smart Dashboards

* Farmer dashboard
* Buyer dashboard
* Transporter dashboard
* Prediction dashboard
* Stock management

### 💬 Integrated Assistant

* Context-aware assistant
* Helps users navigate and understand data

### ⚡ Fast & Modern Frontend

* Built with **React + Vite**
* Clean component architecture
* Optimized production builds

---

## 🏗️ Tech Stack

### Frontend

* **React**
* **Vite**
* **React Router**
* **CSS Modules / Custom CSS**

### Backend & Services

* **Firebase Authentication**
* **Firebase Hosting**
* **REST API** (external prediction service)

### Data & Forecasting

* Time-series prediction models
* API-based integration

---

## 📁 Project Structure

```
src/
├── app/                # App entry & routing
├── assets/             # Images & static assets
├── components/         # Reusable UI and assistant components
├── js/                 # Auth, guards, API config
├── layouts/            # Public & dashboard layouts
├── pages/              # All route-level pages
├── state/              # Global auth store
├── styles/             # Organized CSS
└── main.jsx            # App bootstrap
```

Clean separation of concerns. Scales well.

---

## 🔐 Authentication Flow

* Firebase Auth handles login/signup
* User role stored and resolved on login
* Guards:

  * `auth-guard.jsx`
  * `role-guard.jsx`
  * `DashboardRedirect.jsx`

No role leaks. No race conditions.

---

## 🌐 Environment Setup

### `.env`

```env
VITE_API_BASE_URL=http://localhost:8000
VITE_FIREBASE_API_KEY=your_key
VITE_FIREBASE_AUTH_DOMAIN=your_domain
VITE_FIREBASE_PROJECT_ID=your_project
VITE_FIREBASE_APP_ID=your_app_id
```

### `.env.production`

```env
VITE_API_BASE_URL=https://api.yourdomain.com
```

---

## 🛠️ Local Development

```bash
npm install
npm run dev
```

Build for production:

```bash
npm run build
```

---

## 🚀 Deployment

* Hosted on **Firebase Hosting**
* HTTPS enabled automatically
* Optimized Vite production bundle

```bash
firebase deploy
```

---

## 🎯 Highlights

* Real-world problem solving
* Clean React architecture
* Role-based dashboards done right
* Forecasting support without overengineering
* Production-ready deployment

---

## 📌 Future Improvements

* Advanced analytics dashboard
* Notification system
* Mobile-first enhancements
* ML model retraining automation
* Admin panel

---

## 👨‍💻 Project Note

Prepared for Minuri with a focus on practical delivery, maintainability, and clear project presentation.

---
