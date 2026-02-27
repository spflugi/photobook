import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";

const win = getCurrentWindow();

export function TitleBar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    win.isMaximized().then(setMaximized);
    const unlisten = win.onResized(async () => {
      setMaximized(await win.isMaximized());
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  return (
    <div
      className="titlebar"
      data-tauri-drag-region
      style={{
        height: 36,
        background: "var(--bg-0)",
        borderBottom: "1px solid var(--border-subtle)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        paddingLeft: 14,
        flexShrink: 0,
        userSelect: "none",
      }}
    >
      {/* App identity */}
      <div
        data-tauri-drag-region
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          pointerEvents: "none",
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          style={{ opacity: 0.7 }}
        >
          <rect
            x="1"
            y="3"
            width="14"
            height="10"
            rx="1.5"
            stroke="#d4d4d4"
            strokeWidth="1.2"
          />
          <circle cx="8" cy="8" r="2.5" stroke="#d4d4d4" strokeWidth="1.2" />
          <circle cx="12.5" cy="5" r="0.8" fill="#d4d4d4" />
        </svg>
        <span
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: "var(--text-secondary)",
            letterSpacing: "0.03em",
          }}
        >
          PhotoBook
        </span>
      </div>

      {/* Window controls */}
      <div style={{ display: "flex" }}>
        <WinBtn
          title="Minimize"
          onClick={() => win.minimize()}
          icon={<MinimizeIcon />}
        />
        <WinBtn
          title={maximized ? "Restore" : "Maximize"}
          onClick={() => win.toggleMaximize()}
          icon={maximized ? <RestoreIcon /> : <MaximizeIcon />}
        />
        <WinBtn
          title="Close"
          onClick={() => win.close()}
          icon={<CloseIcon />}
          danger
        />
      </div>
    </div>
  );
}

function WinBtn({
  title,
  onClick,
  icon,
  danger,
}: {
  title: string;
  onClick: () => void;
  icon: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        width: 46,
        height: 36,
        background: "transparent",
        border: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--text-secondary)",
        transition: "background 0.1s, color 0.1s",
        cursor: "default",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = danger
          ? "#c42b1c"
          : "var(--bg-4)";
        (e.currentTarget as HTMLButtonElement).style.color = danger
          ? "#fff"
          : "var(--text-bright)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "transparent";
        (e.currentTarget as HTMLButtonElement).style.color =
          "var(--text-secondary)";
      }}
    >
      {icon}
    </button>
  );
}

const MinimizeIcon = () => (
  <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor">
    <rect width="10" height="1" />
  </svg>
);
const MaximizeIcon = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
    <rect
      x="0.5"
      y="0.5"
      width="9"
      height="9"
      stroke="currentColor"
      strokeWidth="1"
    />
  </svg>
);
const RestoreIcon = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
    <rect
      x="2.5"
      y="0.5"
      width="7"
      height="7"
      stroke="currentColor"
      strokeWidth="1"
    />
    <path d="M0.5 2.5V9.5H7.5" stroke="currentColor" strokeWidth="1" />
  </svg>
);
const CloseIcon = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
    <line
      x1="0.5"
      y1="0.5"
      x2="9.5"
      y2="9.5"
      stroke="currentColor"
      strokeWidth="1.2"
    />
    <line
      x1="9.5"
      y1="0.5"
      x2="0.5"
      y2="9.5"
      stroke="currentColor"
      strokeWidth="1.2"
    />
  </svg>
);
