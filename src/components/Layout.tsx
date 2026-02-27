import { useEffect } from "react";
import { api } from "../lib/tauri";
import { useAppStore } from "../store/appStore";
import { useScanner } from "../hooks/useScanner";
import { TitleBar } from "./TitleBar";
import { YearSidebar } from "./YearSidebar";
import { PhotoGrid } from "./PhotoGrid";
import { ScanProgress } from "./ScanProgress";
import { SelectionBar } from "./SelectionBar";

export function Layout() {
  const {
    sourceFolder,
    setYears,
    setSelectedIds,
    scan,
    cellSize,
    setCellSize,
  } = useAppStore();
  const { startScan } = useScanner();

  useEffect(() => {
    if (!sourceFolder) return;
    async function init() {
      try {
        // Load years from existing index
        const years = await api.getYears();
        setYears(years);

        // Restore selection set
        const ids = await api.getSelectedIds();
        setSelectedIds(ids);
      } catch (e) {
        console.error("Layout init error:", e);
      }
    }
    init();
  }, [sourceFolder]);

  async function handleRescan() {
    if (!sourceFolder) return;
    await startScan(sourceFolder);
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "var(--bg-1)",
        overflow: "hidden",
      }}
    >
      {/* Custom title bar */}
      <TitleBar />

      {/* Toolbar */}
      <div
        style={{
          height: 40,
          background: "var(--bg-0)",
          borderBottom: "1px solid var(--border-subtle)",
          display: "flex",
          alignItems: "center",
          padding: "0 14px",
          gap: 10,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 12,
            color: "var(--text-muted)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
          }}
          title={sourceFolder ?? ""}
        >
          {sourceFolder}
        </span>

        {/* Zoom slider */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            color: "var(--text-muted)",
          }}
          title={`Thumbnail size: ${cellSize}px`}
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <circle cx="4.5" cy="4.5" r="3.5" stroke="currentColor" strokeWidth="1.2" />
            <line x1="7.5" y1="7.5" x2="10" y2="10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            <line x1="3" y1="4.5" x2="6" y2="4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            <line x1="4.5" y1="3" x2="4.5" y2="6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          <input
            type="range"
            min={80}
            max={280}
            step={10}
            value={cellSize}
            onChange={(e) => setCellSize(parseInt(e.target.value, 10))}
            style={{ width: 72, accentColor: "var(--text-muted)", cursor: "pointer" }}
          />
        </div>

        <ToolbarBtn
          onClick={handleRescan}
          disabled={scan.phase === "scanning"}
          label={scan.phase === "scanning" ? "Scanning…" : "Rescan"}
          icon={
            scan.phase === "scanning" ? (
              <span
                className="animate-spin-custom"
                style={{
                  width: 11,
                  height: 11,
                  border: "1.5px solid var(--bg-4)",
                  borderTopColor: "var(--text-secondary)",
                  borderRadius: "50%",
                  display: "inline-block",
                }}
              />
            ) : (
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                <path
                  d="M9.5 5.5a4 4 0 11-1.17-2.83"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                />
                <path d="M8.3 1v2.7H11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            )
          }
        />

        <ChangeSourceBtn />
      </div>

      {/* Main content area */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", position: "relative" }}>
        <YearSidebar />

        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Year header */}
          <YearHeader />
          {/* Virtual photo grid */}
          <PhotoGrid />
        </div>

        {/* Scan progress overlay */}
        <ScanProgress />
      </div>

      {/* Bottom selection bar */}
      <SelectionBar />
    </div>
  );
}

function YearHeader() {
  const { activeYear, photos, selectedIds } = useAppStore();
  if (!activeYear) return null;

  const yearPhotos = photos;
  const yearSelectedCount = yearPhotos.filter((p) => selectedIds.has(p.id)).length;

  return (
    <div
      style={{
        height: 38,
        borderBottom: "1px solid var(--border-subtle)",
        display: "flex",
        alignItems: "center",
        padding: "0 16px",
        gap: 10,
        flexShrink: 0,
        background: "var(--bg-1)",
      }}
    >
      <span
        style={{
          fontSize: 16,
          fontWeight: 600,
          color: "var(--text-bright)",
          letterSpacing: "-0.02em",
        }}
      >
        {activeYear}
      </span>
      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
        {yearPhotos.length.toLocaleString()} photos
        {yearSelectedCount > 0 && ` · ${yearSelectedCount.toLocaleString()} selected`}
      </span>
    </div>
  );
}

function ToolbarBtn({
  onClick,
  disabled,
  label,
  icon,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  icon?: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: "none",
        border: "1px solid var(--border-subtle)",
        borderRadius: 4,
        color: disabled ? "var(--text-muted)" : "var(--text-secondary)",
        fontSize: 12,
        padding: "4px 9px",
        display: "flex",
        alignItems: "center",
        gap: 5,
        cursor: disabled ? "default" : "pointer",
        transition: "color 0.1s, border-color 0.1s",
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          (e.currentTarget as HTMLElement).style.color = "var(--text-primary)";
          (e.currentTarget as HTMLElement).style.borderColor = "var(--border)";
        }
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.color = disabled
          ? "var(--text-muted)"
          : "var(--text-secondary)";
        (e.currentTarget as HTMLElement).style.borderColor =
          "var(--border-subtle)";
      }}
    >
      {icon}
      {label}
    </button>
  );
}

function ChangeSourceBtn() {
  const { setSourceFolder, setYears, setActiveYear, setWatcherActive } = useAppStore();
  const { startScan } = useScanner();

  async function handleChange() {
    const folder = await api.pickFolder();
    if (!folder) return;
    // Stop any existing watcher before switching folders.
    setWatcherActive(false);
    await api.stopWatching().catch(console.error);
    await api.setSetting("sourceFolder", folder);
    setSourceFolder(folder);
    setYears([]);
    setActiveYear(null);
    await startScan(folder);
    // Watcher restarts automatically when the full scan completes (in useScanner).
  }

  return (
    <ToolbarBtn
      onClick={handleChange}
      label="Change folder"
      icon={
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
          <path
            d="M1 2.5A1.5 1.5 0 012.5 1H4l1 1.5h4A1 1 0 0110 3.5v5A1.5 1.5 0 018.5 10h-6A1.5 1.5 0 011 8.5v-6z"
            stroke="currentColor"
            strokeWidth="1.2"
          />
        </svg>
      }
    />
  );
}
