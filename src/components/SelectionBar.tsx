import { useEffect } from "react";
import { useAppStore } from "../store/appStore";
import { useExport } from "../hooks/useExport";
import { api } from "../lib/tauri";

export function SelectionBar() {
  const {
    exportState,
    setExportState,
    setYears,
    photos,
    optimisticBatch,
    showSelectedOnly,
    setShowSelectedOnly,
    thumbProgress,
    scan,
    watcherActive,
  } = useAppStore();
  const { runExport } = useExport();

  const count = photos.filter((p) => p.selected).length;
  const isExporting = exportState.running;

  const isBackgroundScan = scan.phase === "scanning" && scan.scanType === "incremental";
  const isThumbRunning = thumbProgress.running;
  const showStatus = isBackgroundScan || isThumbRunning || watcherActive;

  // Auto-reset filter when there's nothing to show
  useEffect(() => {
    if (showSelectedOnly && count === 0) setShowSelectedOnly(false);
  }, [count, showSelectedOnly]);

  async function handleDeselectAll() {
    const allIds = photos.filter((p) => p.selected).map((p) => p.id);
    optimisticBatch(allIds, false);
    setShowSelectedOnly(false);
    try {
      await api.batchSetSelection(allIds, false);
      const refreshed = await api.getYears();
      setYears(refreshed);
    } catch (e) {
      console.error(e);
    }
  }

  async function handleExport() {
    setExportState({ result: null });
    await runExport();
  }

  function dismissResult() {
    setExportState({ result: null });
  }

  return (
    <div
      style={{
        background: "var(--bg-0)",
        borderTop: "1px solid var(--border-subtle)",
        flexShrink: 0,
      }}
    >
      {/* ── Main action row ───────────────────────────────────────────────── */}
      <div
        style={{
          height: 48,
          display: "flex",
          alignItems: "center",
          padding: "0 16px",
          gap: 12,
        }}
      >
        {/* Selection count */}
        <span
          style={{
            fontSize: 13,
            color: count > 0 ? "var(--text-primary)" : "var(--text-muted)",
            minWidth: 120,
          }}
        >
          {count > 0
            ? `${count.toLocaleString()} photo${count === 1 ? "" : "s"} selected`
            : "No selection"}
        </span>

        {count > 0 && <BarBtn onClick={handleDeselectAll} label="Deselect all" />}

        {count > 0 && (
          <ToggleBtn
            active={showSelectedOnly}
            onClick={() => setShowSelectedOnly(!showSelectedOnly)}
            label={showSelectedOnly ? "Show all" : "Show selected"}
          />
        )}

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Export result */}
        {exportState.result && !isExporting && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: "var(--bg-3)",
              border: "1px solid var(--border)",
              borderRadius: 5,
              padding: "4px 10px",
              fontSize: 12,
              color: "var(--text-secondary)",
            }}
          >
            <span>
              {exportState.result.errors.length === 0
                ? `✓ ${exportState.result.copied} copied`
                : `${exportState.result.copied} copied, ${exportState.result.errors.length} errors`}
            </span>
            <button
              onClick={dismissResult}
              style={{
                background: "none",
                border: "none",
                color: "var(--text-muted)",
                fontSize: 14,
                lineHeight: 1,
                padding: "0 2px",
              }}
            >
              ×
            </button>
          </div>
        )}

        {/* Export progress */}
        {isExporting && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 12,
              color: "var(--text-secondary)",
            }}
          >
            <Spinner />
            <span>
              Exporting {exportState.copied.toLocaleString()} / {exportState.total.toLocaleString()}
            </span>
          </div>
        )}

        {/* Export button */}
        <button
          onClick={handleExport}
          disabled={count === 0 || isExporting}
          style={{
            padding: "7px 16px",
            background: count > 0 && !isExporting ? "var(--bg-4)" : "var(--bg-2)",
            border: `1px solid ${count > 0 && !isExporting ? "var(--border)" : "var(--border-subtle)"}`,
            borderRadius: 5,
            color:
              count > 0 && !isExporting
                ? "var(--text-primary)"
                : "var(--text-muted)",
            fontSize: 13,
            fontWeight: 500,
            display: "flex",
            alignItems: "center",
            gap: 7,
            transition: "background 0.1s, border-color 0.1s",
            cursor: count > 0 && !isExporting ? "pointer" : "default",
          }}
          onMouseEnter={(e) => {
            if (count > 0 && !isExporting) {
              (e.currentTarget as HTMLElement).style.background = "var(--bg-3)";
              (e.currentTarget as HTMLElement).style.borderColor = "#444";
            }
          }}
          onMouseLeave={(e) => {
            if (count > 0 && !isExporting) {
              (e.currentTarget as HTMLElement).style.background = "var(--bg-4)";
              (e.currentTarget as HTMLElement).style.borderColor = "var(--border)";
            }
          }}
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <path
              d="M6.5 1v7M3.5 5l3 3 3-3M1 9.5V12h11V9.5"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Export selection
        </button>
      </div>

      {/* ── Background-operation status strip ─────────────────────────────── */}
      {showStatus && (
        <div
          style={{
            height: 26,
            borderTop: "1px solid var(--border-subtle)",
            display: "flex",
            alignItems: "center",
            padding: "0 16px",
            gap: 16,
          }}
        >
          {/* Watcher dot */}
          {watcherActive && (
            <StatusPill>
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "#4a9",
                  display: "inline-block",
                  flexShrink: 0,
                }}
              />
              Watching for changes
            </StatusPill>
          )}

          {/* Background scan */}
          {isBackgroundScan && (
            <StatusPill>
              <Spinner />
              {scan.message || "Scanning…"}
              {scan.total > 0 && (
                <span style={{ color: "var(--text-muted)" }}>
                  {scan.scanned.toLocaleString()} / {scan.total.toLocaleString()}
                </span>
              )}
            </StatusPill>
          )}

          {/* Thumbnail generation */}
          {isThumbRunning && (
            <StatusPill>
              <Spinner />
              Generating previews
              <span style={{ color: "var(--text-muted)" }}>
                {thumbProgress.done.toLocaleString()} / {thumbProgress.total.toLocaleString()}
              </span>
              {thumbProgress.total > 0 && (
                <span
                  style={{
                    display: "inline-block",
                    width: 60,
                    height: 3,
                    background: "var(--bg-4)",
                    borderRadius: 2,
                    overflow: "hidden",
                    verticalAlign: "middle",
                  }}
                >
                  <span
                    style={{
                      display: "block",
                      height: "100%",
                      width: `${Math.round((thumbProgress.done / thumbProgress.total) * 100)}%`,
                      background: "var(--text-muted)",
                      transition: "width 0.3s ease",
                    }}
                  />
                </span>
              )}
            </StatusPill>
          )}
        </div>
      )}
    </div>
  );
}

