import { useAppStore } from "../store/appStore";

export function ScanProgress() {
  const { scan } = useAppStore();

  // Only show the blocking overlay for user-initiated full scans.
  // Incremental / background scans are shown in the SelectionBar status strip.
  if (scan.phase !== "scanning" || scan.scanType !== "full") return null;

  const pct =
    scan.total > 0 ? Math.round((scan.scanned / scan.total) * 100) : null;

  return (
    <div
      style={{
        position: "absolute",
        bottom: 56,
        left: "50%",
        transform: "translateX(-50%)",
        background: "var(--bg-3)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "12px 18px",
        minWidth: 260,
        zIndex: 100,
        boxShadow: "0 4px 24px rgba(0,0,0,0.5)",
      }}
      className="animate-fade-in"
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 10,
        }}
      >
        <span
          className="animate-spin-custom"
          style={{
            width: 14,
            height: 14,
            border: "2px solid var(--bg-4)",
            borderTopColor: "var(--text-secondary)",
            borderRadius: "50%",
            display: "inline-block",
            flexShrink: 0,
          }}
        />
        <span style={{ fontSize: 13, color: "var(--text-primary)" }}>
          {scan.message || "Scanning…"}
        </span>
      </div>

      {/* Progress bar */}
      <div
        style={{
          height: 3,
          background: "var(--bg-4)",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        {pct !== null ? (
          <div
            style={{
              height: "100%",
              width: `${pct}%`,
              background: "var(--text-secondary)",
              transition: "width 0.25s ease",
            }}
          />
        ) : (
          // Indeterminate
          <div
            style={{
              height: "100%",
              width: "30%",
              background: "var(--text-secondary)",
              borderRadius: 2,
              animation: "indeterminate 1.4s ease infinite",
            }}
          />
        )}
      </div>

      {scan.total > 0 && (
        <div
          style={{
            marginTop: 6,
            fontSize: 11,
            color: "var(--text-muted)",
            textAlign: "right",
          }}
        >
          {scan.scanned.toLocaleString()} / {scan.total.toLocaleString()}
        </div>
      )}
    </div>
  );
}
