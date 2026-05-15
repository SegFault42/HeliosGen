"use client";
import { useEffect, useState } from "react";

export default function TypewriterHeading({
  text,
  onDone,
}: {
  text: string;
  onDone?: () => void;
}) {
  const [displayed, setDisplayed] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    setDisplayed("");
    setDone(false);
    let i = 0;
    const id = setInterval(() => {
      i++;
      setDisplayed(text.slice(0, i));
      if (i >= text.length) { clearInterval(id); setDone(true); onDone?.(); }
    }, 35);
    return () => clearInterval(id);
  }, [text]);

  return (
    <h2 style={{
      fontFamily: "var(--font-doto), monospace",
      fontSize: "clamp(22px, 3vw, 40px)",
      fontWeight: 900,
      lineHeight: 1.05,
      letterSpacing: "-0.8px",
      textAlign: "center",
      margin: "20px 0 12px",
      width: "100%",
      maxWidth: "600px",
    }}>
      <span style={{
        background: "linear-gradient(to bottom, #ffffff, #2DD4BF)",
        WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent",
        backgroundClip: "text",
      }}>
        {displayed}
        {!done && (
          <span style={{ opacity: 0.6, animation: "twCursorBlink 0.8s step-end infinite" }}>▮</span>
        )}
      </span>
      <style>{`@keyframes twCursorBlink { 0%,100%{opacity:.6} 50%{opacity:0} }`}</style>
    </h2>
  );
}
