import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { fetchChatReply, toUserMessage } from "../../js/api";
import { useRuntimeConfig } from "../../state/runtimeConfigStore";
import "../../styles/components/chatbot.css";

const MOBILE_QUERY = "(max-width: 768px)";

const createMessage = (id, role, text, status = "sent") => ({
  id,
  role,
  text,
  status,
  createdAt: new Date().toISOString(),
});

const getStarterPrompts = (pathname) => {
  if (pathname.startsWith("/dashboard/orders")) {
    return [
      "Summarize what this order status means for me.",
      "What is the fastest next action to avoid delays?",
      "Draft a short update I can send to the other party.",
    ];
  }

  if (pathname.startsWith("/dashboard/predictions")) {
    return [
      "How should I read trend signals before buying stock?",
      "What risks should I watch in this forecast period?",
      "Give me a simple pricing strategy from this data.",
    ];
  }

  if (pathname.startsWith("/dashboard/farmer")) {
    return [
      "What should I prioritize in my farmer dashboard today?",
      "Help me improve stock listing quality for buyers.",
      "How can I reduce delivery friction this week?",
    ];
  }

  if (pathname.startsWith("/dashboard")) {
    return [
      "Give me a quick dashboard walkthrough.",
      "What should I do first to get better outcomes today?",
      "How can I use this platform more efficiently?",
    ];
  }

  return [
    "What can Farm2Market help me do right now?",
    "Give me a fast 30-second product tour.",
    "How do I get the best results from this platform?",
  ];
};

