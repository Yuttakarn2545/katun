import { useEffect, useState } from "react";
import { Toaster } from "./components/ui";
import { Editor } from "./pages/Editor";
import { Home } from "./pages/Home";
import { Settings } from "./pages/Settings";
import { LiveBridge } from "./components/LiveBridge";

// เส้นทางแบบ hash: #/ หน้าแรก, #/edit/<โปรเจกต์> หน้าตัดต่อ, #/settings ตั้งค่า

type Route = { page: "home" } | { page: "edit"; name: string } | { page: "settings" };

function parse(hash: string): Route {
  const edit = /^#\/edit\/([a-zA-Z0-9_-]+)$/.exec(hash);
  if (edit) return { page: "edit", name: edit[1] };
  if (hash === "#/settings") return { page: "settings" };
  return { page: "home" };
}

export const navigate = (hash: string) => {
  location.hash = hash;
};

export function App() {
  const [route, setRoute] = useState(() => parse(location.hash));
  useEffect(() => {
    const onHash = () => setRoute(parse(location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return (
    <>
      {route.page === "edit" ? <Editor key={route.name} name={route.name} /> : route.page === "settings" ? <Settings /> : <Home />}
      <Toaster />
      <LiveBridge />
    </>
  );
}
