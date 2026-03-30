import "../../styles/contact.css";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { useState } from "react";
import { useRuntimeConfig } from "../../state/runtimeConfigStore";

export default function Contact() {
  const { features } = useRuntimeConfig();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMessage, setDialogMessage] = useState("");
  const [dialogType, setDialogType] = useState("success"); // success | error

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!features.contactFormEnabled) {
      setDialogType("error");
      setDialogMessage("Contact submissions are currently disabled.");
      setDialogOpen(true);
      return;
    }

    const form = e.target;

    const data = {
      name: form.name.value,
      email: form.email.value,
      subject: form.subject.value,
      message: form.message.value,
    };

    try {
      const { db } = await import("../../js/firebase");
      const { collection, addDoc, serverTimestamp } = await import("firebase/firestore");

      await addDoc(collection(db, "contact_messages"), {
        ...data,
        createdAt: serverTimestamp(),
      });

      setDialogType("success");
      setDialogMessage("Your message has been sent successfully.");
      setDialogOpen(true);
      form.reset();
    } catch (err) {
      setDialogType("error");
      setDialogMessage("Failed to send message. Please try again.");
      setDialogOpen(true);
    }
  };

  return (
    <>
      {/* ALERT DIALOG */}
      <AlertDialog.Root open={dialogOpen} onOpenChange={setDialogOpen}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="alert-overlay" />
          <AlertDialog.Content className="alert-content">
            <AlertDialog.Title className="alert-title">
              {dialogType === "success" ? "Success" : "Error"}
            </AlertDialog.Title>
            <AlertDialog.Description className="alert-description">
              {dialogMessage}
            </AlertDialog.Description>
            <AlertDialog.Action asChild>
              <button className="btn btn-primary">OK</button>
            </AlertDialog.Action>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>

      {/* PAGE */}
      <section className="contact-hero">
        <div className="contact-hero-overlay" />
        <div className="contact-hero-content">
          <h1>Contact Us</h1>
          <p>Get in touch with the Farm2Market team</p>
        </div>
      </section>

      <section className="contact-content">
        <div className="contact-grid">
          <div className="contact-info glass">
            <div className="info-item">
              <h3>Address</h3>
              <p>
                123 Agricultural Lane<br />
                Farm Valley<br />
                Sri Lanka
              </p>
            </div>

            <div className="info-item">
              <h3>Phone</h3>
              <p>
                +94 77 123 4567<br />
                +94 71 987 6543
              </p>
            </div>

            <div className="info-item">
              <h3>Email</h3>
              <p>
                info@farm2market.lk<br />
                support@farm2market.lk
              </p>
            </div>

            <div className="info-item">
              <h3>Hours</h3>
              <p>
                Mon–Fri: 9 AM–6 PM<br />
                Sat: 10 AM–4 PM<br />
                Sun: Closed
              </p>
            </div>
          </div>

          {features.contactFormEnabled ? (
            <form className="contact-form glass" onSubmit={handleSubmit}>
              <input name="name" type="text" placeholder="Your Name" required />
              <input name="email" type="email" placeholder="Your Email" required />
              <input name="subject" type="text" placeholder="Subject" required />
              <textarea name="message" placeholder="Your Message" rows="6" required />
              <button className="btn btn-primary btn-full">Send Message</button>
            </form>
          ) : (
            <div className="contact-form glass">
              <h3>Contact form disabled</h3>
              <p>
                An admin has temporarily turned off new contact submissions.
                Please check back later.
              </p>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