// ── Shared primitives ─────────────────────────────────────────────────────────

function Spinner() {
  return (
    <span
      className="animate-spin-custom"
      style={{
        width: 10,
        height: 10,
        border: "1.5px solid var(--bg-4)",
        borderTopColor: "var(--text-muted)",
        borderRadius: "50%",
        display: "inline-block",
        flexShrink: 0,
      }}
    />
  );
}

function StatusPill({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontSize: 11,
        color: "var(--text-secondary)",
      }}
    >
      {children}
    </div>
  );
}

function ToggleBtn({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? "var(--bg-4)" : "none",
        border: `1px solid ${active ? "var(--border)" : "var(--border-subtle)"}`,
        borderRadius: 4,
        color: active ? "var(--text-primary)" : "var(--text-secondary)",
        fontSize: 12,
        padding: "4px 10px",
        cursor: "pointer",
        transition: "color 0.1s, border-color 0.1s, background 0.1s",
        display: "flex",
        alignItems: "center",
        gap: 5,
      }}
      onMouseEnter={(e) => {
        if (!active) {
          (e.currentTarget as HTMLElement).style.color = "var(--text-primary)";
          (e.currentTarget as HTMLElement).style.borderColor = "var(--border)";
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)";
          (e.currentTarget as HTMLElement).style.borderColor = "var(--border-subtle)";
        }
      }}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <ellipse cx="6" cy="6" rx="5" ry="3.5" stroke="currentColor" strokeWidth="1.2" />
        <circle cx="6" cy="6" r="1.5" fill="currentColor" />
        {active && (
          <line
            x1="2"
            y1="10"
            x2="10"
            y2="2"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        )}
      </svg>
      {label}
    </button>
  );
}

function BarBtn({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: "none",
        border: "1px solid var(--border-subtle)",
        borderRadius: 4,
        color: "var(--text-secondary)",
        fontSize: 12,
        padding: "4px 10px",
        cursor: "pointer",
        transition: "color 0.1s, border-color 0.1s",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.color = "var(--text-primary)";
        (e.currentTarget as HTMLElement).style.borderColor = "var(--border)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)";
        (e.currentTarget as HTMLElement).style.borderColor = "var(--border-subtle)";
      }}
    >
      {label}
    </button>
  );
}
