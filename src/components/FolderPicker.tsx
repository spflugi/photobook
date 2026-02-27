import { useState } from "react";
import { api } from "../lib/tauri";
import { useAppStore } from "../store/appStore";
import { TitleBar } from "./TitleBar";

export function FolderPicker() {
  const { setSourceFolder } = useAppStore();
  const [loading, setLoading] = useState(false);

  async function handlePick() {
    setLoading(true);
    try {
      const folder = await api.pickFolder();
      if (!folder) return;
      await api.setSetting("sourceFolder", folder);
      setSourceFolder(folder);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "var(--bg-1)",
      }}
    >
      <TitleBar />
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 32,
        }}
      >
        {/* Camera icon */}
        <svg
          width="48"
          height="48"
          viewBox="0 0 48 48"
          fill="none"
          style={{ opacity: 0.3 }}
        >
          <rect
            x="4"
            y="14"
            width="40"
            height="26"
            rx="3"
            stroke="#d4d4d4"
            strokeWidth="2"
          />
          <circle
            cx="24"
            cy="27"
            r="8"
            stroke="#d4d4d4"
            strokeWidth="2"
          />
          <circle cx="24" cy="27" r="3" fill="#d4d4d4" opacity="0.5" />
          <path d="M16 14L19 8H29L32 14" stroke="#d4d4d4" strokeWidth="2" />
          <circle cx="38" cy="20" r="2" fill="#d4d4d4" opacity="0.6" />
        </svg>

        <div
          style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 8 }}
        >
          <h1
            style={{
              fontSize: 22,
              fontWeight: 500,
              color: "var(--text-bright)",
              letterSpacing: "-0.02em",
            }}
          >
            PhotoBook
          </h1>
          <p style={{ color: "var(--text-secondary)", fontSize: 13 }}>
            Select a folder to scan your photo library
          </p>
        </div>

        <button
          onClick={handlePick}
          disabled={loading}
          style={{
            padding: "10px 24px",
            background: "var(--bg-4)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            color: loading ? "var(--text-muted)" : "var(--text-primary)",
            fontSize: 13,
            fontWeight: 500,
            display: "flex",
            alignItems: "center",
            gap: 8,
            transition: "background 0.1s, border-color 0.1s",
          }}
          onMouseEnter={(e) => {
            if (!loading) {
              (e.currentTarget as HTMLElement).style.background = "var(--bg-3)";
              (e.currentTarget as HTMLElement).style.borderColor = "#444";
            }
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = "var(--bg-4)";
            (e.currentTarget as HTMLElement).style.borderColor = "var(--border)";
          }}
        >
          {loading ? (
            <span
              className="animate-spin-custom"
              style={{
                width: 14,
                height: 14,
                border: "2px solid var(--border)",
                borderTopColor: "var(--text-secondary)",
                borderRadius: "50%",
                display: "inline-block",
              }}
            />
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M1 4.5A1.5 1.5 0 012.5 3H5l1.5-2h4L12 3h.5A1.5 1.5 0 0114 4.5v7A1.5 1.5 0 0112.5 13h-11A1.5 1.5 0 010 11.5v-7z"
                stroke="#888"
                strokeWidth="1.2"
              />
            </svg>
          )}
          {loading ? "Opening…" : "Open Folder"}
        </button>
      </div>
    </div>
  );
}
