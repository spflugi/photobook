import { useEffect, useState } from "react";
import { Layout } from "./components/Layout";
import { FolderPicker } from "./components/FolderPicker";
import { useAppStore } from "./store/appStore";
import { api } from "./lib/tauri";

export default function App() {
  const { sourceFolder, setSourceFolder, setYears, setSelectedIds } = useAppStore();
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    async function init() {
      try {
        const folder = await api.getSetting("sourceFolder");
        if (folder) {
          setSourceFolder(folder);
          const [years, selectedIds] = await Promise.all([
            api.getYears(),
            api.getSelectedIds(),
          ]);
          setYears(years);
          setSelectedIds(selectedIds);
        }
      } catch (e) {
        console.error("App init error:", e);
      } finally {
        setInitializing(false);
      }
    }
    init();
  }, []);

  if (initializing) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--bg-1)",
        }}
      >
        <span
          className="animate-spin-custom"
          style={{
            width: 20,
            height: 20,
            border: "2px solid var(--bg-4)",
            borderTopColor: "var(--text-secondary)",
            borderRadius: "50%",
            display: "inline-block",
          }}
        />
      </div>
    );
  }

  return sourceFolder ? <Layout /> : <FolderPicker />;
}
