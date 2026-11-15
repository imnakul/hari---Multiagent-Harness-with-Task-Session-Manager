import { useEffect } from "react";
import { Footer } from "./components/Footer";
import { Nav } from "./components/Nav";
import { Wallpaper } from "./components/Wallpaper";
import { useReveal } from "./lib/reveal";
import { usePath, useScrollOnRoute } from "./lib/router";
import { StudioProvider } from "./lib/studio";
import { Home } from "./pages/Home";
import { Story } from "./pages/Story";
import { Updates } from "./pages/Updates";

const TITLES: Record<string, string> = {
  "/": "Hari — One harness for everything you build",
  "/story": "Story — Hari",
  "/updates": "What's new — Hari",
};

export function App() {
  const path = usePath();
  useScrollOnRoute(path);
  useReveal(path);

  useEffect(() => {
    document.title = TITLES[path] ?? TITLES["/"];
  }, [path]);

  const page = path === "/story" ? <Story /> : path === "/updates" ? <Updates /> : <Home />;

  return (
    <StudioProvider>
      <Wallpaper />
      <a className="skip" href="#main">
        Skip to content
      </a>
      <Nav />
      <main id="main" key={path} className="page">
        {page}
      </main>
      <Footer />
    </StudioProvider>
  );
}