export default function Chatbot() {
  const location = useLocation();
  const { features } = useRuntimeConfig();
  const messageCountRef = useRef(0);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const openRef = useRef(false);
  const sendingRef = useRef(false);
  const requestIdRef = useRef(0);

  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [input, setInput] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);
  const [lastFailedPrompt, setLastFailedPrompt] = useState("");
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(MOBILE_QUERY).matches;
  });

  const [messages, setMessages] = useState(() => [
    createMessage(
      messageCountRef.current++,
      "assistant",
      "Hi. I am your Farm2Market assistant. Ask anything and I will guide you fast."
    ),
  ]);

  const starterPrompts = useMemo(
    () => getStarterPrompts(location.pathname),
    [location.pathname]
  );

  const hasUserMessages = useMemo(
    () => messages.some((message) => message.role === "user"),
    [messages]
  );

  const canShowStarters = !hasUserMessages && !sending && messages.length <= 2;

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;

    const mediaQuery = window.matchMedia(MOBILE_QUERY);
    const onMediaChange = (event) => setIsMobile(event.matches);

    setIsMobile(mediaQuery.matches);
    mediaQuery.addEventListener("change", onMediaChange);
    return () => mediaQuery.removeEventListener("change", onMediaChange);
  }, []);

  useEffect(() => {
    openRef.current = open;
    if (open) {
      setUnreadCount(0);
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!open || !isMobile) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open, isMobile]);

  useEffect(() => {
    if (!open) return undefined;

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending]);

  useEffect(() => {
    const area = textareaRef.current;
    if (!area) return;

    area.style.height = "auto";
    const nextHeight = Math.min(area.scrollHeight, 160);
    area.style.height = `${Math.max(nextHeight, 44)}px`;
  }, [input, open]);

  const appendAssistantMessage = (text, status = "sent") => {
    setMessages((prev) => [
      ...prev,
      createMessage(messageCountRef.current++, "assistant", text, status),
    ]);

    if (!openRef.current) {
      setUnreadCount((value) => value + 1);
    }
  };

  const sendPrompt = async (rawPrompt) => {
    const prompt = rawPrompt.trim();
    if (!prompt || sendingRef.current) return;

    if (!features.aiChatEnabled) {
      appendAssistantMessage("AI chat is currently turned off by the admin.", "error");
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    sendingRef.current = true;
    setInput("");
    setSending(true);
    setLastFailedPrompt("");

    setMessages((prev) => [
      ...prev,
      createMessage(messageCountRef.current++, "user", prompt),
    ]);

    try {
      const reply = await fetchChatReply(prompt, { timeoutMs: 15000 });
      if (requestId !== requestIdRef.current) return;
      appendAssistantMessage(reply, "sent");
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      setLastFailedPrompt(prompt);
      appendAssistantMessage(
        toUserMessage(error, "AI is temporarily unavailable. Please retry."),
        "error"
      );
    } finally {
      if (requestId === requestIdRef.current) {
        sendingRef.current = false;
        setSending(false);
      }
    }
  };

  const onComposerKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendPrompt(input);
    }
  };

  const resetConversation = () => {
    requestIdRef.current += 1;
    sendingRef.current = false;
    setInput("");
    setSending(false);
    setLastFailedPrompt("");
    setMessages([
      createMessage(
        messageCountRef.current++,
        "assistant",
        "Conversation reset. What should we work on now?"
      ),
    ]);
  };

  if (!features.aiChatEnabled) {
    return null;
  }

  return (
    <div className={`chatbot-root ${open ? "open" : ""}`}>
      <button
        type="button"
        className={`chatbot-launcher ${open ? "open" : ""}`}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="chatbot-panel"
        aria-label={open ? "Close assistant" : "Open assistant"}
      >
        <span className="chatbot-launcher-halo" aria-hidden="true" />
        <span className="chatbot-launcher-presence" aria-hidden="true" />
        <span className="chatbot-launcher-icon" aria-hidden="true">
          {open ? "X" : "AI"}
        </span>
        {unreadCount > 0 && !open && (
          <span className="chatbot-launcher-unread" aria-hidden="true">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <button
            type="button"
            className={`chatbot-backdrop ${isMobile ? "visible" : ""}`}
            aria-label="Close assistant"
            onClick={() => setOpen(false)}
          />

          <section
            id="chatbot-panel"
            role="dialog"
            aria-modal={isMobile}
            aria-labelledby="chatbot-title"
            className={`chatbot-panel ${isMobile ? "mobile" : "desktop"}`}
          >
            <header className="chatbot-header">
              <div className="chatbot-title-wrap">
                <h2 id="chatbot-title">Farm2Market Assistant</h2>
                <p className="chatbot-status">
                  <span className="chatbot-status-dot" aria-hidden="true" />
                  DeepSeek connected
                </p>
              </div>
              <div className="chatbot-header-actions">
                <button
                  type="button"
                  className="chatbot-action-btn"
                  onClick={resetConversation}
                  aria-label="Reset conversation"
                >
                  Reset
                </button>
                <button
                  type="button"
                  className="chatbot-action-btn"
                  onClick={() => setOpen(false)}
                  aria-label="Close assistant"
                >
                  Close
                </button>
              </div>
            </header>

            <div className="chatbot-messages" aria-live="polite">
              {canShowStarters && (
                <section className="chatbot-starters" aria-label="Suggested prompts">
                  {starterPrompts.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      className="chatbot-starter-chip"
                      onClick={() => sendPrompt(prompt)}
                    >
                      {prompt}
                    </button>
                  ))}
                </section>
              )}

              {messages.map((message) => (
                <article
                  key={message.id}
                  className={`chatbot-message ${message.role} ${
                    message.status === "error" ? "is-error" : ""
                  }`}
                >
                  <div className="chatbot-bubble">
                    <p>{message.text}</p>
                  </div>
                </article>
              ))}

              {sending && (
                <article className="chatbot-message assistant typing">
                  <div className="chatbot-bubble">
                    <div className="chatbot-typing" aria-label="Assistant typing">
                      <span />
                      <span />
                      <span />
                    </div>
                  </div>
                </article>
              )}

              {!!lastFailedPrompt && !sending && (
                <div className="chatbot-retry-wrap">
                  <button
                    type="button"
                    className="chatbot-retry-btn"
                    onClick={() => sendPrompt(lastFailedPrompt)}
                  >
                    Retry last message
                  </button>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            <footer className="chatbot-composer">
              <label className="sr-only" htmlFor="chatbot-input">
                Ask Farm2Market assistant
              </label>
              <textarea
                id="chatbot-input"
                ref={textareaRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={onComposerKeyDown}
                placeholder="Ask anything about Farm2Market..."
                disabled={sending}
                rows={1}
                maxLength={1000}
              />
              <div className="chatbot-composer-meta">
                <span>Enter to send | Shift+Enter for a new line</span>
                <button
                  type="button"
                  className="chatbot-send-btn"
                  onClick={() => sendPrompt(input)}
                  disabled={sending || !input.trim()}
                  aria-label="Send message"
                >
                  {sending ? "Sending..." : "Send"}
                </button>
              </div>
            </footer>
          </section>
        </>
      )}
    </div>
  );
}
