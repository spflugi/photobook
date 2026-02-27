import { useAppStore } from "../store/appStore";
import { api } from "../lib/tauri";

export function YearSidebar() {
  const { years, activeYear, setActiveYear, setPhotos, selectedIds, scan, thumbProgress } =
    useAppStore();

  async function handleYearClick(year: number) {
    if (year === activeYear) return;
    setActiveYear(year);
    try {
      const photos = await api.getPhotosByYear(year);
      const merged = photos.map((p) => ({
        ...p,
        selected: selectedIds.has(p.id),
      }));
      setPhotos(merged);
    } catch (e) {
      console.error(e);
    }
  }

  const totalSelected = [...years].reduce((s, y) => s + y.selected, 0);

  return (
    <aside
      style={{
        width: 130,
        flexShrink: 0,
        background: "var(--bg-0)",
        borderRight: "1px solid var(--border-subtle)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "14px 14px 10px",
          borderBottom: "1px solid var(--border-subtle)",
        }}
      >
        <div style={{ fontSize: 11, color: "var(--text-muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
          Years
        </div>
        {totalSelected > 0 && (
          <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 4 }}>
            {totalSelected.toLocaleString()} selected
          </div>
        )}
      </div>

      {/* Year list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "6px 0" }}>
        {years.length === 0 && scan.phase === "idle" && (
          <div
            style={{
              padding: "16px 14px",
              fontSize: 12,
              color: "var(--text-muted)",
              lineHeight: 1.5,
            }}
          >
            No photos indexed yet.
          </div>
        )}

        {years.map((y) => {
          const isActive = y.year === activeYear;
          const hasSelected = y.selected > 0;

          return (
            <button
              key={y.year}
              onClick={() => handleYearClick(y.year)}
              style={{
                width: "100%",
                padding: "7px 14px",
                background: isActive ? "var(--bg-3)" : "transparent",
                border: "none",
                borderLeft: isActive
                  ? "2px solid var(--white)"
                  : "2px solid transparent",
                textAlign: "left",
                display: "flex",
                flexDirection: "column",
                gap: 2,
                transition: "background 0.1s",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => {
                if (!isActive)
                  (e.currentTarget as HTMLElement).style.background =
                    "var(--bg-2)";
              }}
              onMouseLeave={(e) => {
                if (!isActive)
                  (e.currentTarget as HTMLElement).style.background =
                    "transparent";
              }}
            >
              <span
                style={{
                  fontSize: 14,
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? "var(--text-bright)" : "var(--text-primary)",
                  letterSpacing: "-0.01em",
                }}
              >
                {y.year}
              </span>
              <span
                style={{
                  fontSize: 11,
                  color: hasSelected ? "var(--text-secondary)" : "var(--text-muted)",
                }}
              >
                {hasSelected
                  ? `${y.selected.toLocaleString()} / ${y.total.toLocaleString()}`
                  : y.total.toLocaleString()}
              </span>
            </button>
          );
        })}
      </div>

      {/* Thumbnail progress hint at bottom */}
      {thumbProgress.running && thumbProgress.total > 0 && (
        <div
          style={{
            padding: "8px 14px",
            borderTop: "1px solid var(--border-subtle)",
          }}
        >
          <div
            style={{
              fontSize: 11,
              color: "var(--text-muted)",
              marginBottom: 4,
            }}
          >
            Generating previews…
          </div>
          <div
            style={{
              height: 2,
              background: "var(--bg-4)",
              borderRadius: 1,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${Math.round(
                  (thumbProgress.done / thumbProgress.total) * 100
                )}%`,
                background: "var(--text-muted)",
                transition: "width 0.3s ease",
              }}
            />
          </div>
        </div>
      )}
    </aside>
  );
}
